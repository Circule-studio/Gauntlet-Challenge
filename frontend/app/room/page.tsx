"use client";

import React, { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { POOL, getCategories, effectiveMode } from "@/lib/games";
import { CAT_ICONS } from "@/lib/icons";
import {
 DEFAULT_STATE,
 type GauntletState,
 type Difficulty,
 type PenaltyMode,
 type Game,
 type RunHistoryEntry,
} from "@/lib/types";
import { useRoom } from "@/lib/client/use-room";
import { useMeStatus } from "@/lib/client/use-me";
import { isGuestId, isBotId, isSyntheticId } from "@/lib/types/steam";

// === ICONS (Lucide-style inline SVG) ===
const ICON_PATHS: Record<string, React.ReactNode> = {
  dice: (<><rect x="2" y="2" width="10" height="10" rx="2"/><rect x="12" y="12" width="10" height="10" rx="2"/><circle cx="7" cy="7" r="0.5" fill="currentColor"/><circle cx="17" cy="17" r="0.5" fill="currentColor"/></>),
  refresh: (<><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/></>),
  check: (<polyline points="20 6 9 17 4 12"/>),
  x: (<><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>),
  trash: (<><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></>),
  volume: (<><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></>),
  volumeOff: (<><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="22" y1="9" x2="16" y2="15"/><line x1="16" y1="9" x2="22" y2="15"/></>),
  pin: (<><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></>),
  sparkles: (<path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>),
  trophy: (<><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></>),
  skull: (<><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><path d="M8 20v2h8v-2"/><path d="M16 20a2 2 0 0 0 1.56-3.25 8 8 0 1 0-11.12 0A2 2 0 0 0 8 20"/></>),
  search: (<><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></>),
  eye: (<><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></>),
  eyeOff: (<><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-10-7-10-7a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 7 10 7a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></>),
  star: (<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>),
  users: (<><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></>),
  user: (<><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></>),
  list: (<><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></>),
  info: (<><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></>),
  barChart: (<><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="3" y1="20" x2="21" y2="20"/></>),
  twitch: (<path d="M21 2H3v16h5v4l4-4h5l4-4V2zM11 11V7M16 11V7"/>),
  bot: (<><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><line x1="12" y1="7" x2="12" y2="11"/><line x1="8" y1="16" x2="8" y2="16"/><line x1="16" y1="16" x2="16" y2="16"/></>),
  plus: (<><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></>),
  clock: (<><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></>),
};
function Icon({ name, size = 14, fill = "none" }: { name: string; size?: number; fill?: string }) {
  const path = ICON_PATHS[name];
  if (!path) return null;
  const strokeWidth = name === "check" || name === "x" ? 2.5 : 2;
  const fillProp = name === "star" ? "currentColor" : fill;
  return (
    <span className="icon">
      <svg width={size} height={size} viewBox="0 0 24 24" fill={fillProp} stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">{path}</svg>
    </span>
  );
}

// === GAME COVER (Steam library art or custom URL) ===
function GameCover({ appid, cover, name, size = "md" }: { appid?: number; cover?: string; name: string; size?: "sm" | "md" | "lg" }) {
  const src = cover ?? (appid ? `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/library_600x900.jpg` : null);
  // Track which URL we failed to load. Comparing against the current `src`
  // means the fallback resets automatically if `src` later changes (e.g. an
  // appid is added to the entry). Avoids a separate useEffect.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = src !== null && failedSrc === src;

  if (!src || failed) {
    return (
      <div className={`game-cover game-cover-${size} game-cover-fallback`}>
        <span>{name.slice(0, 2).toUpperCase()}</span>
      </div>
    );
  }
  return (
    <div className={`game-cover game-cover-${size}`}>
      <img
        src={src}
        alt={name}
        loading="lazy"
        onError={() => setFailedSrc(src)}
      />
    </div>
  );
}

function shuffle<T>(arr: T[]): T[] {
 const a = [...arr];
 for (let i = a.length - 1; i > 0; i--) {
 const j = Math.floor(Math.random() * (i + 1));
 [a[i], a[j]] = [a[j], a[i]];
 }
 return a;
}

function fmtDuration(ms: number): string {
 if (!ms || ms < 0) return "—";
 const s = Math.floor(ms / 1000);
 const m = Math.floor(s / 60);
 const h = Math.floor(m / 60);
 if (h > 0) return `${h}h${(m % 60).toString().padStart(2, "0")}`;
 if (m > 0) return `${m}m${(s % 60).toString().padStart(2, "0")}s`;
 return `${s}s`;
}

function fmtDate(ts: number): string {
 const d = new Date(ts);
 return (
 d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }) +
 " " +
 d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
 );
}

