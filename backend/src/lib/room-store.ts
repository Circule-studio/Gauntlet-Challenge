// In-memory multiplayer-room store with an SSE pub/sub fanout.
//
// One process = one shared store. For multi-instance hosting, swap to Redis pub/sub
// (the public surface of this module is small enough to make that drop-in later).
//
// Each room has:
//   - a Map of members keyed by steamId
//   - a synced GauntletState
//   - a Set of subscriber objects, each with an enqueue function (the SSE writer)
//
// On every state or membership mutation we re-broadcast to all subscribers. Each
// subscriber is also detached automatically when its underlying response is closed.

import crypto from "crypto";
import { DEFAULT_STATE, type GauntletState } from "@shared/types";
import { BOT_ID_PREFIX, isBotId, type SteamSessionUser } from "@shared/types/steam";
import type { RoomEvent, RoomMember, RoomSnapshot } from "@shared/types/room";
import { mapToOverlay, type OverlayState } from "./overlay-state";
import { recordRun } from "./db";
import { getLinkBySteamId } from "./twitch-store";
import { triggerCategoryUpdate } from "./twitch-category";

const MAX_MEMBERS = 8;
const ROOM_TTL_MS = 12 * 60 * 60 * 1000; // 12h since last activity (active rooms)
// How long an empty room stays around waiting for someone to come back via the
// URL — covers a computer reboot, browser close, or any longer absence than the
// per-socket grace window. Returning to /room/<code> inside this window auto-
// rejoins (joinRoom is idempotent and re-adds missing members).
const EMPTY_ROOM_TTL_MS = 60 * 60 * 1000; // 1h
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // unambiguous characters

interface Subscriber {
  steamId: string;
  send: (event: RoomEvent) => void;
}

interface OverlaySubscriber {
  send: (state: OverlayState) => void;
}

interface Room {
  code: string;
  ownerSteamId: string;
  members: Map<string, RoomMember>;
  state: GauntletState;
  createdAt: number;
  lastActivity: number;
  subscribers: Set<Subscriber>;
  // Per-member timers scheduled when their last subscriber disconnects. If they
  // reconnect within the grace window, the timer is cancelled and they stay in
  // the room. Otherwise they're removed when the timer fires.
  pendingLeaves: Map<string, ReturnType<typeof setTimeout>>;
  // Read-only fanout for Twitch overlay clients. No membership check, no auth —
  // anyone with the room code can watch. Updated on every state mutation.
  overlaySubscribers: Set<OverlaySubscriber>;
  // When the active gauntlet game last changed. GauntletState doesn't track
  // per-game timing, so we capture it here for the overlay's "current game"
  // timer. Null when the run hasn't started or no game is selected.
  currentGameStartedAt: number | null;
  // Completion time for each finished game, in seconds, captured at the moment
  // the game id appeared in state.done. Reset whenever runStartTime changes
  // (= a fresh run starts). Surfaced to the overlay's game-list widget.
  gameDurations: Record<number, number>;
}

// Per-user overlay subscriber. Stays bound across rooms — when the user joins a
// new room or leaves their current one, `boundRoom` is re-resolved and a fresh
// snapshot (or the noroom placeholder) is pushed.
interface UserOverlaySub {
  steamId: string;
  send: (overlay: OverlayState | null) => void;
  boundRoom: Room | null;
}

// Persist across Next.js hot-reloads in dev mode.
const g = global as typeof global & {
  _rooms?: Map<string, Room>;
  _userOverlaySubs?: Map<string, Set<UserOverlaySub>>;
};
if (!g._rooms) g._rooms = new Map<string, Room>();
if (!g._userOverlaySubs) g._userOverlaySubs = new Map<string, Set<UserOverlaySub>>();
const rooms = g._rooms;
const userOverlaySubs = g._userOverlaySubs;
// Migrate rooms that survived an HMR reload from before these fields existed.
rooms.forEach((r) => {
  if (!r.pendingLeaves) r.pendingLeaves = new Map();
  if (!r.overlaySubscribers) r.overlaySubscribers = new Set();
  if (r.currentGameStartedAt === undefined) r.currentGameStartedAt = null;
  if (!r.gameDurations) r.gameDurations = {};
});

