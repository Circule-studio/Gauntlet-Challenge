// SQLite access for the twitch_links table (Steam user ↔ Twitch broadcaster).
// Tokens are stored plaintext for now; threat model is the same as the JWT
// session cookies signed by JWT_SECRET — both live on the same single-process
// host. Add at-rest encryption if you ever multi-tenant or expose the file.

import { getDb } from "./db";

export interface TwitchLink {
  steamId: string;
  broadcasterId: string;
  login: string;
  displayName: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes: string[];
  createdAt: number;
  updatedAt: number;
  /** Opt-in: when true, the broadcaster's Twitch category auto-updates as the
   *  current gauntlet game changes. Requires the channel:manage:broadcast scope. */
  autoCategory: boolean;
}

interface TwitchLinkRow {
  steam_id: string;
  broadcaster_id: string;
  login: string;
  display_name: string;
  access_token: string;
  refresh_token: string;
  expires_at: number;
  scopes: string;
  created_at: number;
  updated_at: number;
  auto_category: number;
}

function rowToLink(r: TwitchLinkRow): TwitchLink {
  return {
    steamId: r.steam_id,
    broadcasterId: r.broadcaster_id,
    login: r.login,
    displayName: r.display_name,
    accessToken: r.access_token,
    refreshToken: r.refresh_token,
    expiresAt: r.expires_at,
    scopes: r.scopes ? r.scopes.split(" ").filter(Boolean) : [],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    autoCategory: !!r.auto_category,
  };
}

export function getLinkBySteamId(steamId: string): TwitchLink | null {
  const row = getDb()
    .prepare(`SELECT * FROM twitch_links WHERE steam_id = ?`)
    .get(steamId) as TwitchLinkRow | undefined;
  return row ? rowToLink(row) : null;
}

export function getLinkByBroadcasterId(broadcasterId: string): TwitchLink | null {
  const row = getDb()
    .prepare(`SELECT * FROM twitch_links WHERE broadcaster_id = ?`)
    .get(broadcasterId) as TwitchLinkRow | undefined;
  return row ? rowToLink(row) : null;
}

export interface UpsertLinkArgs {
  steamId: string;
  broadcasterId: string;
  login: string;
  displayName: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes: string[];
}

/**
 * Upsert by steam_id. If the same Steam user reconnects (same broadcaster or
 * a different one), the row is replaced with fresh tokens and metadata.
 *
 * Note: we don't try to handle the edge case where two different Steam users
 * connect the same Twitch broadcaster — the UNIQUE(broadcaster_id) constraint
 * will reject the second one with a SqliteError, surfaced as 409 by callers.
 */