// Render a champion list. Solo gets a single name; duo games split the picks
// into cooperating pairs of 2 ("A & B" for one duo, "A & B · C & D" for two
// parallel duos, etc.). The two duos play the objective independently — they
// aren't versus each other.
// Verifies a Steam achievement is unlocked for the current user and, if so,
// auto-marks the game as won. Polls every 30s while mounted; "Vérifier" button
// triggers an immediate refresh.
function AchievementCheck({
  gameId,
  appid,
  apiname,
  label,
  onUnlocked,
}: {
  gameId: number;
  appid: number;
  apiname: string;
  label?: string;
  onUnlocked: () => void;
}) {
  const [status, setStatus] = useState<"idle" | "checking" | "unlocked" | "locked" | "private">("idle");
  const firedRef = useRef(false);
  const check = async (silent = false) => {
    if (!silent) setStatus("checking");
    try {
      const r = await fetch(`/api/steam/achievement/${appid}/${encodeURIComponent(apiname)}`, { credentials: "include" });
      if (r.status === 403) { setStatus("private"); return; }
      if (!r.ok) { if (!silent) setStatus("idle"); return; }
      const data = await r.json() as { unlocked: boolean; known: boolean };
      if (data.unlocked) {
        setStatus("unlocked");
        if (!firedRef.current) {
          firedRef.current = true;
          onUnlocked();
        }
      } else {
        setStatus(data.known ? "locked" : "private");
      }
    } catch {
      if (!silent) setStatus("idle");
    }
  };
  useEffect(() => {
    void check(true);
    const id = setInterval(() => void check(true), 30_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, appid, apiname]);

  return (
    <div className={`achievement-check status-${status}`}>
      <span className="achievement-label">
        🏆 Succès Steam : <strong>{label ?? apiname}</strong>
      </span>
      <button
        type="button"
        className="btn btn-achievement"
        onClick={() => void check(false)}
        disabled={status === "checking"}
      >
        {status === "checking" ? "…" :
         status === "unlocked" ? "Débloqué ✓" :
         status === "private" ? "Profil privé" :
         status === "locked" ? "Vérifier à nouveau" :
         "Vérifier"}
      </button>
    </div>
  );
}

// Renders a formatted champion string with each name preceded by its avatar.
// Falls back to plain text when no avatar map is available (history view, etc).
function ChampionName({
  text,
  nameToAvatar,
}: {
  text: string;
  nameToAvatar?: Record<string, string>;
}) {
  if (!nameToAvatar) return <span className="name">{text}</span>;
  // Split on pair separators while keeping them as literal tokens we can replay
  // in the JSX. We don't try to interpret structure — we just walk the tokens.
  const tokens = text.split(/( & | · )/);
  return (
    <span className="name champion-name-with-avatars">
      {tokens.map((tok, i) => {
        if (tok === " & " || tok === " · ") return <span key={i} className="champion-sep">{tok}</span>;
        const av = nameToAvatar[tok];
        return (
          <span key={i} className="champion-pick">
            {av && <img className="champion-avatar" src={av} alt="" />}
            <span className="champion-pick-name">{tok}</span>
          </span>
        );
      })}
    </span>
  );
}

function formatChampion(picks: string[], pairSize: number): string {
 if (picks.length === 0) return "";
 if (pairSize <= 1) return picks.join(" & ");
 const pairs: string[] = [];
 for (let i = 0; i < picks.length; i += pairSize) {
   pairs.push(picks.slice(i, i + pairSize).join(" & "));
 }
 return pairs.join(" · ");
}

export default function Page() {
  // Static export ne supporte pas les segments dynamiques [code], on lit le code
  // depuis ?code=XXX. useSearchParams demande un Suspense boundary autour.
  return (
    <Suspense fallback={<main className="auth-shell"><div className="auth-card"><p className="auth-subtitle">Chargement…</p></div></main>}>
      <RoomPageInner />
    </Suspense>
  );
}

function RoomPageInner() {
 const searchParams = useSearchParams();
 const router = useRouter();
 const roomCode = (searchParams.get("code") ?? "").toUpperCase();
 const { user: me, loading: meLoading } = useMeStatus();
 // Pas de code → retour au lobby. Code présent mais pas authentifié → login avec
 // `next` pour revenir directement à la room après connexion.
 useEffect(() => {
   if (!roomCode) {
     router.replace("/lobby");
     return;
   }
   if (!meLoading && me === null) {
     router.replace(`/login?next=${encodeURIComponent(roomCode)}`);
   }
 }, [roomCode, me, meLoading, router]);
 const { state, setState, members, ownerSteamId, connected, closed, addBot, removeBot, startTimer: socketStartTimer, clearTimer: socketClearTimer } = useRoom(roomCode);
 const isHost = !!me && !!ownerSteamId && me.steamId === ownerSteamId;
 // Map displayName -> avatarUrl for the champion slot machine. Names are unique
 // within a room (the lobby enforces this), so a flat map is safe.
 const nameToAvatar = useMemo(() => {
   const map: Record<string, string> = {};
   for (const m of members) {
     if (m.displayName && m.avatarUrl) map[m.displayName] = m.avatarUrl;
   }
   return map;
 }, [members]);
 const hydrated = true;
 const [localSearch, setLocalSearch] = useState("");
 const [localFilter, setLocalFilter] = useState("all");
 const [overlay, setOverlay] = useState<{ kind: "win" | "lose" | null; msg?: string }>({ kind: null });
 const [swappedIdx, setSwappedIdx] = useState<number | null>(null);
 const [shaking, setShaking] = useState(false);
 const [now, setNow] = useState<number>(Date.now());
 // Shared review modal — `pendingRun`, ready states and countdown all live in
 // `state` so every member sees the same view. Derived flags below keep the
 // existing render logic compatible.
 const pendingRun = state.pendingRun ?? null;
 const reviewing = pendingRun !== null && state.countdownStartedAt === null;
 const COUNTDOWN_MS = 3000;
 const countdownDigit: number | null = (() => {
   const start = state.countdownStartedAt;
   if (start === null) return null;
   const elapsed = now - start;
   const remaining = Math.ceil((COUNTDOWN_MS - elapsed) / 1000);
   if (remaining > 0) return remaining;
   // ~600ms "GO" window then the countdown auto-clears via the launch effect.
   return 0;
 })();
 const countdown = countdownDigit;
 // Per-game timer duration the local user has dialled in (minutes). Synced
 // deadline lives in `state.timerDeadline`; this is just the input box.
 const [timerInputMin, setTimerInputMin] = useState<number>(5);
 const [objTip, setObjTip] = useState<{ id: number; right: number; top: number; bottom: number; flipUp: boolean } | null>(null);
 const [showOverlays, setShowOverlays] = useState(false);
 const [overlayCopied, setOverlayCopied] = useState<string | null>(null);
 const [overlayToken, setOverlayToken] = useState<string | null>(null);
 const [overlayTokenLoading, setOverlayTokenLoading] = useState(false);
 const swapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
 const audioCtxRef = useRef<AudioContext | null>(null);
 const confettiRef = useRef<HTMLCanvasElement | null>(null);
 const particlesRef = useRef<HTMLDivElement | null>(null);

 // === ROOM CLOSED HANDLER ===
 useEffect(() => {
   if (closed) {
     const msg =
       closed === "expired"   ? "La room a expiré." :
       closed === "empty"     ? "La room a été fermée (plus aucun joueur)." :
       closed === "not_found" ? "Room introuvable — le serveur a peut-être redémarré." :
       `Room fermée (${closed}).`;
     alert(msg);
     router.replace("/lobby");
   }
 }, [closed, router]);

 // === OVERLAY TOKEN — lazy fetch on first modal open ===
 useEffect(() => {
   if (!showOverlays || overlayToken || overlayTokenLoading) return;
   setOverlayTokenLoading(true);
   fetch("/api/me/overlay-token")
     .then((r) => (r.ok ? r.json() : null))
     .then((d: { token?: string } | null) => { if (d?.token) setOverlayToken(d.token); })
     .catch(() => {})
     .finally(() => setOverlayTokenLoading(false));
 }, [showOverlays, overlayToken, overlayTokenLoading]);


 // === OWNERSHIP FETCH ===
 // For every Steam-backed game in the current run, ask /api/steam/owns whether
 // *I* own it. Publish the result into shared state so other members see the
 // same matrix. Each client only ever publishes its own row of the map.
 const runAppIdsKey = state.run
   .map((id) => POOL.find((g) => g.id === id)?.appid)
   .filter((a): a is number => typeof a === "number")
   .join(",");
 useEffect(() => {
   if (!me) return;
   // Guests have no Steam library to query — leave ownership map empty so the
   // chips render as "unknown" without burning an API round-trip per run.
   if (isGuestId(me.steamId)) return;
   if (!runAppIdsKey) return;
   const runAppIds = runAppIdsKey.split(",").map(Number).filter((n) => Number.isFinite(n));
   if (runAppIds.length === 0) return;

   let cancelled = false;
   // refresh=true so we bypass any stale per-appid cache on the server side
   // (the upstream Steam call is still gated by a 5-minute library cache, so
   // this isn't a free pass to hammer the API). Always re-fetching on mount /
   // run change also means a flipped privacy setting or a newly-bought game
   // shows up on the next page load instead of waiting 10 minutes.
   fetch("/api/steam/owns?refresh=true", {
     method: "POST",
     headers: { "Content-Type": "application/json" },
     body: JSON.stringify({ appIds: runAppIds }),
   })
     .then((r) => (r.ok ? r.json() : null))
     .then((data: { results?: Record<string, boolean | "unknown"> } | null) => {
       if (cancelled || !data?.results) return;
       const updates: Record<string, boolean> = {};
       for (const [appid, owned] of Object.entries(data.results)) {
         // Skip "unknown" — leave the slot empty so the next mount retries.
         if (typeof owned === "boolean") updates[appid] = owned;
       }
       if (Object.keys(updates).length === 0) return;
       setState((s) => ({
         ...s,
         ownership: {
           ...(s.ownership ?? {}),
           [me.steamId]: { ...(s.ownership?.[me.steamId] ?? {}), ...updates },
         },
       }));
     })
     .catch(() => {});

   return () => { cancelled = true; };
 }, [me?.steamId, runAppIdsKey, setState]);




  // === LIVE TIMER (ticks every second while run active) ===
  useEffect(() => {
    if (!state.runStartTime || state.run.length === 0 || state.done.length === state.run.length) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [state.runStartTime, state.run.length, state.done.length]);

  // === COUNTDOWN — ticks while countdownStartedAt is set ===
  useEffect(() => {
    if (state.countdownStartedAt === null) return;
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [state.countdownStartedAt]);

  // === LAUNCH — host-only commit when the countdown finishes ===
  // We funnel the "commit run" mutation through the host so two clients can't
  // race to set runStartTime. Every other client just renders the countdown.
  useEffect(() => {
    if (!isHost) return;
    if (state.countdownStartedAt === null) return;
    if (!state.pendingRun) return;
    const elapsed = Date.now() - state.countdownStartedAt;
    const remaining = COUNTDOWN_MS - elapsed + 600; // small "GO" tail
    const launch = () => {
      setState((s) => {
        if (!s.pendingRun) return s;
        return {
          ...s,
          run: s.pendingRun,
          current: 0,
          done: [],
          champions: {},
          attempt: 1,
          runStartTime: Date.now(),
          timerDeadline: null,
          runFails: {},
          pendingRun: null,
          readyPlayers: [],
          countdownStartedAt: null,
        };
      });
    };
    if (remaining <= 0) {
      launch();
      return;
    }
    const t = setTimeout(launch, remaining);
    return () => clearTimeout(t);
  }, [isHost, state.countdownStartedAt, state.pendingRun, setState]);

 // === SLOT MACHINE ANIMATION ===
 // Driven entirely by `state.drawing`. Every client receiving the broadcast
 // runs its own local rAF, but the animation timing is wall-clock based on
 // `drawing.startedAt`, so late-arriving receivers fast-forward to the right
 // frame instead of replaying from zero. Only the initiator writes the
 // result back into `state.champions`, avoiding multi-writer races.
 useEffect(() => {
   const drawing = state.drawing;
   if (!drawing) return;

   initAudio();

   let cancelled = false;
   const stripCellHeight = 32;
   const cyclesForReel = (r: number) => 10 + r * 4;

   const runReel = (r: number): Promise<void> => {
     const strip = document.getElementById(`strip${r}`) as HTMLDivElement | null;
     if (!strip) return Promise.resolve();
     const totalCells = cyclesForReel(r) + 1;
     const targetY = (totalCells - 1) * stripCellHeight;
     const duration = 1200 + r * 400;
     return new Promise<void>((resolve) => {
       let lastCell = -1;
       const frame = () => {
         if (cancelled) return resolve();
         const elapsed = Date.now() - drawing.startedAt;
         const t = Math.min(1, elapsed / duration);
         const ease = 1 - Math.pow(1 - t, 3);
         const y = ease * targetY;
         strip.style.transform = `translateY(-${y}px)`;
         if (t < 1) {
           const cellsPassed = Math.floor(y / stripCellHeight);
           if (cellsPassed !== lastCell) {
             lastCell = cellsPassed;
             beep(300 + Math.random() * 200, 0.04, "square", 0.05);
           }
           requestAnimationFrame(frame);
         } else {
           beep(800, 0.08, "triangle", 0.18);
           resolve();
         }
       };
       requestAnimationFrame(frame);
     });
   };

   // One-frame delay so the slot DOM is committed before we read strip refs.
   const rafId = requestAnimationFrame(() => {
     Promise.all(drawing.final.map((_, r) => runReel(r))).then(() => {
       if (cancelled) return;
       if (drawing.initiator !== me?.steamId) return;
       setTimeout(() => {
         if (cancelled) return;
         const finalName = formatChampion(drawing.final, drawing.pairSize);
         setState((s) => ({
           ...s,
           champions: { ...s.champions, [drawing.gameId]: finalName },
           drawing: null,
         }));
       }, 350);
     });
   });

   return () => {
     cancelled = true;
     cancelAnimationFrame(rafId);
   };
   // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [state.drawing?.startedAt, state.drawing?.gameId, state.drawing?.initiator, me?.steamId]);

 // === SOUND ===
 const initAudio = () => {
 if (!audioCtxRef.current) {
 try {
 const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
 audioCtxRef.current = new Ctx();
 } catch (e) {
 console.warn("Audio not supported");
 }
 }
 };
 const beep = (freq: number, duration: number, type: OscillatorType = "sine", volume = 0.15) => {
 if (!state.soundEnabled || !audioCtxRef.current) return;
 const ctx = audioCtxRef.current;
 const osc = ctx.createOscillator();
 const gain = ctx.createGain();
 osc.type = type;
 osc.frequency.value = freq;
 gain.gain.setValueAtTime(volume, ctx.currentTime);
 gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
 osc.connect(gain).connect(ctx.destination);
 osc.start();
 osc.stop(ctx.currentTime + duration);
 };
 const playClick = () => {
 if (!state.soundEnabled) return;
 initAudio();
 beep(800, 0.04, "square", 0.07);
 };
 const playLose = () => {
 if (!state.soundEnabled) return;
 initAudio();
 [400, 300, 200, 100].forEach((f, i) => setTimeout(() => beep(f, 0.3, "sawtooth", 0.18), i * 100));
 };
 const playGauntletWin = () => {
 if (!state.soundEnabled) return;
 initAudio();
 [523, 659, 784, 1047, 1319, 1568, 2093].forEach((f, i) =>
 setTimeout(() => beep(f, 0.18, "triangle", 0.2), i * 100)
 );
 };

 // First click unlocks audio context (browser policy)
 useEffect(() => {
 const handler = () => initAudio();
 document.addEventListener("click", handler, { once: true });
 return () => document.removeEventListener("click", handler);
 }, []);

 // === CONFETTI ===
 const fireConfetti = (intensity = 1) => {
 const canvas = confettiRef.current;
 if (!canvas) return;
 const ctx = canvas.getContext("2d");
 if (!ctx) return;
 canvas.width = window.innerWidth;
 canvas.height = window.innerHeight;
 const colors = ["#00f0a8", "#7c5cff", "#ffd23f", "#ff3860", "#ffffff"];
 const count = Math.floor(180 * intensity);
 type P = { x: number; y: number; vx: number; vy: number; g: number; size: number; color: string; rot: number; vr: number; life: number };
 const particles: P[] = [];
 for (let i = 0; i < count; i++) {
 particles.push({
 x: canvas.width / 2 + (Math.random() - 0.5) * 200,
 y: canvas.height / 2,
 vx: (Math.random() - 0.5) * 18,
 vy: (Math.random() - 1) * 14 - 6,
 g: 0.4,
 size: 4 + Math.random() * 6,
 color: colors[Math.floor(Math.random() * colors.length)],
 rot: Math.random() * 360,
 vr: (Math.random() - 0.5) * 12,
 life: 0,
 });
 }
 let frame = 0;
 const tick = () => {
 ctx.clearRect(0, 0, canvas.width, canvas.height);
 let alive = 0;
 particles.forEach((p) => {
 if (p.y > canvas.height + 50) return;
 alive++;
 p.vy += p.g;
 p.x += p.vx;
 p.y += p.vy;
 p.rot += p.vr;
 p.life++;
 ctx.save();
 ctx.translate(p.x, p.y);
 ctx.rotate((p.rot * Math.PI) / 180);
 ctx.fillStyle = p.color;
 ctx.globalAlpha = Math.max(0, 1 - p.life / 200);
 ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.4);
 ctx.restore();
 });
 frame++;
 if (alive > 0 && frame < 400) requestAnimationFrame(tick);
 else ctx.clearRect(0, 0, canvas.width, canvas.height);
 };
 requestAnimationFrame(tick);
 };

 // Resize confetti canvas on window resize
 useEffect(() => {
 const onResize = () => {
 const c = confettiRef.current;
 if (c) {
 c.width = window.innerWidth;
 c.height = window.innerHeight;
 }
 };
 window.addEventListener("resize", onResize);
 return () => window.removeEventListener("resize", onResize);
 }, []);

 // === BACKGROUND PARTICLES ===
 useEffect(() => {
 const interval = setInterval(() => {
 if (document.hidden || !particlesRef.current) return;
 const p = document.createElement("div");
 const colorClass = ["", "purple", "gold"][Math.floor(Math.random() * 3)];
 p.className = "particle " + colorClass;
 p.style.left = Math.random() * 100 + "vw";
 const dur = 8 + Math.random() * 12;
 p.style.animationDuration = dur + "s";
 particlesRef.current.appendChild(p);
 setTimeout(() => p.remove(), dur * 1000);
 }, 700);
 return () => clearInterval(interval);
 }, []);

 // === TILT 3D ===
 useEffect(() => {
 const cards = document.querySelectorAll<HTMLDivElement>(".game.tiltable");
 const handlers: Array<{ el: HTMLDivElement; move: (e: MouseEvent) => void; leave: () => void }> = [];
 cards.forEach((card) => {
 const move = (e: MouseEvent) => {
 const rect = card.getBoundingClientRect();
 const x = (e.clientX - rect.left) / rect.width - 0.5;
 const y = (e.clientY - rect.top) / rect.height - 0.5;
 card.style.transform = `perspective(900px) rotateX(${-y * 4}deg) rotateY(${x * 6}deg)`;
 };
 const leave = () => {
 card.style.transform = "";
 };
 card.addEventListener("mousemove", move);
 card.addEventListener("mouseleave", leave);
 handlers.push({ el: card, move, leave });
 });
 return () => {
 handlers.forEach((h) => {
 h.el.removeEventListener("mousemove", h.move);
 h.el.removeEventListener("mouseleave", h.leave);
 });
 };
 }, [state.run, state.current, state.done.length, state.drawing?.gameId]);

 // === SHAKE ===
 const shakeScreen = () => {
 setShaking(false);
 setTimeout(() => setShaking(true), 10);
 setTimeout(() => setShaking(false), 600);
 };

 useEffect(() => {
 document.body.classList.toggle("shake", shaking);
 }, [shaking]);

 // === HELPERS ===
 const update = (patch: Partial<GauntletState>) => setState((s) => {
   const next = { ...s, ...patch };
   // If runLength shrinks, trim pinned to the new cap (floor(runLength / 2)).
   if (patch.runLength !== undefined) {
     const cap = Math.max(1, Math.floor(next.runLength / 2));
     if (next.pinned.length > cap) next.pinned = next.pinned.slice(0, cap);
   }
   return next;
 });

 const leaveRoom = async () => {
   await fetch(`/api/room/${roomCode}/leave`, { method: "POST" }).catch(() => {});
   router.push("/lobby");
 };

 // Suggest the next available NATO-letter name so successive bots are easy to
 // tell apart in the slot machine.
 const nextDefaultBotName = (): string => {
   const NATO = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel"];
   const taken = new Set(members.map((m) => m.displayName.trim()));
   for (const w of NATO) {
     const candidate = `Bot ${w}`;
     if (!taken.has(candidate)) return candidate;
   }
   return `Bot ${members.length + 1}`;
 };

 const promptAddBot = () => {
   const name = window.prompt("Nom du bot :", nextDefaultBotName());
   if (name === null) return;
   const trimmed = name.trim();
   if (trimmed.length < 1) return;
   addBot(trimmed);
 };

 const copyRoomLink = async () => {
   // Static export ne supporte pas /room/[code], on utilise le query param qui
   // est lu par useSearchParams dans RoomPageInner.
   const url = `${window.location.origin}/room?code=${encodeURIComponent(roomCode)}`;
   try {
     await navigator.clipboard.writeText(url);
   } catch {
     window.prompt("Copie ce lien:", url);
   }
 };

 // Pinned cap scales with run length — half the run, rounded down. Keeps the
 // original 5-pin cap at 10 games while adapting (2 pins for 5 games, etc).
 const pinCap = (rl: number) => Math.max(1, Math.floor(rl / 2));
 const togglePin = (id: number) => {
 setState((s) => {
 if (s.pinned.includes(id)) {
 return { ...s, pinned: s.pinned.filter((x) => x !== id) };
 }
 const cap = pinCap(s.runLength ?? 10);
 if (s.pinned.length < cap) {
 playClick();
 return { ...s, pinned: [...s.pinned, id] };
 }
 alert(`Maximum ${cap} jeu${cap > 1 ? "x" : ""} épinglé${cap > 1 ? "s" : ""} pour une run de ${s.runLength ?? 10}. Augmente la longueur ou retire-en un.`);
 return s;
 });
 };

 const generateRun = async () => {
 if (!isHost) {
   alert("Seul l'hôte peut générer la run.");
   return;
 }
 const pinned = [...state.pinned];
 // When library-only mode is on, fetch every member's library and shrink the
 // candidate pool to games every human owns. Pinned games are kept as-is —
 // they're an explicit override.
 let candidates = POOL.filter((g) => !pinned.includes(g.id));
 if (state.libraryOnlyMode) {
   try {
     const r = await fetch(`/api/steam/room-libraries/${roomCode}`, { credentials: "include" });
     if (!r.ok) throw new Error(`HTTP ${r.status}`);
     const data = await r.json() as { libraries: Record<string, { appIds: number[]; visible: boolean }> };
     const libs = Object.values(data.libraries).filter((l) => l.visible);
     if (libs.length === 0) {
       alert("Bibliothèques Steam privées — impossible de filtrer. Désactive le mode ou rends ta bibliothèque publique.");
       return;
     }
     const ownedSets = libs.map((l) => new Set(l.appIds));
     candidates = candidates.filter((g) => {
       if (!g.appid) return false; // library-only mode excludes non-Steam games
       // Only one member needs to own the game — the team can rely on that
       // person to run / share it.
       return ownedSets.some((s) => s.has(g.appid as number));
     });
   } catch (e) {
     console.warn("[generateRun] library fetch failed", e);
     alert("Impossible de récupérer les bibliothèques Steam.");
     return;
   }
 }
 const runLength = Math.max(1, Math.min(10, state.runLength || 10));
 // Pinned games can never exceed the chosen run length — trim if needed.
 if (pinned.length > runLength) pinned.length = runLength;
 const remainingNeeded = runLength - pinned.length;
 if (remainingNeeded > candidates.length) {
   alert(
     state.libraryOnlyMode
       ? `Seulement ${candidates.length} jeu(x) dans la bibliothèque commune — il en faut ${remainingNeeded}.`
       : "Pas assez de jeux dans le pool !",
   );
   return;
 }
 let picks: number[];
 if (state.leastPlayedMode) {
   // Sort candidates by ascending play count, with a random tiebreak so two
   // runs of the same N rarely produce the same first slice. Then take the
   // top-N least played.
   let counts: Record<number, number> = {};
   try {
     const humanIds = members.filter((m) => !isSyntheticId(m.steamId)).map((m) => m.steamId);
     if (humanIds.length > 0) {
       const r = await fetch(`/api/stats/play-counts?steamIds=${humanIds.join(",")}`);
       if (r.ok) {
         const data = await r.json() as { counts: Record<number, number> };
         counts = data.counts ?? {};
       }
     }
   } catch (e) {
     console.warn("[generateRun] play-counts fetch failed", e);
   }
   const weighted = candidates
     .map((g) => ({ g, plays: counts[g.id] ?? 0, jitter: Math.random() }))
     .sort((a, b) => a.plays - b.plays || a.jitter - b.jitter);
   picks = weighted.slice(0, remainingNeeded).map((x) => x.g.id);
 } else {
   picks = shuffle(candidates).slice(0, remainingNeeded).map((g) => g.id);
 }
 const run = shuffle([...pinned, ...picks]);
 setState((s) => ({
   ...s,
   pendingRun: run,
   readyPlayers: [],
   countdownStartedAt: null,
 }));
 playClick();
 };

 const swapInPending = (gameId: number) => {
 if (!isHost) return;
 const pr = state.pendingRun;
 if (!pr) return;
 const idx = pr.indexOf(gameId);
 if (idx === -1) return;
 const available = POOL.filter((g) => !pr.includes(g.id));
 if (available.length === 0) {
 alert("Plus aucun jeu disponible dans le pool pour swap.");
 return;
 }
 const newGame = available[Math.floor(Math.random() * available.length)];
 const newRun = [...pr];
 newRun[idx] = newGame.id;
 // Swapping invalidates everyone's ready state — they need to re-confirm.
 setState((s) => ({ ...s, pendingRun: newRun, readyPlayers: [] }));
 playClick();
 };

 // Toggle the current player's ready state.
 const toggleReady = () => {
 if (!me) return;
 if (!state.pendingRun) return;
 if (state.countdownStartedAt !== null) return;
 setState((s) => {
   const ready = new Set(s.readyPlayers ?? []);
   if (ready.has(me.steamId)) ready.delete(me.steamId); else ready.add(me.steamId);
   return { ...s, readyPlayers: Array.from(ready) };
 });
 playClick();
 };

 // Launch the countdown. Triggered manually by the host, or automatically
 // when every human member is ready.
 const launchCountdown = () => {
 if (!state.pendingRun) return;
 if (state.countdownStartedAt !== null) return;
 const ups: Record<string, { joker: number; shield: number; reroll: number }> = {};
 if (state.powerUpsEnabled !== false) {
   members.forEach((m) => { ups[m.steamId] = { joker: 1, shield: 1, reroll: 1 }; });
 }
 setState((s) => ({
   ...s,
   countdownStartedAt: Date.now(),
   powerUps: ups,
   shieldActive: false,
 }));
 playClick();
 };

 const cancelReview = () => {
 if (!isHost) return;
 setState((s) => ({
   ...s,
   pendingRun: null,
   readyPlayers: [],
   countdownStartedAt: null,
 }));
 };

 const steamSearchUrl = (name: string) =>
 `https://store.steampowered.com/search/?term=${encodeURIComponent(name)}`;

 const elapsed = state.runStartTime && state.run.length > 0 ? now - state.runStartTime : 0;

 const rerollRun = () => {
 if (state.run.length === 0) return;
 if (state.done.length > 0 && !confirm("Une run est en cours. Re-roll va tout remettre à zéro. Continuer ?")) return;
 generateRun();
 };

 const swapGame = (gameId: number) => {
 if (state.done.includes(gameId)) {
 alert("Ce jeu est déjà validé, impossible de le swap.");
 return;
 }
 const idx = state.run.indexOf(gameId);
 if (idx === -1) return;
 const available = POOL.filter((g) => !state.run.includes(g.id));
 if (available.length === 0) {
 alert("Plus aucun jeu disponible dans le pool pour swap.");
 return;
 }
 const newGame = available[Math.floor(Math.random() * available.length)];
 const newRun = [...state.run];
 newRun[idx] = newGame.id;
 const newPinned = state.pinned.filter((x) => x !== gameId);
 const newChampions = { ...state.champions };
 delete newChampions[gameId];
 setSwappedIdx(idx);
 if (swapTimer.current) clearTimeout(swapTimer.current);
 swapTimer.current = setTimeout(() => setSwappedIdx(null), 700);
 setState((s) => ({ ...s, run: newRun, pinned: newPinned, champions: newChampions }));
 playClick();
 };

 // === POWER-UPS ===
 const useJoker = (steamId: string) => {
   setState((s) => {
     const pu = s.powerUps[steamId];
     if (!pu || pu.joker <= 0 || s.run.length === 0) return s;
     const undone = s.run.filter((id) => !s.done.includes(id));
     if (undone.length === 0) return s;
     const gameToSwap = undone[Math.floor(Math.random() * undone.length)];
     const idx = s.run.indexOf(gameToSwap);
     const available = POOL.filter((g) => !s.run.includes(g.id));
     if (available.length === 0) return s;
     const newGame = available[Math.floor(Math.random() * available.length)];
     const newRun = [...s.run];
     newRun[idx] = newGame.id;
     const newPinned = s.pinned.filter((x) => x !== gameToSwap);
     const newChampions = { ...s.champions };
     delete newChampions[gameToSwap];
     return {
       ...s,
       run: newRun,
       pinned: newPinned,
       champions: newChampions,
       powerUps: { ...s.powerUps, [steamId]: { ...pu, joker: pu.joker - 1 } },
     };
   });
   playClick();
 };

 const useShield = (steamId: string) => {
   setState((s) => {
     const pu = s.powerUps[steamId];
     if (!pu || pu.shield <= 0 || s.shieldActive) return s;
     return {
       ...s,
       shieldActive: true,
       powerUps: { ...s.powerUps, [steamId]: { ...pu, shield: pu.shield - 1 } },
     };
   });
   playClick();
 };

 const useReroll = (steamId: string) => {
   const currentGameId = state.run[state.current];
   if (!currentGameId) return;
   if (!state.champions[currentGameId]) return;
   const currentGame = POOL.find((g) => g.id === currentGameId);
   if (!currentGame) return;
   const effMode = effectiveMode(currentGame, state.difficulty);
   if (effMode !== "solo" && effMode !== "duo") return;
   setState((s) => {
     const pu = (s.powerUps ?? {})[steamId];
     if (!pu || pu.reroll <= 0) return s;
     const newChampions = { ...s.champions };
     delete newChampions[currentGameId];
     return {
       ...s,
       champions: newChampions,
       powerUps: { ...s.powerUps, [steamId]: { ...pu, reroll: pu.reroll - 1 } },
     };
   });
   setTimeout(() => drawChampion(currentGameId, effMode as "solo" | "duo"), 80);
 };

 // === OWNERSHIP OVERRIDE ===
 // Click your own avatar on a game card to claim/un-claim ownership when Steam
 // can't see your library (private game-details setting) or just got it wrong.
 // Cycles: unknown/missing → owned → not owned → owned → … Steam-fetched data
 // stays in `ownership`; this only writes to `ownershipOverride`, which the
 // chip renderer prefers when present.
 const toggleOwnershipOverride = (appid: number) => {
   if (!me) return;
   const key = String(appid);
   setState((s) => {
     const myOverrides = { ...(s.ownershipOverride?.[me.steamId] ?? {}) };
     const current = myOverrides[key];
     const auto = s.ownership?.[me.steamId]?.[key];
     const displayed = current !== undefined ? current : auto;
     myOverrides[key] = displayed !== true; // unknown/false → true ; true → false
     return {
       ...s,
       ownershipOverride: {
         ...(s.ownershipOverride ?? {}),
         [me.steamId]: myOverrides,
       },
     };
   });
   playClick();
 };

 // === SLOT MACHINE DRAW ===
 const drawChampion = (gameId: number, mode: "solo" | "duo") => {
 const players = members.map((m) => m.displayName).filter((p) => p && p.trim());
 if (players.length === 0) {
 alert("Aucun joueur dans la room !");
 return;
 }
 if (mode === "duo" && players.length < 2) {
 alert("Il faut au moins 2 joueurs pour un duo.");
 return;
 }
 initAudio();

 // Decide who's drawn and how the slots are partitioned.
 //   solo:               1 player    → pairSize = 1, final.length = 1
 //   duo with 2 players: 1 duo       → pairSize = 2, final.length = 2 (A & B)
 //   duo with 4 players: 2 duos      → pairSize = 2, final.length = 4 (A & B · C & D)
 //   duo with N players (N>=2):      → pairSize = 2, final.length = 2*floor(N/2)
 // Duos are cooperating pairs running the objective independently — they're
 // not opposing teams. Any leftover odd player is benched.
 let final: string[];
 let pairSize: number;
 if (mode === "duo") {
 const numDuos = Math.max(1, Math.floor(players.length / 2));
 const drawn = numDuos * 2;
 final = shuffle(players).slice(0, drawn);
 pairSize = 2;
 } else {
 final = [players[Math.floor(Math.random() * players.length)]];
 pairSize = 1;
 }

 const reelCount = final.length;
 // Stagger the reels so each one finishes a beat after the previous; keeps the
 // animation feeling weighty even when the draw expands to 6 reels (3v3).
 const cyclesForReel = (r: number) => 10 + r * 4;
 const reels: string[][] = [];
 for (let r = 0; r < reelCount; r++) {
 const cells: string[] = [];
 const totalCells = cyclesForReel(r) + 1;
 for (let i = 0; i < totalCells; i++) {
 cells.push(i === totalCells - 1 ? final[r] : players[Math.floor(Math.random() * players.length)]);
 }
 reels.push(cells);
 }

 // Push the draw into synced state — every client reads `state.drawing` and
 // runs the local rAF animation in the effect below. Animation start time is
 // wall-clock so late receivers catch up to the right frame instead of
 // replaying from zero.
 setState((s) => ({
   ...s,
   drawing: {
     gameId,
     reels,
     final,
     pairSize,
     startedAt: Date.now(),
     initiator: me?.steamId ?? "",
   },
 }));
 };

 // === HISTORY ===
 const logRunToHistory = (
 s: GauntletState,
 outcome: "win" | "lose",
 failedGameId: number | null = null
 ): RunHistoryEntry[] => {
 if (!s.runStartTime) return s.history;
 const entry: RunHistoryEntry = {
 id: Date.now(),
 ts: Date.now(),
 outcome,
 attempts: s.attempt,
 duration: Date.now() - s.runStartTime,
 difficulty: s.difficulty,
 penaltyMode: s.penaltyMode,
 runIds: [...s.run],
 failedGameId,
 championPicks: { ...s.champions },
 completed: s.done.length,
 total: s.run.length,
 };
 return [entry, ...(s.history || [])].slice(0, 50);
 };

 // === PER-GAME COUNTDOWN (only for games with `timer: true`) ===
 // Now goes through the websocket: the server stamps `timerDeadline` so every
 // client converges on the same remaining time regardless of clock skew.
 const startTimer = (minutes: number) => {
   const m = Number.isFinite(minutes) && minutes > 0 ? Math.min(minutes, 120) : 5;
   socketStartTimer(m);
 };
 const resetTimer = () => socketClearTimer();

 // === VERSUS — auto-assigns humans into red/blue teams, alternating ===
 const assignVersusTeams = () => {
   if (!isHost) return;
   const humans = members.filter((m) => !isSyntheticId(m.steamId));
   const shuffled = shuffle(humans);
   const teams: Record<string, "red" | "blue"> = {};
   shuffled.forEach((m, i) => { teams[m.steamId] = i % 2 === 0 ? "red" : "blue"; });
   setState((s) => ({ ...s, versusMode: true, teams, gameWinners: {} }));
   playClick();
 };

 // Toggle a single player's team — host can rebalance manually.
 const togglePlayerTeam = (steamId: string) => {
   if (!isHost) return;
   setState((s) => {
     const current = s.teams[steamId];
     const next = current === "red" ? "blue" : "red";
     return { ...s, teams: { ...s.teams, [steamId]: next } };
   });
 };

 // Versus score derived from gameWinners.
 const versusScore = (() => {
   let red = 0, blue = 0;
   for (const t of Object.values(state.gameWinners)) {
     if (t === "red") red++; else if (t === "blue") blue++;
   }
   return { red, blue };
 })();

 // === VERSUS — one team scores the current game ===
 const winVersusGame = (gameId: number, team: "red" | "blue") => {
   setState((s) => {
     if (s.done.includes(gameId)) return s;
     const newDone = [...s.done, gameId];
     const newCurrent = s.current + 1;
     const winners = { ...s.gameWinners, [gameId]: team };
     let next: GauntletState = {
       ...s,
       done: newDone,
       current: newCurrent,
       gameWinners: winners,
       timerDeadline: null,
     };
     if (newDone.length === s.run.length) {
       next = { ...next, history: logRunToHistory({ ...next }, "win") };
     }
     return next;
   });
   playClick();
 };

 // === WIN / LOSE ===
 const winGame = (gameId: number) => {
 setState((s) => {
 if (s.done.includes(gameId)) return s;
 const newDone = [...s.done, gameId];
 const newCurrent = s.current + 1;
 let next: GauntletState = { ...s, done: newDone, current: newCurrent, timerDeadline: null };
 if (newDone.length === s.run.length) {
 // FULL GAUNTLET — append the history entry; the celebration useEffect
 // below picks up the new history[0].id and fires confetti + overlay.
 // Same code path also handles Twitch-triggered skips that complete the
 // gauntlet (server appends history, client sees it, useEffect fires).
 next = { ...next, history: logRunToHistory({ ...next }, "win") };
 }
 return next;
 });
 playClick();
 fireConfetti(0.15);
 };

 // Win-celebration trigger — fires once per winning history entry, regardless
 // of whether the gauntlet was completed locally (winGame) or remotely
 // (Twitch skip effect). Deduped via a ref keyed on the entry id.
 const celebratedWinIdRef = useRef<number | null>(null);
 useEffect(() => {
   const top = state.history[0];
   if (!top || top.outcome !== "win") return;
   if (state.run.length === 0 || state.done.length !== state.run.length) return;
   if (celebratedWinIdRef.current === top.id) return;
   celebratedWinIdRef.current = top.id;
   const t = setTimeout(() => {
     fireConfetti(2);
     playGauntletWin();
     setOverlay({ kind: "win" });
   }, 400);
   return () => clearTimeout(t);
 }, [state.history, state.run.length, state.done.length]);

 const loseGame = (gameId: number) => {
 setState((s) => {
   if (s.shieldActive) {
     const g = POOL.find((x) => x.id === gameId);
     const msg = `Défaite sur ${g?.name ?? "ce jeu"} — le Bouclier a absorbé la pénalité !`;
     setOverlay({ kind: "lose", msg });
     return { ...s, shieldActive: false };
   }
 const g = POOL.find((x) => x.id === gameId);
 const idx = s.run.indexOf(gameId);
 const runFails = { ...s.runFails, [gameId]: (s.runFails[gameId] || 0) + 1 };
 let msg = "";
 let next: GauntletState;

 if (s.penaltyMode === "stepback") {
 if (idx <= 0) {
 msg = `Défaite sur ${g?.name ?? "ce jeu"}. Tu es au jeu 1, impossible de reculer plus — réessaye !`;
 next = { ...s, attempt: s.attempt + 1, runFails, timerDeadline: null };
 } else {
 const prevGameId = s.run[idx - 1];
 const prevG = POOL.find((x) => x.id === prevGameId);
 msg = `Défaite sur ${g?.name ?? "ce jeu"}. Tu recules d'un jeu : retour sur ${prevG?.name ?? "le jeu précédent"} (jeu #${idx}).`;
 next = {
 ...s,
 attempt: s.attempt + 1,
 current: idx - 1,
 done: s.done.filter((x) => x !== prevGameId),
 runFails,
 timerDeadline: null,
 };
 }
 } else {
 // Reset complet — log this run as failed
 msg = `Défaite sur ${g?.name ?? "ce jeu"}. Tentative #${s.attempt + 1} — la run recommence depuis le jeu 1.`;
 const newHistory = logRunToHistory(s, "lose", gameId);
 next = {
 ...s,
 attempt: s.attempt + 1,
 current: 0,
 done: [],
 champions: {},
 runStartTime: Date.now(),
 timerDeadline: null,
 runFails: {},
 history: newHistory,
 };
 }

 setOverlay({ kind: "lose", msg });
 return next;
 });
 shakeScreen();
 playLose();
 };

 const fullReset = () => {
 setState((s) => ({
 ...s,
 attempt: 1,
 current: 0,
 done: [],
 champions: {},
 run: [],
 runStartTime: null,
 timerDeadline: null,
 runFails: {},
 }));
 };

 const hardReset = () => {
 if (!confirm("Reset complet ? Toute la progression et les épinglages seront effacés.")) return;
 setState((s) => ({
 ...DEFAULT_STATE,
 difficulty: s.difficulty,
 penaltyMode: s.penaltyMode,
 players: s.players,
 playerCount: s.playerCount,
 soundEnabled: s.soundEnabled,
 history: s.history,
 }));
 };

 // === STATS ===
 const computeStats = () => {
 const h = state.history || [];
 const total = h.length;
 const wins = h.filter((x) => x.outcome === "win").length;
 const successRate = total > 0 ? Math.round((wins / total) * 100) : 0;
 const totalDuration = h.reduce((acc, x) => acc + (x.duration || 0), 0);
 const avgAttempts =
 total > 0 ? (h.reduce((a, x) => a + (x.attempts || 1), 0) / total).toFixed(1) : "0";
 const failedCounts: Record<number, number> = {};
 h.filter((x) => x.outcome === "lose" && x.failedGameId).forEach((x) => {
 const id = x.failedGameId as number;
 failedCounts[id] = (failedCounts[id] || 0) + 1;
 });
 let mostFailedId: number | null = null;
 let mostFailedCount = 0;
 Object.entries(failedCounts).forEach(([id, c]) => {
 if (c > mostFailedCount) {
 mostFailedCount = c;
 mostFailedId = parseInt(id);
 }
 });
 const mostFailedGame = mostFailedId ? POOL.find((g) => g.id === mostFailedId) : null;
 const championCounts: Record<string, number> = {};
 h.forEach((x) => {
 Object.values(x.championPicks || {}).forEach((name) => {
 String(name).split(" & ").forEach((n) => {
 championCounts[n] = (championCounts[n] || 0) + 1;
 });
 });
 });
 let topChampion = "—";
 let topChampionCount = 0;
 Object.entries(championCounts).forEach(([name, c]) => {
 if (c > topChampionCount) {
 topChampionCount = c;
 topChampion = name;
 }
 });
 return { total, wins, successRate, totalDuration, avgAttempts, mostFailedGame, mostFailedCount, topChampion, topChampionCount };
 };

 // === DERIVED ===
 const filteredPool = POOL.filter(
 (g) =>
 (localFilter === "all" || g.cat === localFilter) &&
 (!localSearch || g.name.toLowerCase().includes(localSearch.toLowerCase()))
 ).sort((a, b) => {
   const aPinned = state.pinned.includes(a.id);
   const bPinned = state.pinned.includes(b.id);
   if (aPinned !== bPinned) return aPinned ? -1 : 1;
   return a.name.localeCompare(b.name, "fr", { sensitivity: "base" });
 });
 const progressPct = state.run.length === 0 ? 0 : (state.done.length / state.run.length) * 100;
 // Lock config once a run is active (run generated + countdown done)
 const runLocked = state.run.length > 0;
 // Player slots: every member + one waiting placeholder, with a minimum of 3
 // (so an empty room still shows the familiar layout). Capped at the server's
 // 8-member limit.
 const MAX_MEMBERS = 8;
 const slotCount = Math.min(MAX_MEMBERS, Math.max(3, members.length + 1));
 const playerSlots = Array.from({ length: slotCount }, (_, i) => i);

 if (!hydrated) {
 return (
 <div className="container">
 <div className="hero">
 <h1>GAUNTLET CHALLENGE</h1>
 <div className="subtitle">Chargement…</div>
 </div>
 </div>
 );
 }

 const stats = computeStats();
 const totalSegs = state.run.length || 10;

 return (
 <>
 {/* Background particles */}
 <div id="bgParticles"ref={particlesRef}></div>
 {/* Confetti canvas */}
 <canvas id="confettiCanvas"ref={confettiRef}></canvas>

 <div className="room-layout">
 {/* Mirror spacer — keeps `room-main` centered between the spacer (left) and
     the Atouts sidebar (right). Rendered only when the sidebar is rendered. */}
 {state.powerUpsEnabled !== false && <div className="room-spacer" aria-hidden="true" />}
 <div className="room-main">
 {/* ROOM BANNER */}
 <div className="room-banner">
   <div className="room-banner-info">
     <span className="room-banner-label">Room</span>
     <span className="room-banner-code">{roomCode}</span>
     <span className="room-banner-members">{members.length} joueur{members.length > 1 ? "s" : ""}</span>
     <span className={`room-sync-status ${connected ? "ok" : "lost"}`} title={connected ? "Sync en temps réel active" : "Connexion perdue — les actions ne se synchronisent pas"}>
       <span className="room-sync-dot"></span>
       {connected ? "Sync" : "Hors-ligne"}
     </span>
   </div>
   <div className="room-banner-actions">
     <button className="room-banner-btn" onClick={copyRoomLink} title="Copier le lien d'invitation">Inviter</button>
     <button className="room-banner-btn" onClick={() => setShowOverlays(true)} title="Liens des overlays Twitch (OBS)">Overlays</button>
     <button className="room-banner-btn room-banner-leave" onClick={leaveRoom}>Quitter</button>
   </div>
 </div>

 {/* HERO */}
 <div className="hero">
 <h1>GAUNTLET CHALLENGE</h1>
 <div className="subtitle">{state.run.length || (state.runLength ?? 10)} jeux · 0 défaite autorisée</div>
 <div className="lives">
            <span>#</span><span className="lives-num">{state.attempt}</span>
          </div>
          <div className="hero-meta">
            <span className={`hero-meta-pill ${state.difficulty}`}>
              <span className="dot"></span>
              {state.difficulty === "hardcore" ? "Hardcore" : "Normal"}
            </span>
            <span className="hero-meta-pill">
              <span className="dot"></span>
              {state.penaltyMode === "stepback" ? "Recule d'un jeu" : "Reset complet"}
            </span>
            <span className="hero-meta-pill">
              <span className="dot"></span>
              {members.length || 1} joueur{members.length > 1 ? "s" : ""}
            </span>
            {state.runStartTime && state.run.length > 0 && (
              <span className="hero-meta-pill timer">
                <span className="dot"></span>
                {fmtDuration(elapsed)}
              </span>
            )}
          </div>
          {state.versusMode && (
            <div className="vs-scoreboard" aria-label="Score Versus">
              <div className="vs-team vs-team-red">
                <div className="vs-team-label">Équipe Rouge</div>
                <div className="vs-team-score">{versusScore.red}</div>
                <div className="vs-team-roster">
                  {members
                    .filter((m) => state.teams[m.steamId] === "red")
                    .map((m) => (
                      <span
                        key={m.steamId}
                        className="vs-roster-chip"
                        title={isHost ? "Cliquer pour changer d'équipe" : m.displayName}
                        onClick={isHost ? () => togglePlayerTeam(m.steamId) : undefined}
                        role={isHost ? "button" : undefined}
                      >
                        <img src={m.avatarUrl} alt="" />
                        <span>{m.displayName}</span>
                      </span>
                    ))}
                </div>
              </div>
              <div className="vs-separator">VS</div>
              <div className="vs-team vs-team-blue">
                <div className="vs-team-label">Équipe Bleue</div>
                <div className="vs-team-score">{versusScore.blue}</div>
                <div className="vs-team-roster">
                  {members
                    .filter((m) => state.teams[m.steamId] === "blue")
                    .map((m) => (
                      <span
                        key={m.steamId}
                        className="vs-roster-chip"
                        title={isHost ? "Cliquer pour changer d'équipe" : m.displayName}
                        onClick={isHost ? () => togglePlayerTeam(m.steamId) : undefined}
                        role={isHost ? "button" : undefined}
                      >
                        <img src={m.avatarUrl} alt="" />
                        <span>{m.displayName}</span>
                      </span>
                    ))}
                </div>
              </div>
            </div>
          )}
 </div>

 {/* CONFIG — hidden once a run is generated. Reopens after Reset complet. */}
 {!runLocked && (
 <>
 <div className="panel">
 <h2>
   <span className="panel-title"><span className="panel-section-num">1</span> Configuration</span>
 </h2>
 <div className="setup-grid">
 {playerSlots.map((i) => {
 const member = members[i];
 return (
 <div className="field"key={i}>
 <label>Joueur {i + 1}</label>
 {member ? (
 <div className={`steam-link linked${isBotId(member.steamId) ? " bot" : ""}`}>
 <img src={member.avatarUrl} alt="" className="steam-link-avatar" />
 {isSyntheticId(member.steamId) ? (
   <span className="steam-link-name" title={isBotId(member.steamId) ? "Bot local" : "Joueur invité"}>{member.displayName}</span>
 ) : (
   <a className="steam-link-name" href={member.profileUrl} target="_blank" rel="noreferrer">{member.displayName}</a>
 )}
 {isBotId(member.steamId) && (
   <span className="steam-link-badge" title="Bot local">
     <Icon name="bot" size={12} />
     BOT
   </span>
 )}
 {member.twitch && (
   <span
     className="steam-link-twitch"
     title={`Twitch connecté : ${member.twitch.displayName}`}
     aria-label={`Twitch connecté : ${member.twitch.displayName}`}
   >
     <Icon name="twitch" size={14} />
   </span>
 )}
 {!isSyntheticId(member.steamId) && (
   <a
     className="steam-link-stats"
     href={`/u?id=${member.steamId}`}
     target="_blank"
     rel="noreferrer"
     title="Voir les stats du joueur"
     aria-label="Voir les stats du joueur"
   >
     <Icon name="barChart" size={14} />
   </a>
 )}
 {isBotId(member.steamId) && !runLocked && (
   <button
     type="button"
     className="steam-link-stats"
     onClick={() => removeBot(member.steamId)}
     title="Retirer ce bot"
     aria-label="Retirer ce bot"
   >
     <Icon name="x" size={14} />
   </button>
 )}
 </div>
 ) : (
 <div className="steam-link empty">
 <span className="steam-link-name">En attente…</span>
 {!runLocked && (
   <button
     type="button"
     className="steam-link-add-bot"
     onClick={promptAddBot}
     title="Ajouter un bot pour ce slot"
   >
     <Icon name="plus" size={11} /> Bot
   </button>
 )}
 </div>
 )}
 </div>
 );
 })}
 </div>

 <div className="field"style={{ marginTop: 18 }}>
 <label>Difficulté</label>
 <div className="toggle-group">
 <button
 className={`toggle ${state.difficulty === "normal" ? "active" : ""}`}
 onClick={() => update({ difficulty: "normal"as Difficulty })}
 disabled={runLocked}
 >
 Normal
 </button>
 <button
 className={`toggle hardcore ${state.difficulty === "hardcore" ? "active" : ""}`}
 onClick={() => update({ difficulty: "hardcore"as Difficulty })}
 disabled={runLocked}
 >
 Hardcore
 </button>
 </div>
 </div>

 <div className="field"style={{ marginTop: 18 }}>
 <label>Pénalité en cas de défaite</label>
 <div className="toggle-group">
 <button
 className={`toggle ${state.penaltyMode === "reset" ? "active" : ""}`}
 onClick={() => update({ penaltyMode: "reset"as PenaltyMode })}
 disabled={runLocked}
 >
 Reset complet (retour jeu 1)
 </button>
 <button
 className={`toggle ${state.penaltyMode === "stepback" ? "active" : ""}`}
 onClick={() => update({ penaltyMode: "stepback"as PenaltyMode })}
 disabled={runLocked}
 >
 Recule d&apos;un jeu
 </button>
 </div>
 </div>

 <div className="field"style={{ marginTop: 18 }}>
 <label>Atouts (Joker, Bouclier, Relance)</label>
 <div className="toggle-group">
 <button
   className={`toggle ${state.powerUpsEnabled !== false ? "active" : ""}`}
   onClick={() => update({ powerUpsEnabled: true })}
   disabled={runLocked}
 >
   Activés
 </button>
 <button
   className={`toggle ${state.powerUpsEnabled === false ? "active" : ""}`}
   onClick={() => update({ powerUpsEnabled: false })}
   disabled={runLocked}
 >
   Désactivés
 </button>
 </div>
 </div>

 <div className="field"style={{ marginTop: 18 }}>
 <label>
   Longueur de la run
   <span className="run-length-value">{state.runLength ?? 10} jeux</span>
 </label>
 <div className="run-length-slider-wrap">
   <input
     type="range"
     className="run-length-slider"
     min={1}
     max={10}
     step={1}
     value={state.runLength ?? 10}
     onChange={(e) => update({ runLength: Math.max(1, Math.min(10, Number(e.target.value))) })}
     disabled={runLocked || !isHost}
     aria-label="Longueur de la run"
     style={{ "--pct": `${((state.runLength ?? 10) - 1) / 9 * 100}%` } as React.CSSProperties}
   />
   <div className="run-length-ticks" aria-hidden="true">
     {Array.from({ length: 10 }, (_, i) => (
       <span key={i} className={`run-length-tick ${i + 1 <= (state.runLength ?? 10) ? "on" : ""}`}>{i + 1}</span>
     ))}
   </div>
 </div>
 </div>

 <div className="field"style={{ marginTop: 18 }}>
 <label>Bibliothèque Steam uniquement</label>
 <div className="toggle-group">
 <button
   className={`toggle ${!state.libraryOnlyMode ? "active" : ""}`}
   onClick={() => update({ libraryOnlyMode: false })}
   disabled={runLocked || !isHost}
 >
   Tout le pool
 </button>
 <button
   className={`toggle ${state.libraryOnlyMode ? "active" : ""}`}
   onClick={() => update({ libraryOnlyMode: true })}
   disabled={runLocked || !isHost}
   title="Ne tirer que des jeux qu'au moins un joueur a dans sa bibliothèque Steam"
 >
   Bibliothèque commune
 </button>
 </div>
 <p className="field-hint">
   Quand activé, seuls les jeux Steam qu'<strong>au moins un membre</strong> possède sont tirés au sort.
 </p>
 </div>

 <div className="field"style={{ marginTop: 18 }}>
 <label>Mode de tirage</label>
 <div className="toggle-group">
 <button
   className={`toggle ${!state.leastPlayedMode ? "active" : ""}`}
   onClick={() => update({ leastPlayedMode: false })}
   disabled={runLocked || !isHost}
 >
   Aléatoire
 </button>
 <button
   className={`toggle ${state.leastPlayedMode ? "active" : ""}`}
   onClick={() => update({ leastPlayedMode: true })}
   disabled={runLocked || !isHost}
   title="Force les jeux que vous avez le moins joués dans vos précédentes runs"
 >
   Moins joués
 </button>
 </div>
 <p className="field-hint">
   Force les jeux que les membres ont <strong>le moins joués</strong> dans leur historique.
 </p>
 </div>

 <div className="field"style={{ marginTop: 18 }}>
 <label>Mode VS (versus)</label>
 <div className="toggle-group">
 <button
   className={`toggle ${!state.versusMode ? "active" : ""}`}
   onClick={() => update({ versusMode: false, teams: {}, gameWinners: {} })}
   disabled={runLocked || !isHost}
 >
   Coopératif
 </button>
 <button
   className={`toggle vs-toggle ${state.versusMode ? "active" : ""}`}
   onClick={() => assignVersusTeams()}
   disabled={runLocked || !isHost}
   title="Deux équipes s'affrontent — Rouge vs Bleue"
 >
   Rouge vs Bleue
 </button>
 </div>
 {state.versusMode && (
   <p className="field-hint">
     Chaque jeu est gagné par <strong>une seule équipe</strong>. À la fin, l'équipe avec le plus de victoires l'emporte.
   </p>
 )}
 </div>
 </div>

 {/* POOL */}
 <div className="panel">
 <h2><span className="panel-title"><span className="panel-section-num">2</span> Sélection du pool</span><span className="badge">{state.pinned.length} / {pinCap(state.runLength ?? 10)} épinglés</span>
 </h2>
 <p style={{ color: "var(--muted)", fontSize: 13, marginBottom: 14 }}>
 Clique pour <strong style={{ color: "var(--gold)" }}>épingler jusqu&apos;à 5 jeux</strong> qui seront forcés dans la run. Les autres sont tirés au sort dans le reste du pool.
 </p>
 <div className="pool-controls">
 <input
 type="text"
 className="pool-search"
 placeholder="Chercher un jeu..."
 value={localSearch}
 onChange={(e) => setLocalSearch(e.target.value)}
 />
 </div>
 <div className="filter-pills">
 {getCategories().map((cat) => (
 <button
 key={cat}
 className={`filter-pill ${localFilter === cat ? "active" : ""}`}
 onClick={() => setLocalFilter(cat)}
 >
 {cat === "all" ? "Toutes" : `${CAT_ICONS[cat] ?? ""} ${cat}`}
 </button>
 ))}
 </div>
 <div className="mode-legend">
            <span className="mode-legend-item"><span className="dot solo"></span> Solo Champion</span>
            <span className="mode-legend-item"><span className="dot duo"></span> Duo</span>
            <span className="mode-legend-item"><span className="dot team"></span> Team (3 joueurs)</span>
          </div>
          <div className="pool-grid">
 {filteredPool.map((g) => {
 const effMode = effectiveMode(g, state.difficulty);
 const isPinned = state.pinned.includes(g.id);
 const modeLabelText = effMode === "solo" ? "Solo" : effMode === "duo" ? "Duo" : "Team";
              let modeLabel = modeLabelText;
 if (g.soloHardcore && state.difficulty !== "hardcore") modeLabel += " (HC = Solo)";
 return (
 <div
 key={g.id}
 className={`pool-card ${effMode === "solo" ? "solo" : effMode === "duo" ? "duo" : "team"} ${isPinned ? "pinned" : ""}`}
 onClick={() => togglePin(g.id)}
 >
 <span className="pool-card-pin"><Icon name="pin" size={12} /></span>
                  <GameCover appid={g.appid} cover={g.cover} name={g.name} size="sm" />
                  <div className="pool-card-info">
                    <div className="pool-card-name">{g.name}</div>
                    <div className="pool-card-meta">{g.cat}</div>
                    <div className="pool-card-mode">{effMode === "solo" ? <Icon name="star" size={11} /> : effMode === "duo" ? <Icon name="user" size={11} /> : <Icon name="users" size={11} />} {modeLabel}</div>
                  </div>
                  <button
                    type="button"
                    className="pool-card-objectives-btn"
                    onClick={(e) => e.stopPropagation()}
                    onMouseEnter={(e) => {
                      const r = e.currentTarget.getBoundingClientRect();
                      const flipUp = r.bottom + 120 > window.innerHeight;
                      setObjTip({ id: g.id, right: window.innerWidth - r.right, top: r.bottom, bottom: window.innerHeight - r.top, flipUp });
                    }}
                    onMouseLeave={() => setObjTip((t) => (t && t.id === g.id ? null : t))}
                    onFocus={(e) => {
                      const r = e.currentTarget.getBoundingClientRect();
                      const flipUp = r.bottom + 120 > window.innerHeight;
                      setObjTip({ id: g.id, right: window.innerWidth - r.right, top: r.bottom, bottom: window.innerHeight - r.top, flipUp });
                    }}
                    onBlur={() => setObjTip((t) => (t && t.id === g.id ? null : t))}
                    aria-label="Voir les objectifs"
                  >
                    <Icon name="info" size={14} />
                  </button>
 </div>
 );
 })}
 </div>
 <div className="generate-row">
 <button
   className="btn btn-large btn-start"
   onClick={generateRun}
   disabled={!isHost}
   title={!isHost ? "Seul l'hôte peut générer la run" : undefined}
 >
 {state.run.length > 0 ? <><Icon name="sparkles" /> Régénérer une nouvelle run</> : <><Icon name="sparkles" /> Générer la run ({state.runLength ?? 10} jeux)</>}
 </button>
 <button
   className="btn btn-large btn-reroll"
   onClick={rerollRun}
   disabled={state.run.length === 0 || !isHost}
   title={!isHost ? "Seul l'hôte peut re-roll" : undefined}
 >
 <><Icon name="refresh" /> Re-roll les jeux aléatoires</>
 </button>
 </div>
 {!isHost && (
   <div className="host-only-hint">
     <Icon name="info" size={12} /> Seul l'hôte peut générer ou re-roll la run.
   </div>
 )}
 </div>
 </>
 )}

 {/* Players panel while a run is in progress (config panel is hidden). Mirrors
     the Configuration panel's player-slot layout so positions are recognisable. */}
 {runLocked && (
 <div className="panel">
 <h2>
   <span className="panel-title">Joueurs</span>
 </h2>
 <div className="setup-grid">
 {playerSlots.map((i) => {
 const member = members[i];
 return (
 <div className="field"key={i}>
 <label>Joueur {i + 1}</label>
 {member ? (
 <div className={`steam-link linked${isBotId(member.steamId) ? " bot" : ""}`}>
 <img src={member.avatarUrl} alt="" className="steam-link-avatar" />
 {isSyntheticId(member.steamId) ? (
   <span className="steam-link-name" title={isBotId(member.steamId) ? "Bot local" : "Joueur invité"}>{member.displayName}</span>
 ) : (
   <a className="steam-link-name" href={member.profileUrl} target="_blank" rel="noreferrer">{member.displayName}</a>
 )}
 {isBotId(member.steamId) && (
   <span className="steam-link-badge" title="Bot local">
     <Icon name="bot" size={12} />
     BOT
   </span>
 )}
 {member.twitch && (
   <span
     className="steam-link-twitch"
     title={`Twitch connecté : ${member.twitch.displayName}`}
     aria-label={`Twitch connecté : ${member.twitch.displayName}`}
   >
     <Icon name="twitch" size={14} />
   </span>
 )}
 {!isSyntheticId(member.steamId) && (
   <a
     className="steam-link-stats"
     href={`/u?id=${member.steamId}`}
     target="_blank"
     rel="noreferrer"
     title="Voir les stats du joueur"
     aria-label="Voir les stats du joueur"
   >
     <Icon name="barChart" size={14} />
   </a>
 )}
 {isBotId(member.steamId) && !runLocked && (
   <button
     type="button"
     className="steam-link-stats"
     onClick={() => removeBot(member.steamId)}
     title="Retirer ce bot"
     aria-label="Retirer ce bot"
   >
     <Icon name="x" size={14} />
   </button>
 )}
 </div>
 ) : (
 <div className="steam-link empty">
 <span className="steam-link-name">En attente…</span>
 {!runLocked && (
   <button
     type="button"
     className="steam-link-add-bot"
     onClick={promptAddBot}
     title="Ajouter un bot pour ce slot"
   >
     <Icon name="plus" size={11} /> Bot
   </button>
 )}
 </div>
 )}
 </div>
 );
 })}
 </div>
 </div>
 )}

 {/* RUN */}
 <div className="panel"id="runPanel">
 <h2><span className="panel-title"><span className="panel-section-num">3</span> Run en cours</span>{state.run.length > 0 && (
 <span className="badge">
 {state.done.length}/{state.run.length}
 </span>
 )}
 </h2>
 <div className="progress-wrap">
 <div className="progress-info">
 <span>{state.difficulty === "hardcore" ? "Mode Hardcore" : "Mode Normal"}</span>
 <span>{state.done.length} / {totalSegs}</span>
 </div>
 <div className={`seg-progress ${state.difficulty === "hardcore" ? "hardcore" : ""}`}>
 {Array.from({ length: totalSegs }).map((_, i) => {
 let cls = "seg";
 if (i < state.done.length) cls += " done";
 else if (i === state.current && state.run.length > 0) cls += " current";
 return <div key={i} className={cls}></div>;
 })}
 </div>
 </div>

 {state.run.length === 0 ? (
 <div className="empty-run">
 <h3>Aucune run générée</h3>
 <p>
 Épingle 0 à 5 jeux ci-dessus puis clique sur <strong>Générer la run</strong>.
 </p>
 </div>
) : (
 <div className="games"id="gamesList">
 {state.run.map((gameId, idx) => {
 const g = POOL.find((x) => x.id === gameId) as Game | undefined;
 if (!g) return null;
 const isDone = state.done.includes(gameId);
 const isCurrent = idx === state.current && !isDone;
 const isLocked = idx > state.current && !isDone;
 const effMode = effectiveMode(g, state.difficulty);
 const isSolo = effMode === "solo" || effMode === "duo";
 const isPinned = state.pinned.includes(gameId);
 const objective = state.difficulty === "hardcore" ? g.hardcore : g.normal;
 const champion = state.champions[gameId];
 const isDrawing = state.drawing?.gameId === gameId;

 const classes = [
 "game",
 "tiltable",
 isLocked ? "locked" : "",
 isCurrent ? "current" : "",
 isDone ? "done" : "",
 isPinned ? "pinned-run" : "",
 swappedIdx === idx ? "swapped" : "",
 ]
 .filter(Boolean)
 .join(" ");

 const modeTagClass = effMode === "solo" ? "solo" : effMode === "duo" ? "duo" : "team";
 const modeIcon = effMode === "solo" ? "star" : effMode === "duo" ? "user" : "users";
 const modeTagText = g.cat;

 return (
 <div key={`${gameId}-${idx}`} className={classes}>
 <div className="game-num">{String(idx + 1).padStart(2, "0")}</div>
 <GameCover appid={g.appid} cover={g.cover} name={g.name} size="md" />
 <div className="game-info">
 <div className="game-title-row">
 <div className="game-title">
 {CAT_ICONS[g.cat] ?? ""} {g.name}
 </div>
 <div className={`game-tag ${modeTagClass}`}><Icon name={modeIcon} size={11} /> {modeTagText}</div>
 {isPinned && <div className="game-tag pinned-tag"><Icon name="pin" size={11} /> Épinglé</div>}
 </div>
 <div className={`game-objective ${state.difficulty === "hardcore" ? "hc" : ""}`}>
 Objectif : <strong>{objective}</strong>
 </div>
 {g.achievement && g.appid && isCurrent && !isDone && (
   <AchievementCheck
     gameId={gameId}
     appid={g.appid}
     apiname={g.achievement.apiname}
     label={g.achievement.label}
     onUnlocked={() => (state.versusMode ? null : winGame(gameId))}
   />
 )}
 {g.appid && members.some((m) => !isSyntheticId(m.steamId)) && (
 <div className="game-owners" aria-label="Possession Steam">
 {members.filter((m) => !isSyntheticId(m.steamId)).map((m) => {
 const key = String(g.appid);
 const auto = state.ownership?.[m.steamId]?.[key];
 const override = state.ownershipOverride?.[m.steamId]?.[key];
 const owned = override !== undefined ? override : auto;
 const status = owned === true ? "owns" : owned === false ? "missing" : "unknown";
 const isMe = me?.steamId === m.steamId;
 const isOverride = override !== undefined;
 const baseTip =
 status === "owns" ? `${m.displayName} possède ${g.name}` :
 status === "missing" ? `${m.displayName} n'a pas ${g.name} sur Steam` :
 `${m.displayName} : possession inconnue (profil privé ?)`;
 const tip =
 isMe ? `${baseTip} — clique pour ${owned === true ? "indiquer que tu ne l'as pas" : "indiquer que tu l'as"}` :
 isOverride ? `${baseTip} (déclaration manuelle)` :
 baseTip;
 return (
 <span
 key={m.steamId}
 className={`owner-chip ${status}${isMe ? " clickable" : ""}${isOverride ? " override" : ""}`}
 title={tip}
 onClick={isMe && g.appid ? () => toggleOwnershipOverride(g.appid as number) : undefined}
 role={isMe ? "button" : undefined}
 tabIndex={isMe ? 0 : undefined}
 onKeyDown={isMe && g.appid ? (e) => {
 if (e.key === "Enter" || e.key === " ") {
 e.preventDefault();
 toggleOwnershipOverride(g.appid as number);
 }
 } : undefined}
 >
 <img src={m.avatarUrl} alt="" />
 <span className="owner-mark">{status === "owns" ? "✓" : status === "missing" ? "✗" : "?"}</span>
 </span>
 );
 })}
 </div>
 )}
 {isSolo && (
 <div className="game-champion">
 {isDrawing && state.drawing ? (() => {
 const drawing = state.drawing;
 // Each reel finishes its rAF after `1200 + r * 400` ms; once every reel
 // has finished, the whole machine snaps to "locked" styling.
 const allLocked = drawing.reels.every((_, r) => (now - drawing.startedAt) >= (1200 + r * 400));
 return (
 <>
 Tirage en cours…
 <div className={`slot-machine ${allLocked ? "locked" : ""}`}>
 {drawing.reels.map((cells, r) => {
 // For duo draws (pairSize=2), drop a separator between consecutive
 // pairs: "&" within a pair, "·" between independent pairs.
 const inPair = drawing.pairSize > 1 && r > 0 && r % drawing.pairSize !== 0;
 const betweenPairs = drawing.pairSize > 1 && r > 0 && r % drawing.pairSize === 0;
 return (
 <React.Fragment key={r}>
 {inPair && <div className="slot-sep slot-sep-and" aria-hidden="true">&amp;</div>}
 {betweenPairs && <div className="slot-sep slot-sep-pair" aria-hidden="true">·</div>}
 <div className="slot-reel">
 <div className="slot-strip" id={`strip${r}`}>
 {cells.map((c, ci) => {
 const av = nameToAvatar[c];
 return (
 <div className="slot-cell" key={ci}>
 {av && <img className="slot-avatar" src={av} alt="" />}
 <span className="slot-name">{c}</span>
 </div>
 );
 })}
 </div>
 </div>
 </React.Fragment>
 );
 })}
 </div>
 </>
 );
 })() : champion ? (
 effMode === "duo" ? (
 <>{champion.includes(" · ") ? "Duos désignés" : "Duo désigné"} : <ChampionName text={champion} nameToAvatar={nameToAvatar} /></>
) : (
 <>Champion désigné : <ChampionName text={champion} nameToAvatar={nameToAvatar} /></>
 )
) : effMode === "duo" ? (
 <>Aucun duo tiré — <em>Tirage au sort requis</em></>
) : (
 <>Aucun champion tiré — <em>Tirage au sort requis</em></>
 )}
 </div>
 )}
 {isCurrent && g.timer && (
   (() => {
     // `?? null` normalises any pre-feature room state where the field is
     // undefined — keeps the active/inactive check simple.
     const deadline = state.timerDeadline ?? null;
     const remainingMs = deadline !== null ? Math.max(0, deadline - now) : 0;
     const expired = deadline !== null && remainingMs === 0;
     const totalSec = Math.floor(remainingMs / 1000);
     const mm = String(Math.floor(totalSec / 60)).padStart(2, "0");
     const ss = String(totalSec % 60).padStart(2, "0");
     return (
       <div className={`game-timer ${expired ? "expired" : ""} ${deadline !== null ? "running" : ""}`}>
         <span className="game-timer-icon" aria-hidden="true"><Icon name="clock" size={14} /></span>
         {deadline === null ? (
           <>
             <span className="game-timer-label">Minuteur</span>
             <div className="game-timer-stepper">
               <button
                 type="button"
                 className="game-timer-step"
                 onClick={() => setTimerInputMin((m) => Math.max(1, m - 1))}
                 aria-label="Diminuer la durée"
               >−</button>
               <input
                 type="number"
                 className="game-timer-input"
                 min={1}
                 max={120}
                 value={timerInputMin}
                 onChange={(e) => setTimerInputMin(Number(e.target.value))}
                 aria-label="Durée en minutes"
               />
               <button
                 type="button"
                 className="game-timer-step"
                 onClick={() => setTimerInputMin((m) => Math.min(120, m + 1))}
                 aria-label="Augmenter la durée"
               >+</button>
             </div>
             <span className="game-timer-unit">min</span>
             <button className="btn btn-timer" onClick={() => startTimer(timerInputMin)}>
               Démarrer
             </button>
           </>
         ) : (
           <>
             <span className="game-timer-label">{expired ? "Temps écoulé" : "Temps restant"}</span>
             <span className="game-timer-clock">{mm}:{ss}</span>
             <button className="btn btn-timer-reset" onClick={resetTimer}>
               Reset
             </button>
           </>
         )}
       </div>
     );
   })()
 )}
 </div>
 <div className="game-actions">
 {isDone ? (
 <div className="check"></div>
) : (
 <>
 <button
 className="btn btn-swap"
 onClick={() => swapGame(gameId)}
 title="On n'a pas ce jeu / on veut le remplacer"
 >
 Swap
 </button>
 {isSolo && (
 <button
 className="btn btn-draw"
 disabled={!isCurrent}
 onClick={() => drawChampion(gameId, effMode as "solo" | "duo")}
 >
 Tirer
 </button>
 )}
 {state.versusMode ? (
 <>
 <button
   className="btn btn-win btn-vs-red"
   disabled={!isCurrent}
   onClick={() => winVersusGame(gameId, "red")}
   title="Équipe Rouge gagne ce jeu"
 >
   Rouge gagne
 </button>
 <button
   className="btn btn-win btn-vs-blue"
   disabled={!isCurrent}
   onClick={() => winVersusGame(gameId, "blue")}
   title="Équipe Bleue gagne ce jeu"
 >
   Bleue gagne
 </button>
 </>
 ) : (
 <>
 <button className="btn btn-win"disabled={!isCurrent} onClick={() => winGame(gameId)}>
 Validé
 </button>
 <button className="btn btn-lose"disabled={!isCurrent} onClick={() => loseGame(gameId)}>
 Échoué
 </button>
 </>
 )}
 </>
 )}
 </div>
 </div>
 );
 })}
 </div>
 )}
 </div>

 {/* STATS / HISTORY */}
 <div className="panel">
 <h2>
 Stats &amp; Historique
 <button
 className="stats-toggle-btn"
 style={{ margin: "0 0 0 auto" }}
 onClick={() => update({ showHistory: !state.showHistory })}
 >
 {state.showHistory ? <><Icon name="eyeOff" size={12} /> Masquer l'historique</> : <><Icon name="eye" size={12} /> Afficher l'historique</>}
 </button>
 </h2>
 <div className="stats-grid">
 {[
 { value: stats.total, label: "Runs lancées" },
 { value: stats.wins, label: "Runs réussies" },
 { value: stats.successRate + "%", label: "Taux de réussite" },
 { value: stats.avgAttempts, label: "Tentatives moy." },
 { value: fmtDuration(stats.totalDuration), label: "Temps total joué" },
 {
 value: stats.mostFailedGame ? stats.mostFailedGame.name : "—",
 label: `Jeu le + raté${stats.mostFailedCount ? " (×" + stats.mostFailedCount + ")" : ""}`,
 },
 {
 value: stats.topChampion,
 label: `Champion le + tiré${stats.topChampionCount ? " (×" + stats.topChampionCount + ")" : ""}`,
 },
 ].map((s, i) => (
 <div className="stat"key={i}>
 <div className="stat-value">{s.value}</div>
 <div className="stat-label">{s.label}</div>
 </div>
 ))}
 </div>
 {state.showHistory && (
 <div className="history-list">
 {state.history.length === 0 ? (
 <div className="history-empty">Aucune run terminée. Lance une run pour commencer !</div>
) : (
 state.history.map((entry) => {
 const failed = entry.failedGameId ? POOL.find((g) => g.id === entry.failedGameId) : null;
 const tag = entry.outcome === "win" ? "🏆" : "💀";
 const status = entry.outcome === "win" ? "GAUNTLET WIN" : "GAUNTLET FAILED";
 return (
 <div
 key={entry.id}
 className={`history-item ${entry.outcome === "win" ? "win" : "lose"}`}
 >
 <div className="history-item-icon">{tag}</div>
 <div>
 <strong>{status}</strong>
 <div className="history-item-meta">
 {fmtDate(entry.ts)} · {entry.completed || 0}/{entry.total || 10} jeux
 {failed && (
 <>
 {" · raté sur "}<strong>{failed.name}</strong>
 </>
 )}
 {" · "}{entry.difficulty === "hardcore" ? "HC" : "N"}
 </div>
 </div>
 <div className="history-item-meta">
 <strong>{entry.attempts}</strong> tentatives
 <br />
 {fmtDuration(entry.duration)}
 </div>
 </div>
 );
 })
 )}
 </div>
 )}
 </div>

 {/* GLOBAL CONTROLS */}
 <div className="controls">
 <button className="btn btn-large btn-reset"onClick={hardReset}>
 Reset complet
 </button>
 </div>

 {/* RULES */}
 <div className="rules">
 <strong>Règles du Gauntlet</strong>
 <ul>
 <li>
 Vous devez réussir l&apos;objectif des <strong>10 jeux dans l&apos;ordre</strong> sans une seule défaite.
 </li>
 <li>
 Si l&apos;objectif d&apos;un jeu n&apos;est pas atteint, deux pénalités au choix dans la config :{" "}
 <strong>Reset complet</strong> (retour jeu 1) ou <strong>Recule d&apos;un jeu</strong>.
 </li>
 <li>
 Les jeux marqués <span style={{ color: "var(--gold)", fontWeight: 700 }}>SOLO</span> doivent être réussis par <strong>un seul joueur tiré au sort</strong>.
 </li>
 <li>
 Les jeux marqués <span style={{ color: "var(--accent-2)", fontWeight: 700 }}>DUO</span> sont joués en duo tiré au sort. Avec 4+ joueurs, le tirage forme plusieurs duos coopératifs en parallèle (chaque duo joue le même objectif de son côté).
 </li>
 <li>
 Mode <strong>Hardcore</strong> : objectifs nettement plus exigeants.
 </li>
 <li>Bouton Swap par carte : remplace un seul jeu par un autre tiré au sort dans le pool restant.</li>
 <li>La progression et l&apos;historique sont sauvegardés automatiquement dans ce navigateur.</li>
 </ul>
 </div>

 </div>{/* end room-main */}

 {state.powerUpsEnabled !== false && <aside className="room-sidebar">
   <div className="powerups-panel">
     <div className="powerups-title">⚡ Atouts</div>
     {members.length === 0 ? (
       <div className="powerups-empty">En attente de joueurs…</div>
     ) : members.map((member) => {
       const pu = (state.powerUps ?? {})[member.steamId] ?? { joker: 0, shield: 0, reroll: 0 };
       const runActive = state.run.length > 0;
       const currentGameId = state.run[state.current];
       const canReroll = runActive && !!currentGameId && !!state.champions[currentGameId] && !state.done.includes(currentGameId);
       const isMe = me?.steamId === member.steamId;
       return (
         <div className="powerup-card" key={member.steamId}>
           <div className="powerup-player">
             <img src={member.avatarUrl} alt="" className="powerup-avatar" />
             <span className="powerup-name">{member.displayName}</span>
           </div>
           <div className="powerup-buttons">
             <button
               className={`powerup-btn joker${pu.joker <= 0 ? " used" : ""}`}
               disabled={!isMe || pu.joker <= 0 || !runActive}
               onClick={() => useJoker(member.steamId)}
               title={isMe ? "Joker : échange un jeu aléatoire non validé de la run" : "Ce bonus appartient à un autre joueur"}
             >
               🃏 Joker <span className="powerup-count">×{pu.joker}</span>
             </button>
             <button
               className={`powerup-btn shield${pu.shield <= 0 || state.shieldActive === true ? " used" : ""}`}
               disabled={!isMe || pu.shield <= 0 || state.shieldActive === true}
               onClick={() => useShield(member.steamId)}
               title={isMe ? "Bouclier : annule la prochaine défaite" : "Ce bonus appartient à un autre joueur"}
             >
               🛡️ Bouclier <span className="powerup-count">×{pu.shield}</span>
             </button>
             <button
               className={`powerup-btn reroll${pu.reroll <= 0 || !canReroll ? " used" : ""}`}
               disabled={!isMe || pu.reroll <= 0 || !canReroll}
               onClick={() => useReroll(member.steamId)}
               title={isMe ? "Relance : retire le champion au sort" : "Ce bonus appartient à un autre joueur"}
             >
               🎲 Relance <span className="powerup-count">×{pu.reroll}</span>
             </button>
           </div>
         </div>
       );
     })}
     {state.shieldActive && (
       <div className="shield-active-badge">🛡️ Bouclier actif !</div>
     )}
   </div>
 </aside>}

 </div>{/* end room-layout */}

 {/* OVERLAYS */}
 {overlay.kind === "win" && (
 <div className="overlay win">
 <div className="overlay-content">
 <h2>GAUNTLET COMPLETED</h2>
 <p>Vous avez vaincu les 10 épreuves sans une seule défaite. Le panthéon vous attend.</p>
 <button
 className="btn btn-large btn-win"
 onClick={() => {
 setOverlay({ kind: null });
 fullReset();
 }}
 >
 Recommencer une run
 </button>
 </div>
 </div>
 )}

 {overlay.kind === "lose" && (
 <div className="overlay lose">
 <div className="overlay-content">
 <h2>GAUNTLET FAILED</h2>
 <p>{overlay.msg}</p>
 <button className="btn btn-large btn-lose"onClick={() => setOverlay({ kind: null })}>
 Repartir au combat
 </button>
 </div>
 </div>
 )}

 {/* === PRE-RUN REVIEW MODAL === */}
 {reviewing && pendingRun && (
 <div className="overlay show">
 <div className="overlay-content review-content">
 <h2>Préparation de la run</h2>
 <p>Vérifie que tous les jeux sont installés. Tu peux ouvrir Steam pour télécharger ce qui te manque, ou remplacer un jeu qui ne convient pas.</p>
 <div className="review-list">
 {pendingRun.map((id, idx) => {
 const g = POOL.find((x) => x.id === id);
 if (!g) return null;
 const effMode = effectiveMode(g, state.difficulty);
 const modeLabel = effMode === "solo" ? "Solo" : effMode === "duo" ? "Duo" : "Team";
 const modeIconName = effMode === "solo" ? "star" : effMode === "duo" ? "user" : "users";
 const obj = state.difficulty === "hardcore" ? g.hardcore : g.normal;
 return (
 <div className="review-item" key={`${id}-${idx}`}>
 <div className="review-num">{String(idx + 1).padStart(2, "0")}</div>
 <GameCover appid={g.appid} cover={g.cover} name={g.name} size="sm" />
 <div className="review-info">
 <div className="review-name">{g.name}</div>
 <div className="review-meta">
 <span className={`game-tag ${effMode === "solo" ? "solo" : effMode === "duo" ? "duo" : "team"}`}>
 <Icon name={modeIconName} size={11} /> {modeLabel}
 </span>
 <span className="review-objective">{obj}</span>
 </div>
 </div>
 <a href={steamSearchUrl(g.name)} target="_blank" rel="noopener noreferrer" className="btn btn-steam" title="Ouvrir Steam pour télécharger">
 Steam
 </a>
 {isHost && (
   <button className="btn btn-swap" onClick={() => swapInPending(id)}>
     <Icon name="refresh" /> Remplacer
   </button>
 )}
 </div>
 );
 })}
 </div>
 {/* Ready-states roster — one chip per human member. */}
 {(() => {
   const humans = members.filter((m) => !isSyntheticId(m.steamId));
   if (humans.length === 0) return null;
   const ready = new Set(state.readyPlayers ?? []);
   const readyCount = humans.filter((m) => ready.has(m.steamId)).length;
   return (
     <div className="ready-roster">
       <div className="ready-roster-title">
         Prêts : <strong>{readyCount}/{humans.length}</strong>
       </div>
       <div className="ready-chips">
         {humans.map((m) => {
           const isReady = ready.has(m.steamId);
           return (
             <span key={m.steamId} className={`ready-chip ${isReady ? "ready" : "waiting"}`}>
               <img src={m.avatarUrl} alt="" />
               <span className="ready-chip-name">{m.displayName}</span>
               <span className="ready-chip-status" aria-hidden="true">{isReady ? "✓" : "…"}</span>
             </span>
           );
         })}
       </div>
     </div>
   );
 })()}
 <div className="review-actions">
   {isHost && (
     <button className="btn btn-large btn-reset" onClick={cancelReview}>Annuler</button>
   )}
   {me && !isSyntheticId(me.steamId) && (
     (() => {
       const isReady = (state.readyPlayers ?? []).includes(me.steamId);
       return (
         <button
           className={`btn btn-large ${isReady ? "btn-reset" : "btn-start"}`}
           onClick={toggleReady}
         >
           {isReady ? (<><Icon name="x" /> Pas prêt</>) : (<><Icon name="check" /> Je suis prêt</>)}
         </button>
       );
     })()
   )}
   {isHost && (() => {
     const humans = members.filter((m) => !isSyntheticId(m.steamId));
     const ready = new Set(state.readyPlayers ?? []);
     const allReady = humans.length > 0 && humans.every((m) => ready.has(m.steamId));
     return (
       <button
         className="btn btn-large btn-start"
         onClick={launchCountdown}
         disabled={!allReady}
         title={allReady ? "Lancer la run" : "En attente que tous les joueurs soient prêts"}
       >
         <Icon name="sparkles" /> Lancer maintenant
       </button>
     );
   })()}
 </div>
 </div>
 </div>
 )}

 {/* === COUNTDOWN OVERLAY === */}
 {countdown !== null && (
 <div className="overlay show countdown-overlay">
 <div className="countdown-display">
 {countdown > 0 ? countdown : "GO"}
 </div>
 </div>
 )}

 {/* === FLOATING OBJECTIVES TOOLTIP === */}
 {objTip !== null && (() => {
   const game = POOL.find((x) => x.id === objTip.id);
   if (!game) return null;
   const style: React.CSSProperties = objTip.flipUp
     ? { bottom: objTip.bottom + 6, right: objTip.right }
     : { top: objTip.top + 6, right: objTip.right };
   return (
     <div className="floating-objectives-tooltip" style={style}>
       <div className="tt-row"><span className="tt-label tt-normal">Normal</span><span className="tt-text">{game.normal}</span></div>
       <div className="tt-row"><span className="tt-label tt-hardcore">Hardcore</span><span className="tt-text">{game.hardcore}</span></div>
     </div>
   );
 })()}

 {/* === OVERLAYS MODAL === */}
 {showOverlays && (() => {
   const widgets: { key: string; label: string; file: string; size: string }[] = [
     { key: "total",    label: "Temps total",    file: "total-time.html",   size: "320 × 140" },
     { key: "wins",     label: "Victoires",      file: "victories.html",    size: "320 × 140" },
     { key: "resets",   label: "Resets",         file: "resets.html",       size: "320 × 140" },
     { key: "current",  label: "Jeu en cours",   file: "current-game.html", size: "400 × 180" },
     { key: "list",     label: "Liste des jeux", file: "game-list.html",    size: "400 × 950" },
   ];
   const origin = typeof window !== "undefined" ? window.location.origin : "";
   const buildUrl = (file: string) =>
     overlayToken
       ? `${origin}/overlays/widgets/${file}?token=${encodeURIComponent(overlayToken)}`
       : "";
   const copy = async (key: string, url: string) => {
     try {
       await navigator.clipboard.writeText(url);
       setOverlayCopied(key);
       setTimeout(() => setOverlayCopied((k) => (k === key ? null : k)), 1400);
     } catch {
       window.prompt("Copie ce lien :", url);
     }
   };
   return (
     <div className="overlay show" onClick={(e) => { if (e.target === e.currentTarget) setShowOverlays(false); }}>
       <div className="overlay-links-modal">
         <button className="overlay-links-close" onClick={() => setShowOverlays(false)} aria-label="Fermer">×</button>
         <h3>Overlays Twitch</h3>
         <p className="overlay-links-hint">
           Sources navigateur OBS personnelles. À configurer une seule fois — les liens suivent ton
           compte Steam et basculent automatiquement vers la room courante à chaque nouvelle run.
           Garde-les privés : ils donnent un accès lecture à ton état de jeu.
         </p>
         {!overlayToken ? (
           <div className="overlay-links-loading">
             {overlayTokenLoading ? "Génération du token…" : "Token indisponible — réessaie."}
           </div>
         ) : (
           <div className="overlay-links-list">
             {widgets.map((w) => {
               const url = buildUrl(w.file);
               const copied = overlayCopied === w.key;
               return (
                 <div key={w.key} className="overlay-links-row">
                   <div className="overlay-links-row-label">
                     {w.label}
                     <div className="overlay-links-row-size" title="Résolution OBS recommandée (largeur × hauteur en px)">{w.size}</div>
                   </div>
                   <input className="overlay-links-row-url" type="text" value={url} readOnly onFocus={(e) => e.currentTarget.select()} />
                   <button
                     className={`overlay-links-row-copy${copied ? " copied" : ""}`}
                     onClick={() => copy(w.key, url)}
                   >
                     {copied ? "Copié !" : "Copier"}
                   </button>
                 </div>
               );
             })}
           </div>
         )}
       </div>
     </div>
   );
 })()}
 </>
 );
}
