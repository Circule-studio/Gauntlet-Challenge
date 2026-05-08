// SQLite persistence for completed gauntlet runs. Single file, synchronous API,
// fits the one-process Alwaysdata deployment. Swap to Postgres later if we ever
// go multi-instance — the call surface is small (`getDb`, `recordRun`, plus
// query helpers added in later phases).
//
// Schema lives in `MIGRATIONS` as plain idempotent SQL — applied on first open.
// No migration framework yet; if/when we need versioned migrations, add a
// `schema_version` table.

import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import Database from "better-sqlite3";
import type { RunHistoryEntry } from "@shared/types";
import type { SteamSessionUser } from "@shared/types/steam";
import type {
  GameStats,
  GameStatsPayload,
  LeaderboardPlayer,
  LeaderboardRun,
  LeaderboardsPayload,
  ProfilePayload,
  ProfileRun,
  ProfileRunPlayer,
} from "@shared/types/stats";
import type { Difficulty } from "@shared/types";

const MIGRATIONS = `
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS players (
    steam_id     TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    avatar_url   TEXT NOT NULL,
    profile_url  TEXT NOT NULL,
    last_seen_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS runs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    room_code       TEXT    NOT NULL,
    ended_at        INTEGER NOT NULL,
    outcome         TEXT    NOT NULL CHECK (outcome IN ('win','lose')),
    difficulty      TEXT    NOT NULL CHECK (difficulty IN ('normal','hardcore')),
    penalty_mode    TEXT    NOT NULL CHECK (penalty_mode IN ('reset','stepback')),
    attempts        INTEGER NOT NULL,
    completed       INTEGER NOT NULL,
    total           INTEGER NOT NULL,
    failed_game_id  INTEGER,
    duration_s      INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_runs_ended_at ON runs(ended_at);
  CREATE INDEX IF NOT EXISTS idx_runs_outcome  ON runs(outcome, difficulty);

  CREATE TABLE IF NOT EXISTS run_players (
    run_id   INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    steam_id TEXT    NOT NULL REFERENCES players(steam_id),
    PRIMARY KEY (run_id, steam_id)
  );
  CREATE INDEX IF NOT EXISTS idx_run_players_steam ON run_players(steam_id);

  CREATE TABLE IF NOT EXISTS run_games (
    run_id            INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    slot              INTEGER NOT NULL,
    game_id           INTEGER NOT NULL,
    completed         INTEGER NOT NULL,
    duration_s        INTEGER,
    champion_steam_id TEXT,
    PRIMARY KEY (run_id, slot)
  );
  CREATE INDEX IF NOT EXISTS idx_run_games_game ON run_games(game_id, completed);

  -- Twitch OAuth link, one row per Steam user that connected their Twitch.
  -- No FK to players — a streamer can connect Twitch before playing any run.
  CREATE TABLE IF NOT EXISTS twitch_links (
    steam_id        TEXT PRIMARY KEY,
    broadcaster_id  TEXT NOT NULL UNIQUE,
    login           TEXT NOT NULL,
    display_name    TEXT NOT NULL,
    access_token    TEXT NOT NULL,
    refresh_token   TEXT NOT NULL,
    expires_at      INTEGER NOT NULL,
    scopes          TEXT NOT NULL,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL,
    auto_category   INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_twitch_links_broadcaster ON twitch_links(broadcaster_id);

  -- One row per (broadcaster, effect) tying our effect catalog to the Twitch
  -- custom-reward IDs we created on their channel via the Helix API.
  CREATE TABLE IF NOT EXISTS twitch_rewards (
    broadcaster_id TEXT    NOT NULL,
    effect_key     TEXT    NOT NULL,
    reward_id      TEXT    NOT NULL,
    cost           INTEGER NOT NULL,
    enabled        INTEGER NOT NULL DEFAULT 1,
    created_at     INTEGER NOT NULL,
    PRIMARY KEY (broadcaster_id, effect_key)
  );
  CREATE INDEX IF NOT EXISTS idx_twitch_rewards_reward ON twitch_rewards(reward_id);

  -- Recent activity log — every redemption and cheer the EventSub session
  -- received, with whether it triggered an effect. Capped at the last 100
  -- rows per broadcaster on insert. Used by the /twitch settings page.
  CREATE TABLE IF NOT EXISTS twitch_events (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    broadcaster_id TEXT    NOT NULL,
    received_at    INTEGER NOT NULL,
    source         TEXT    NOT NULL,
    effect_key     TEXT,
    applied        INTEGER NOT NULL,
    fail_reason    TEXT,
    user_login     TEXT,
    bits           INTEGER,
    reward_title   TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_twitch_events_recent
    ON twitch_events(broadcaster_id, received_at DESC);
`;