function generateCode(): string {
  let s = "";
  for (let i = 0; i < 6; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

function clearPendingLeaves(r: Room) {
  r.pendingLeaves.forEach((t) => clearTimeout(t));
  r.pendingLeaves.clear();
}

function gc(now: number) {
  rooms.forEach((r, code) => {
    const ttl = r.members.size === 0 ? EMPTY_ROOM_TTL_MS : ROOM_TTL_MS;
    if (now - r.lastActivity > ttl) {
      // Notify any straggler subscribers and drop the room.
      clearPendingLeaves(r);
      broadcast(r, { type: "closed", reason: "expired" });
      r.subscribers.clear();
      const expiredMembers = Array.from(r.members.keys());
      rooms.delete(code);
      // After deletion, re-bind any user-overlay subs that were on this room.
      expiredMembers.forEach(refreshUserOverlaySubs);
    }
  });
}

// Periodic GC tick. Empty rooms only expire via gc, so we can't rely on
// createRoom being called to flush them — schedule a low-frequency sweep.
const ggc = global as typeof global & { _roomGcInterval?: ReturnType<typeof setInterval> };
if (!ggc._roomGcInterval) {
  ggc._roomGcInterval = setInterval(() => gc(Date.now()), 5 * 60 * 1000);
  // Don't keep the process alive just for this.
  ggc._roomGcInterval.unref?.();
}

function enrichMember(m: RoomMember): RoomMember {
  const link = getLinkBySteamId(m.steamId);
  return {
    ...m,
    twitch: link ? { login: link.login, displayName: link.displayName } : null,
  };
}

function snapshotMembers(r: Room): RoomMember[] {
  return Array.from(r.members.values()).map(enrichMember);
}

function snapshot(r: Room): RoomSnapshot {
  return {
    code: r.code,
    ownerSteamId: r.ownerSteamId,
    members: snapshotMembers(r),
    state: r.state,
    createdAt: r.createdAt,
  };
}

function broadcast(r: Room, event: RoomEvent) {
  r.subscribers.forEach((sub) => {
    try {
      sub.send(event);
    } catch {
      // Dead subscriber; drop it.
      r.subscribers.delete(sub);
    }
  });
}

function broadcastOverlay(r: Room) {
  const hasCodeSubs = r.overlaySubscribers.size > 0;
  const memberIds = Array.from(r.members.keys());
  const hasUserSubs = memberIds.some((id) => userOverlaySubs.has(id));
  if (!hasCodeSubs && !hasUserSubs) return;

  const overlay = mapToOverlay(r.state, r.currentGameStartedAt, r.gameDurations);

  r.overlaySubscribers.forEach((sub) => {
    try { sub.send(overlay); }
    catch { r.overlaySubscribers.delete(sub); }
  });

  // Per-user subs: each member of this room with an active user-overlay sub
  // bound to this exact room gets the same payload.
  memberIds.forEach((memberId) => {
    const bucket = userOverlaySubs.get(memberId);
    if (!bucket) return;
    bucket.forEach((sub) => {
      if (sub.boundRoom !== r) return;
      try { sub.send(overlay); }
      catch { bucket.delete(sub); }
    });
  });
}

/** Most recently active room the user is currently a member of, or null. */
function findUserRoom(steamId: string): Room | null {
  let best: Room | null = null;
  rooms.forEach((r) => {
    if (!r.members.has(steamId)) return;
    if (!best || r.lastActivity > best.lastActivity) best = r;
  });
  return best;
}

/** Public lookup: room code of a user's most recently active room, or null. */
export function findUserRoomCode(steamId: string): string | null {
  return findUserRoom(steamId)?.code ?? null;
}

/**
 * Re-broadcast the members list for any rooms `steamId` is in. Called by the
 * Twitch routes after connect/disconnect so other members see the indicator
 * change without needing to refresh.
 */
export function broadcastMembersForUser(steamId: string): void {
  rooms.forEach((r) => {
    if (!r.members.has(steamId)) return;
    broadcast(r, { type: "members", members: snapshotMembers(r) });
  });
}

const BOT_NAME_MIN = 1;
const BOT_NAME_MAX = 24;

function sanitizeBotName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if (code < 32 || code === 127) continue;
    out += raw[i];
  }
  const cleaned = out.replace(/\s+/g, " ").trim();
  if (cleaned.length < BOT_NAME_MIN || cleaned.length > BOT_NAME_MAX) return null;
  return cleaned;
}

