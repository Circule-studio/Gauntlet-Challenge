export type GameMode = "team" | "solo" | "duo";

export interface Game {
  id: number;
  name: string;
  cat: string;
  mode: GameMode;
  normal: string;
  hardcore: string;
  /** If true, this game becomes solo-mode only when difficulty === 'hardcore'. */
  soloHardcore?: boolean;
  /** Steam App ID for cover art. Leave undefined for non-Steam games. */
  appid?: number;
  /** Custom cover URL (overrides appid). Used for non-Steam games. */
  cover?: string;
  /** True for games whose objective is timed — surfaces a player-set countdown
   *  on the current game tile, synced across all clients in the room. */
  timer?: boolean;
  /** Optional Steam achievement-based objective. When present, the game tile
   *  exposes a "Vérifier succès" button that hits Steam and auto-completes the
   *  game when the achievement is unlocked. Requires `appid` to be set. */
  achievement?: {
    /** Internal API name of the achievement (the SDK identifier). */
    apiname: string;
    /** Optional display label override. Defaults to the achievement's display
     *  name returned by Steam. */
    label?: string;
  };
}

export type Difficulty = "normal" | "hardcore";
export type PenaltyMode = "reset" | "stepback";

export interface RunHistoryEntry {
  id: number;
  ts: number;
  outcome: "win" | "lose";
  attempts: number;
  duration: number;
  difficulty: Difficulty;
  penaltyMode: PenaltyMode;
  runIds: number[];
  failedGameId: number | null;
  championPicks: Record<number, string>;
  completed: number;
  total: number;
}

export interface SteamLink {
  steamId: string;
  displayName: string;
  avatarUrl: string;
  profileUrl: string;
}

export interface PowerUp {
  joker: number;   // swaps remaining
  shield: number;  // shields remaining
  reroll: number;  // champion re-draws remaining
}

export interface GauntletState {
  attempt: number;
  current: number;
  difficulty: Difficulty;
  penaltyMode: PenaltyMode;
  players: string[];
  playerCount: number;
  pinned: number[];
  run: number[];
  champions: Record<number, string>;
  done: number[];
  filter: string;
  search: string;
  soundEnabled: boolean;
  showHistory: boolean;
  runStartTime: number | null;
  // Absolute ms epoch when the per-game countdown expires (for games with
  // `timer: true`). Null when no countdown is running. Reset to null on every
  // game advance / loss / reset so it doesn't leak into the next game.
  timerDeadline: number | null;
  // In-flight slot-machine champion draw, broadcast so every client renders
  // the same reels and runs the animation from the same `startedAt`. Cleared
  // when the initiator commits the result to `champions`. Null when no draw
  // is in flight.
  drawing: {
    gameId: number;
    reels: string[][];
    final: string[];
    pairSize: number;
    startedAt: number;
    initiator: string;
  } | null;
  // Run-in-preparation: the 10 game IDs the host has generated, broadcast so
  // every member sees the same review modal. Null when no run is being
  // prepared. Cleared on cancel or when the countdown finishes and `run` is
  // committed.
  pendingRun: number[] | null;
  // Steam IDs of members who have clicked "Ready" in the preparation modal.
  // Reset every time `pendingRun` is set.
  readyPlayers: string[];
  // Set by the host (or auto when everyone is ready) to start the synced
  // 3-2-1-GO countdown. Absolute ms epoch when the countdown started; every
  // client derives the current digit from `now - countdownStartedAt`.
  countdownStartedAt: number | null;
  runFails: Record<number, number>;
  history: RunHistoryEntry[];
  steamLinks: Record<number, SteamLink>;
  powerUps: Record<string, PowerUp>; // steamId → remaining power-ups
  shieldActive: boolean;             // true = next defeat is negated
  powerUpsEnabled: boolean;          // whether the power-up system is active
  // Per-member Steam ownership for the games in the current run.
  // Outer key: steamId. Inner key: appid (as string, JSON-safe). Value:
  // true=owned, false=not owned. Absent means "unknown / not yet checked".
  ownership: Record<string, Record<string, boolean>>;
  // Manual claims (or denials) made by clicking your own chip. Always wins
  // over `ownership` for the UI. Used to override Steam when the API can't
  // see a private library or the user just wants to assert ownership.
  ownershipOverride: Record<string, Record<string, boolean>>;
  // When true, generateRun only picks Steam-backed games (with an appid) that
  // every human member of the room owns. Synced so all members see the same
  // toggle state in the config panel.
  libraryOnlyMode: boolean;
  // When true, generateRun deterministically picks the games this room has
  // played the least often (with random tiebreak) instead of pure random.
  leastPlayedMode: boolean;
  // Versus mode — splits the room into two opposing teams ("red"/"blue") and
  // tracks per-game wins instead of cooperative defeat. The team with the
  // most won games at the end of the run wins the gauntlet.
  versusMode: boolean;
  teams: Record<string, "red" | "blue">; // steamId → team
  gameWinners: Record<number, "red" | "blue">; // gameId → winning team
  // Number of games per run. Default 10; can be reduced for quicker sessions.
  runLength: number;
}

export const DEFAULT_STATE: GauntletState = {
  attempt: 1,
  current: 0,
  difficulty: "normal",
  penaltyMode: "reset",
  players: [],
  playerCount: 0,
  pinned: [],
  run: [],
  champions: {},
  done: [],
  filter: "all",
  search: "",
  soundEnabled: true,
  showHistory: false,
  runStartTime: null,
  timerDeadline: null,
  drawing: null,
  pendingRun: null,
  readyPlayers: [],
  countdownStartedAt: null,
  runFails: {},
  history: [],
  steamLinks: {},
  powerUps: {},
  shieldActive: false,
  powerUpsEnabled: true,
  ownership: {},
  ownershipOverride: {},
  libraryOnlyMode: false,
  leastPlayedMode: false,
  versusMode: false,
  teams: {},
  gameWinners: {},
  runLength: 10,
};