let _db: Database.Database | null = null;

function resolveDbPath(): string {
  const raw = process.env.DB_PATH || "./data/gauntlet.sqlite";
  return isAbsolute(raw) ? raw : resolve(process.cwd(), raw);
}

export function getDb(): Database.Database {
  if (_db) return _db;
  const path = resolveDbPath();
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.exec(MIGRATIONS);
  // Idempotent ALTERs for columns introduced after the table existed in the
  // wild. SQLite has no IF NOT EXISTS for ADD COLUMN, so we PRAGMA-check first.
  ensureColumn(db, "twitch_links", "auto_category", "INTEGER NOT NULL DEFAULT 0");
  _db = db;
  console.log(`[db] opened sqlite at ${path}`);
  return db;
}

interface PragmaColumn { name: string }
function ensureColumn(db: Database.Database, table: string, column: string, decl: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as PragmaColumn[];
  if (cols.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
  console.log(`[db] added column ${table}.${column}`);
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

export interface RecordRunArgs {
  roomCode: string;
  entry: RunHistoryEntry;
  members: SteamSessionUser[];
  /** Per-game completion times, captured by room-store before any reset. */
  gameDurations: Record<number, number>;
}

/**
 * Persist a finished gauntlet run with its players and per-game results.
 * Swallows errors — a DB failure must never break a live room.
 */
export function recordRun(args: RecordRunArgs): boolean {
  const db = getDb();

  const upsertPlayer = db.prepare(`
    INSERT INTO players (steam_id, display_name, avatar_url, profile_url, last_seen_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(steam_id) DO UPDATE SET
      display_name = excluded.display_name,
      avatar_url   = excluded.avatar_url,
      profile_url  = excluded.profile_url,
      last_seen_at = excluded.last_seen_at
  `);
  const insertRun = db.prepare(`
    INSERT INTO runs (room_code, ended_at, outcome, difficulty, penalty_mode,
                      attempts, completed, total, failed_game_id, duration_s)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertRunPlayer = db.prepare(`
    INSERT INTO run_players (run_id, steam_id) VALUES (?, ?)
    ON CONFLICT DO NOTHING
  `);
  const insertRunGame = db.prepare(`
    INSERT INTO run_games (run_id, slot, game_id, completed, duration_s, champion_steam_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction(() => {
    const { entry, members, roomCode, gameDurations } = args;
    for (const m of members) {
      upsertPlayer.run(m.steamId, m.displayName, m.avatarUrl, m.profileUrl, entry.ts);
    }
    // Client stores duration in milliseconds (Date.now() - runStartTime),
    // but our schema column is duration_s (seconds, matching gameDurations).
    // Convert here so synthetic test data and real-run data both speak seconds.
    const durationSeconds = Math.max(1, Math.round(entry.duration / 1000));
    const result = insertRun.run(
      roomCode,
      entry.ts,
      entry.outcome,
      entry.difficulty,
      entry.penaltyMode,
      entry.attempts,
      entry.completed,
      entry.total,
      entry.failedGameId,
      durationSeconds,
    );
    const runId = Number(result.lastInsertRowid);
    for (const m of members) {
      insertRunPlayer.run(runId, m.steamId);
    }
    // Sequential gauntlet: slots [0, completed) are cleared; slot [completed]
    // is the failed game on a loss; the rest are unplayed but still drawn.
    for (let slot = 0; slot < entry.runIds.length; slot++) {
      const gameId = entry.runIds[slot];
      const completed = slot < entry.completed ? 1 : 0;
      const duration = completed ? gameDurations[gameId] ?? null : null;
      const champion = entry.championPicks[gameId] ?? null;
      insertRunGame.run(runId, slot, gameId, completed, duration, champion);
    }
  });

  try {
    tx();
    return true;
  } catch (err) {
    console.error("[db] recordRun failed:", err);
    return false;
  }
}

const RECENT_RUNS_LIMIT = 20;

/**
 * Aggregate profile payload for a Steam user. Returns null if the user has
 * never been recorded (= never finished a run we know about).
 */
export function getProfile(steamId: string): ProfilePayload | null {
  const db = getDb();

  const player = db
    .prepare(
      `SELECT steam_id   AS steamId,
              display_name AS displayName,
              avatar_url AS avatarUrl,
              profile_url AS profileUrl
         FROM players
        WHERE steam_id = ?`,
    )
    .get(steamId) as ProfilePayload["player"] | undefined;
  if (!player) return null;

  const summary = db
    .prepare(
      `SELECT
         COUNT(*) AS totalRuns,
         SUM(CASE WHEN r.outcome = 'win'  THEN 1 ELSE 0 END) AS wins,
         SUM(CASE WHEN r.outcome = 'lose' THEN 1 ELSE 0 END) AS losses,
         MIN(CASE WHEN r.outcome = 'win' THEN r.duration_s END) AS fastestWin,
         MIN(CASE WHEN r.outcome = 'win' AND r.difficulty = 'hardcore'
                  THEN r.duration_s END) AS fastestHcWin
       FROM runs r
       JOIN run_players rp ON rp.run_id = r.id
      WHERE rp.steam_id = ?`,
    )
    .get(steamId) as {
      totalRuns: number;
      wins: number | null;
      losses: number | null;
      fastestWin: number | null;
      fastestHcWin: number | null;
    };

  const totalRuns = summary.totalRuns ?? 0;
  const wins = summary.wins ?? 0;
  const losses = summary.losses ?? 0;

  const fearedRow = db
    .prepare(
      `SELECT r.failed_game_id AS gameId, COUNT(*) AS failCount
         FROM runs r
         JOIN run_players rp ON rp.run_id = r.id
        WHERE rp.steam_id = ?
          AND r.outcome = 'lose'
          AND r.failed_game_id IS NOT NULL
        GROUP BY r.failed_game_id
        ORDER BY failCount DESC, gameId ASC
        LIMIT 1`,
    )
    .get(steamId) as { gameId: number; failCount: number } | undefined;

  type RunRow = {
    id: number;
    endedAt: number;
    outcome: "win" | "lose";
    difficulty: ProfileRun["difficulty"];
    penaltyMode: ProfileRun["penaltyMode"];
    attempts: number;
    completed: number;
    total: number;
    failedGameId: number | null;
    durationSeconds: number;
  };

  const runRows = db
    .prepare(
      `SELECT r.id              AS id,
              r.ended_at        AS endedAt,
              r.outcome         AS outcome,
              r.difficulty      AS difficulty,
              r.penalty_mode    AS penaltyMode,
              r.attempts        AS attempts,
              r.completed       AS completed,
              r.total           AS total,
              r.failed_game_id  AS failedGameId,
              r.duration_s      AS durationSeconds
         FROM runs r
         JOIN run_players rp ON rp.run_id = r.id
        WHERE rp.steam_id = ?
        ORDER BY r.ended_at DESC
        LIMIT ?`,
    )
    .all(steamId, RECENT_RUNS_LIMIT) as RunRow[];

  // Single follow-up query for everyone in those runs — group in JS.
  const playersByRun = new Map<number, ProfileRunPlayer[]>();
  if (runRows.length > 0) {
    const placeholders = runRows.map(() => "?").join(",");
    const playerRows = db
      .prepare(
        `SELECT rp.run_id     AS runId,
                p.steam_id    AS steamId,
                p.display_name AS displayName,
                p.avatar_url  AS avatarUrl
           FROM run_players rp
           JOIN players p ON p.steam_id = rp.steam_id
          WHERE rp.run_id IN (${placeholders})`,
      )
      .all(...runRows.map((r) => r.id)) as Array<
        ProfileRunPlayer & { runId: number }
      >;
    for (const row of playerRows) {
      const { runId, ...player } = row;
      let list = playersByRun.get(runId);
      if (!list) {
        list = [];
        playersByRun.set(runId, list);
      }
      list.push(player);
    }
  }

  const recentRuns: ProfileRun[] = runRows.map((r) => ({
    ...r,
    players: playersByRun.get(r.id) ?? [],
  }));

  return {
    player,
    stats: {
      totalRuns,
      wins,
      losses,
      winRate: totalRuns > 0 ? wins / totalRuns : null,
      fastestWinSeconds: summary.fastestWin,
      fastestHardcoreWinSeconds: summary.fastestHcWin,
      mostFearedGame: fearedRow ?? null,
    },
    recentRuns,
  };
}

const LEADERBOARD_LIMIT = 10;

type FastestRow = {
  id: number;
  endedAt: number;
  durationSeconds: number;
  difficulty: Difficulty;
};

/**
 * Fetch the top fastest winning runs, optionally restricted to one difficulty.
 * Co-players are attached via a single follow-up query.
 */
function fetchFastestWins(
  db: Database.Database,
  difficulty: Difficulty | null,
): LeaderboardRun[] {
  const where = difficulty
    ? `WHERE r.outcome = 'win' AND r.difficulty = ?`
    : `WHERE r.outcome = 'win'`;
  const args: unknown[] = difficulty ? [difficulty, LEADERBOARD_LIMIT] : [LEADERBOARD_LIMIT];
  const rows = db
    .prepare(
      `SELECT r.id          AS id,
              r.ended_at    AS endedAt,
              r.duration_s  AS durationSeconds,
              r.difficulty  AS difficulty
         FROM runs r
         ${where}
         ORDER BY r.duration_s ASC, r.ended_at ASC
         LIMIT ?`,
    )
    .all(...args) as FastestRow[];

  if (rows.length === 0) return [];

  const placeholders = rows.map(() => "?").join(",");
  const playerRows = db
    .prepare(
      `SELECT rp.run_id      AS runId,
              p.steam_id     AS steamId,
              p.display_name AS displayName,
              p.avatar_url   AS avatarUrl
         FROM run_players rp
         JOIN players p ON p.steam_id = rp.steam_id
        WHERE rp.run_id IN (${placeholders})`,
    )
    .all(...rows.map((r) => r.id)) as Array<ProfileRunPlayer & { runId: number }>;

  const byRun = new Map<number, ProfileRunPlayer[]>();
  for (const row of playerRows) {
    const { runId, ...p } = row;
    let list = byRun.get(runId);
    if (!list) {
      list = [];
      byRun.set(runId, list);
    }
    list.push(p);
  }

  return rows.map((r) => ({ ...r, players: byRun.get(r.id) ?? [] }));
}

/**
 * Aggregate leaderboards: fastest runs (per-difficulty buckets), most wins,
 * longest consecutive-win streak, most runs played. Each board capped at the
 * top 10 entries.
 */
export function getLeaderboards(): LeaderboardsPayload {
  const db = getDb();

  const fastestWins = {
    all: fetchFastestWins(db, null),
    normal: fetchFastestWins(db, "normal"),
    hardcore: fetchFastestWins(db, "hardcore"),
  };

  const mostWins = db
    .prepare(
      `SELECT p.steam_id    AS steamId,
              p.display_name AS displayName,
              p.avatar_url  AS avatarUrl,
              COUNT(*)      AS value
         FROM run_players rp
         JOIN runs r    ON r.id = rp.run_id
         JOIN players p ON p.steam_id = rp.steam_id
        WHERE r.outcome = 'win'
        GROUP BY rp.steam_id
        ORDER BY value DESC, p.display_name ASC
        LIMIT ?`,
    )
    .all(LEADERBOARD_LIMIT) as LeaderboardPlayer[];

  const mostRuns = db
    .prepare(
      `SELECT p.steam_id    AS steamId,
              p.display_name AS displayName,
              p.avatar_url  AS avatarUrl,
              COUNT(*)      AS value
         FROM run_players rp
         JOIN players p ON p.steam_id = rp.steam_id
        GROUP BY rp.steam_id
        ORDER BY value DESC, p.display_name ASC
        LIMIT ?`,
    )
    .all(LEADERBOARD_LIMIT) as LeaderboardPlayer[];

  // Gaps-and-islands: for each player's runs ordered by ended_at, the diff
  // between the global row number and the per-outcome row number stays
  // constant inside one consecutive-outcome streak. Counting wins per group
  // and taking the max yields the longest win streak per player.
  const longestStreak = db
    .prepare(
      `WITH player_runs AS (
         SELECT rp.steam_id,
                r.outcome,
                ROW_NUMBER() OVER (PARTITION BY rp.steam_id ORDER BY r.ended_at) -
                ROW_NUMBER() OVER (PARTITION BY rp.steam_id, r.outcome ORDER BY r.ended_at) AS grp
           FROM runs r
           JOIN run_players rp ON rp.run_id = r.id
       ),
       streaks AS (
         SELECT steam_id, COUNT(*) AS streak_len
           FROM player_runs
          WHERE outcome = 'win'
          GROUP BY steam_id, grp
       )
       SELECT s.steam_id     AS steamId,
              p.display_name AS displayName,
              p.avatar_url   AS avatarUrl,
              MAX(s.streak_len) AS value
         FROM streaks s
         JOIN players p ON p.steam_id = s.steam_id
        GROUP BY s.steam_id
        ORDER BY value DESC, p.display_name ASC
        LIMIT ?`,
    )
    .all(LEADERBOARD_LIMIT) as LeaderboardPlayer[];

  return { fastestWins, mostWins, longestStreak, mostRuns };
}

/**
 * Per-game aggregate stats across all recorded runs.
 *
 * Important distinction: a row in `run_games` with completed=0 means EITHER the
 * game was the run's failure point OR the run ended before reaching it. Pure
 * clearance/failure rates therefore can't be derived from `run_games` alone —
 * we cross-reference `runs.failed_game_id` to count true failures.
 */
export function getGameStats(): GameStatsPayload {
  const db = getDb();

  const totalRuns = (db.prepare(`SELECT COUNT(*) AS n FROM runs`).get() as { n: number }).n;

  const games = db
    .prepare(
      `WITH appearances AS (
         SELECT game_id,
                COUNT(*)        AS drawn,
                SUM(completed)  AS completed_count,
                AVG(CASE WHEN completed = 1 THEN duration_s END) AS avg_duration
           FROM run_games
          GROUP BY game_id
       ),
       failures AS (
         SELECT failed_game_id AS game_id, COUNT(*) AS failed_count
           FROM runs
          WHERE failed_game_id IS NOT NULL
          GROUP BY failed_game_id
       )
       SELECT a.game_id                        AS gameId,
              a.drawn                          AS drawn,
              a.completed_count                AS completed,
              COALESCE(f.failed_count, 0)      AS failed,
              a.avg_duration                   AS avgDurationSeconds
         FROM appearances a
         LEFT JOIN failures f ON f.game_id = a.game_id
        ORDER BY a.drawn DESC, a.game_id ASC`,
    )
    .all() as GameStats[];

  // SQLite AVG returns a float; round to nearest second for cleanliness.
  for (const g of games) {
    if (g.avgDurationSeconds !== null) {
      g.avgDurationSeconds = Math.round(g.avgDurationSeconds);
    }
  }

  return { totalRuns, games };
}