function generateBotId(): string {
  return `${BOT_ID_PREFIX}${crypto.randomBytes(6).toString("hex")}`;
}

function botAvatar(name: string): string {
  const initial = (name.match(/[\p{L}\p{N}]/u)?.[0] ?? "B").toUpperCase();
  // Slate-grey background to visually distinguish bots from human guest avatars
  // (which use a hue derived from the name).
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="184" height="184" viewBox="0 0 184 184">` +
    `<rect width="184" height="184" fill="#3a4150"/>` +
    `<text x="92" y="120" font-family="sans-serif" font-size="96" font-weight="700" text-anchor="middle" fill="#cbd5e1">${initial}</text>` +
    `</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/**
 * Add a synthetic bot member to `code`. Any human member of the room may add a
 * bot — there's no owner-only gate, since bots are convenience for filling out
 * draws, not a privileged operation.
 */
export function addBot(
  code: string,
  requesterSteamId: string,
  name: string,
): { bot: RoomMember } | { error: string } {
  const r = rooms.get(code.toUpperCase());
  if (!r) return { error: "Room introuvable" };
  if (!r.members.has(requesterSteamId)) return { error: "Pas membre de cette room" };
  if (r.members.size >= MAX_MEMBERS) return { error: "Room pleine" };
  const cleanName = sanitizeBotName(name);
  if (!cleanName) return { error: "Nom de bot invalide" };
  const botId = generateBotId();
  const bot: RoomMember = {
    steamId: botId,
    displayName: cleanName,
    avatarUrl: botAvatar(cleanName),
    profileUrl: "",
    joinedAt: Date.now(),
  };
  r.members.set(botId, bot);
  touch(r);
  broadcast(r, { type: "members", members: snapshotMembers(r) });
  return { bot };
}

/**
 * Remove a bot from `code`. Any human member can do this; non-bot ids are
 * rejected so this can't be used to kick a real player.
 */
export function removeBot(
  code: string,
  requesterSteamId: string,
  botSteamId: string,
): { ok: true } | { error: string } {
  const r = rooms.get(code.toUpperCase());
  if (!r) return { error: "Room introuvable" };
  if (!r.members.has(requesterSteamId)) return { error: "Pas membre de cette room" };
  if (!isBotId(botSteamId)) return { error: "Cible non bot" };
  if (!r.members.delete(botSteamId)) return { error: "Bot introuvable" };
  touch(r);
  broadcast(r, { type: "members", members: snapshotMembers(r) });
  return { ok: true };
}

function rebindUserSub(sub: UserOverlaySub) {
  const target = findUserRoom(sub.steamId);
  sub.boundRoom = target;
  try {
    sub.send(
      target
        ? mapToOverlay(target.state, target.currentGameStartedAt, target.gameDurations)
        : null,
    );
  } catch {
    // Caller's send() failed — the sub will be cleaned up by the SSE route.
  }
}

/** Re-evaluate every user-overlay sub for `steamId` (called on join/leave). */
function refreshUserOverlaySubs(steamId: string) {
  const bucket = userOverlaySubs.get(steamId);
  if (!bucket) return;
  bucket.forEach(rebindUserSub);
}

function touch(r: Room) {
  r.lastActivity = Date.now();
}

// === public API ===

export function createRoom(owner: SteamSessionUser): RoomSnapshot {
  const now = Date.now();
  gc(now);
  let code: string;
  do {
    code = generateCode();
  } while (rooms.has(code));
  const member: RoomMember = { ...owner, joinedAt: now };
  const room: Room = {
    code,
    ownerSteamId: owner.steamId,
    members: new Map([[owner.steamId, member]]),
    state: { ...DEFAULT_STATE },
    createdAt: now,
    lastActivity: now,
    subscribers: new Set(),
    pendingLeaves: new Map(),
    overlaySubscribers: new Set(),
    currentGameStartedAt: null,
    gameDurations: {},
  };
  rooms.set(code, room);
  return snapshot(room);
}


export function getRoom(code: string): RoomSnapshot | null {
  const r = rooms.get(code.toUpperCase());
  return r ? snapshot(r) : null;
}

export function joinRoom(code: string, user: SteamSessionUser): RoomSnapshot | { error: string } {
  const r = rooms.get(code.toUpperCase());
  if (!r) return { error: "Room introuvable" };
  if (r.members.size >= MAX_MEMBERS && !r.members.has(user.steamId)) {
    return { error: "Room pleine" };
  }
  const member: RoomMember = { ...user, joinedAt: r.members.get(user.steamId)?.joinedAt ?? Date.now() };
  r.members.set(user.steamId, member);
  touch(r);
  broadcast(r, { type: "members", members: snapshotMembers(r) });
  refreshUserOverlaySubs(user.steamId);
  return snapshot(r);
}

/**
 * Remove `steamId` from `code`'s member list.
 *
 * `deleteIfEmpty` controls what happens if this drops the room to zero members:
 *   true  — explicit leave (user clicked "Quitter"). Room is destroyed and any
 *           remaining subscribers receive `closed: "empty"`.
 *   false — grace-period expiry (user disconnected and never came back). Room
 *           is kept around for EMPTY_ROOM_TTL_MS so the user can reconnect via
 *           the URL after a reboot / longer absence.
 */
function removeMember(code: string, steamId: string, deleteIfEmpty: boolean): boolean {
  const r = rooms.get(code.toUpperCase());
  if (!r) return false;
  const t = r.pendingLeaves.get(steamId);
  if (t) {
    clearTimeout(t);
    r.pendingLeaves.delete(steamId);
  }
  const had = r.members.delete(steamId);
  if (!had) return false;
  // Bots can't subscribe or drive the room — once the last human is gone, drop
  // any orphan bots so the empty-room handling kicks in normally.
  const remainingHumans = Array.from(r.members.keys()).filter((id) => !isBotId(id));
  if (remainingHumans.length === 0 && r.members.size > 0) {
    r.members.clear();
  }
  if (r.members.size === 0) {
    if (deleteIfEmpty) {
      clearPendingLeaves(r);
      broadcast(r, { type: "closed", reason: "empty" });
      r.subscribers.clear();
      rooms.delete(r.code);
    } else {
      // Mark activity so the empty-room TTL clock starts now.
      touch(r);
      // No remaining subscribers to notify.
    }
    refreshUserOverlaySubs(steamId);
    return true;
  }
  // Promote a new owner if the leaver was the owner. Skip bots — they can't
  // own rooms (no session, no subscribers).
  if (r.ownerSteamId === steamId) {
    const nextHuman = Array.from(r.members.values()).find((m) => !isBotId(m.steamId));
    if (nextHuman) r.ownerSteamId = nextHuman.steamId;
  }
  touch(r);
  broadcast(r, { type: "members", members: snapshotMembers(r) });
  refreshUserOverlaySubs(steamId);
  return true;
}

/** Explicit leave (button press / REST hop). Deletes the room when it empties. */
export function leaveRoom(code: string, steamId: string): boolean {
  return removeMember(code, steamId, /* deleteIfEmpty */ true);
}

/**
 * Schedule a grace-period removal of `steamId` from `code`. If the user
 * reconnects (and a new subscribe happens), call `cancelPendingLeave` to abort.
 * When the timer fires, the user is removed but the room is preserved so they
 * can come back to the same URL after a reboot. Returns false if the room or
 * member doesn't exist, OR if the user still has another live subscriber in
 * the room (e.g. a second tab, or a new socket that already raced ahead of the
 * old socket's `disconnect` event). Without that last check, a refresh whose
 * new-socket `join` arrives before the old-socket `disconnect` would set a
 * doomed timer that removes the user 30 s later — and re-adding them puts them
 * at the end of the member Map, swapping their position.
 */
export function schedulePendingLeave(code: string, steamId: string, graceMs: number): boolean {
  const r = rooms.get(code.toUpperCase());
  if (!r || !r.members.has(steamId)) return false;
  let hasLiveSubscriber = false;
  r.subscribers.forEach((sub) => {
    if (sub.steamId === steamId) hasLiveSubscriber = true;
  });
  if (hasLiveSubscriber) return false;
  const existing = r.pendingLeaves.get(steamId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    removeMember(r.code, steamId, /* deleteIfEmpty */ false);
  }, graceMs);
  r.pendingLeaves.set(steamId, timer);
  return true;
}