export function upsertLink(args: UpsertLinkArgs): void {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO twitch_links
        (steam_id, broadcaster_id, login, display_name, access_token,
         refresh_token, expires_at, scopes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(steam_id) DO UPDATE SET
         broadcaster_id = excluded.broadcaster_id,
         login          = excluded.login,
         display_name   = excluded.display_name,
         access_token   = excluded.access_token,
         refresh_token  = excluded.refresh_token,
         expires_at     = excluded.expires_at,
         scopes         = excluded.scopes,
         updated_at     = excluded.updated_at`,
    )
    .run(
      args.steamId,
      args.broadcasterId,
      args.login,
      args.displayName,
      args.accessToken,
      args.refreshToken,
      args.expiresAt,
      args.scopes.join(" "),
      now,
      now,
    );
}

export function updateTokens(
  steamId: string,
  accessToken: string,
  refreshToken: string,
  expiresAt: number,
): void {
  getDb()
    .prepare(
      `UPDATE twitch_links
          SET access_token  = ?,
              refresh_token = ?,
              expires_at    = ?,
              updated_at    = ?
        WHERE steam_id = ?`,
    )
    .run(accessToken, refreshToken, expiresAt, Date.now(), steamId);
}

export function deleteLink(steamId: string): boolean {
  const info = getDb().prepare(`DELETE FROM twitch_links WHERE steam_id = ?`).run(steamId);
  return info.changes > 0;
}

export function setAutoCategory(steamId: string, value: boolean): boolean {
  const info = getDb()
    .prepare(`UPDATE twitch_links SET auto_category = ?, updated_at = ? WHERE steam_id = ?`)
    .run(value ? 1 : 0, Date.now(), steamId);
  return info.changes > 0;
}

/** Iterate every linked broadcaster — used at startup to spin up EventSub. */
export function listAllLinks(): TwitchLink[] {
  const rows = getDb()
    .prepare(`SELECT * FROM twitch_links ORDER BY created_at ASC`)
    .all() as TwitchLinkRow[];
  return rows.map(rowToLink);
}

// === Custom rewards (one row per broadcaster × effect) ===

export interface RewardRow {
  broadcasterId: string;
  effectKey: string;
  rewardId: string;
  cost: number;
  enabled: boolean;
  createdAt: number;
}

interface RewardRowDb {
  broadcaster_id: string;
  effect_key: string;
  reward_id: string;
  cost: number;
  enabled: number;
  created_at: number;
}

function dbToReward(r: RewardRowDb): RewardRow {
  return {
    broadcasterId: r.broadcaster_id,
    effectKey: r.effect_key,
    rewardId: r.reward_id,
    cost: r.cost,
    enabled: !!r.enabled,
    createdAt: r.created_at,
  };
}

export function listRewards(broadcasterId: string): RewardRow[] {
  const rows = getDb()
    .prepare(`SELECT * FROM twitch_rewards WHERE broadcaster_id = ?`)
    .all(broadcasterId) as RewardRowDb[];
  return rows.map(dbToReward);
}

export function getRewardByEffect(
  broadcasterId: string,
  effectKey: string,
): RewardRow | null {
  const row = getDb()
    .prepare(
      `SELECT * FROM twitch_rewards WHERE broadcaster_id = ? AND effect_key = ?`,
    )
    .get(broadcasterId, effectKey) as RewardRowDb | undefined;
  return row ? dbToReward(row) : null;
}

export function getRewardByRewardId(rewardId: string): RewardRow | null {
  const row = getDb()
    .prepare(`SELECT * FROM twitch_rewards WHERE reward_id = ?`)
    .get(rewardId) as RewardRowDb | undefined;
  return row ? dbToReward(row) : null;
}

export function upsertReward(args: {
  broadcasterId: string;
  effectKey: string;
  rewardId: string;
  cost: number;
  enabled: boolean;
}): void {
  getDb()
    .prepare(
      `INSERT INTO twitch_rewards
        (broadcaster_id, effect_key, reward_id, cost, enabled, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(broadcaster_id, effect_key) DO UPDATE SET
         reward_id = excluded.reward_id,
         cost      = excluded.cost,
         enabled   = excluded.enabled`,
    )
    .run(
      args.broadcasterId,
      args.effectKey,
      args.rewardId,
      args.cost,
      args.enabled ? 1 : 0,
      Date.now(),
    );
}

export function deleteRewardsForBroadcaster(broadcasterId: string): number {
  const info = getDb()
    .prepare(`DELETE FROM twitch_rewards WHERE broadcaster_id = ?`)
    .run(broadcasterId);
  return info.changes;
}

// === Twitch events activity log ===

export interface TwitchEventRow {
  id: number;
  broadcasterId: string;
  receivedAt: number;
  source: "channel_points" | "bits";
  effectKey: string | null;
  applied: boolean;
  failReason: string | null;
  userLogin: string | null;
  bits: number | null;
  rewardTitle: string | null;
}

interface TwitchEventDbRow {
  id: number;
  broadcaster_id: string;
  received_at: number;
  source: string;
  effect_key: string | null;
  applied: number;
  fail_reason: string | null;
  user_login: string | null;
  bits: number | null;
  reward_title: string | null;
}

function dbToEvent(r: TwitchEventDbRow): TwitchEventRow {
  return {
    id: r.id,
    broadcasterId: r.broadcaster_id,
    receivedAt: r.received_at,
    source: r.source as "channel_points" | "bits",
    effectKey: r.effect_key,
    applied: !!r.applied,
    failReason: r.fail_reason,
    userLogin: r.user_login,
    bits: r.bits,
    rewardTitle: r.reward_title,
  };
}

const EVENT_LOG_CAP = 100;

export function recordTwitchEvent(args: {
  broadcasterId: string;
  source: "channel_points" | "bits";
  effectKey: string | null;
  applied: boolean;
  failReason: string | null;
  userLogin: string | null;
  bits: number | null;
  rewardTitle: string | null;
}): void {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO twitch_events
        (broadcaster_id, received_at, source, effect_key, applied,
         fail_reason, user_login, bits, reward_title)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      args.broadcasterId,
      Date.now(),
      args.source,
      args.effectKey,
      args.applied ? 1 : 0,
      args.failReason,
      args.userLogin,
      args.bits,
      args.rewardTitle,
    );
    // Drop everything beyond the cap for this broadcaster.
    db.prepare(
      `DELETE FROM twitch_events
        WHERE broadcaster_id = ?
          AND id NOT IN (
            SELECT id FROM twitch_events
              WHERE broadcaster_id = ?
              ORDER BY id DESC
              LIMIT ?
          )`,
    ).run(args.broadcasterId, args.broadcasterId, EVENT_LOG_CAP);
  });
  try {
    tx();
  } catch (err) {
    console.error("[db] recordTwitchEvent failed:", err);
  }
}

export function listTwitchEvents(
  broadcasterId: string,
  limit: number,
): TwitchEventRow[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM twitch_events
        WHERE broadcaster_id = ?
        ORDER BY id DESC
        LIMIT ?`,
    )
    .all(broadcasterId, Math.min(limit, EVENT_LOG_CAP)) as TwitchEventDbRow[];
  return rows.map(dbToEvent);
}

export function deleteEventsForBroadcaster(broadcasterId: string): number {
  const info = getDb()
    .prepare(`DELETE FROM twitch_events WHERE broadcaster_id = ?`)
    .run(broadcasterId);
  return info.changes;
}