/** Cancel any pending grace-period leave for `steamId` in `code`. */
export function cancelPendingLeave(code: string, steamId: string): void {
  const r = rooms.get(code.toUpperCase());
  if (!r) return;
  const t = r.pendingLeaves.get(steamId);
  if (t) {
    clearTimeout(t);
    r.pendingLeaves.delete(steamId);
  }
}

/**
 * Apply a known-good `next` state to `r`. Handles per-game timing capture,
 * history → DB persistence, broadcast to subscribers + overlay clients.
 *
 * Caller is responsible for any access-control check (membership, ownership,
 * system-trigger origin, etc.) before invoking this.
 */
function applyMutation(r: Room, next: GauntletState): RoomSnapshot {
  const prev = r.state;
  const prevGameId = prev.run[prev.current] ?? null;
  const nextGameId = next.run[next.current] ?? null;
  const runRunning = next.runStartTime !== null;
  const now = Date.now();

  // History entries appended in this mutation — these are the runs to persist.
  // Capture durations BEFORE the runStartTime-reset block below clears them, so
  // a single mutation that both completes a run and resets state still ends up
  // with the right per-game timing for the row we write.
  const newHistoryEntries =
    next.history.length > prev.history.length
      ? next.history.slice(prev.history.length)
      : [];
  const persistedDurations: Record<number, number> | null =
    newHistoryEntries.length > 0 ? { ...r.gameDurations } : null;

  // A new run started (or run was reset) → drop stale per-game durations.
  if (next.runStartTime !== prev.runStartTime) {
    r.gameDurations = {};
  }

  // Capture completion time for any game that just landed in done[]. The only
  // id we know the start time for is the one that was active before this
  // mutation (currentGameStartedAt belongs to it). Other newly-done ids — if
  // the UI ever marks a non-active game complete — get no duration recorded.
  const prevDone = new Set(prev.done);
  for (const id of next.done) {
    if (prevDone.has(id)) continue;
    if (id === prevGameId && r.currentGameStartedAt !== null) {
      const dur = Math.max(1, Math.floor((now - r.currentGameStartedAt) / 1000));
      r.gameDurations[id] = dur;
      // Mirror into the persisted snapshot so the final game's time is included
      // even when run-end and timing-capture happen in the same mutation.
      if (persistedDurations) persistedDurations[id] = dur;
    }
  }

  if (!runRunning || nextGameId === null) {
    r.currentGameStartedAt = null;
  } else if (prevGameId !== nextGameId || r.currentGameStartedAt === null) {
    r.currentGameStartedAt = now;
  }

  r.state = next;
  touch(r);
  broadcast(r, { type: "state", state: next });
  broadcastOverlay(r);

  // Auto-update each opted-in member's Twitch category when the active game
  // changes. Background fire-and-forget — never blocks the live mutation.
  if (runRunning && nextGameId !== null && nextGameId !== prevGameId) {
    triggerCategoryUpdate(Array.from(r.members.keys()), nextGameId);
  }

  if (persistedDurations) {
    const members = Array.from(r.members.values());
    for (const entry of newHistoryEntries) {
      recordRun({
        roomCode: r.code,
        entry,
        members,
        gameDurations: persistedDurations,
      });
    }
  }

  return snapshot(r);
}

export function mutateState(
  code: string,
  steamId: string,
  next: GauntletState,
): RoomSnapshot | { error: string } {
  const r = rooms.get(code.toUpperCase());
  if (!r) return { error: "Room introuvable" };
  if (!r.members.has(steamId)) return { error: "Pas membre de cette room" };
  return applyMutation(r, next);
}

/**
 * System-triggered mutation (Twitch effect, scheduler, etc.). The transform
 * gets the current state and returns either the new state (applies + broadcasts)
 * or null (effect doesn't apply right now — caller should refund / drop).
 */
export function applyToRoom(
  code: string,
  transform: (state: GauntletState) => GauntletState | null,
): { applied: true; snapshot: RoomSnapshot } | { applied: false; reason: string } {
  const r = rooms.get(code.toUpperCase());
  if (!r) return { applied: false, reason: "no_room" };
  const next = transform(r.state);
  if (next === null) return { applied: false, reason: "not_applicable" };
  if (next === r.state) return { applied: false, reason: "no_change" };
  return { applied: true, snapshot: applyMutation(r, next) };
}

/** Subscribe an SSE stream. Caller MUST invoke the returned unsubscribe fn on close. */
export function subscribe(
  code: string,
  steamId: string,
  send: (event: RoomEvent) => void,
): { snapshot: RoomSnapshot; unsubscribe: () => void } | { error: string } {
  const r = rooms.get(code.toUpperCase());
  if (!r) return { error: "Room introuvable" };
  if (!r.members.has(steamId)) return { error: "Pas membre de cette room" };
  const sub: Subscriber = { steamId, send };
  r.subscribers.add(sub);
  touch(r);
  return {
    snapshot: snapshot(r),
    unsubscribe: () => {
      r.subscribers.delete(sub);
    },
  };
}

/**
 * Read-only SSE for Twitch overlays. No auth, no membership — anyone with the
 * room code can observe. Returns the initial snapshot in overlay shape; further
 * updates flow via `send` whenever the room state mutates.
 */
export function subscribeOverlay(
  code: string,
  send: (state: OverlayState) => void,
): { snapshot: OverlayState; unsubscribe: () => void } | { error: string } {
  const r = rooms.get(code.toUpperCase());
  if (!r) return { error: "Room introuvable" };
  const sub: OverlaySubscriber = { send };
  r.overlaySubscribers.add(sub);
  return {
    snapshot: mapToOverlay(r.state, r.currentGameStartedAt, r.gameDurations),
    unsubscribe: () => {
      r.overlaySubscribers.delete(sub);
    },
  };
}

/**
 * Stable per-user overlay stream. The sub auto-hops to whichever room the user
 * joins. `send` receives `OverlayState` while bound to a room, or `null` when
 * the user isn't in any room (the SSE route renders that as a placeholder).
 */
export function subscribeUserOverlay(
  steamId: string,
  send: (overlay: OverlayState | null) => void,
): { snapshot: OverlayState | null; unsubscribe: () => void } {
  const sub: UserOverlaySub = { steamId, send, boundRoom: null };
  let bucket = userOverlaySubs.get(steamId);
  if (!bucket) {
    bucket = new Set();
    userOverlaySubs.set(steamId, bucket);
  }
  bucket.add(sub);

  const target = findUserRoom(steamId);
  sub.boundRoom = target;
  const snapshot = target
    ? mapToOverlay(target.state, target.currentGameStartedAt, target.gameDurations)
    : null;

  return {
    snapshot,
    unsubscribe: () => {
      const b = userOverlaySubs.get(steamId);
      if (!b) return;
      b.delete(sub);
      if (b.size === 0) userOverlaySubs.delete(steamId);
    },
  };
}
