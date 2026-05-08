// Maps the rich GauntletState into the flat shape the Twitch overlay widgets
// expect (totalElapsed/startedAt timer fields, victories/goal/resets counters,
// games[] with status). The overlay HTML is intentionally not rewritten — the
// mapping lives here so the widget JS stays unchanged.

import { POOL } from "@shared/games";
import type { GauntletState } from "@shared/types";

export type OverlayGameStatus = "upcoming" | "current" | "completed";

export interface OverlayGame {
  id: number;
  name: string;
  player: string;
  duration: number;
  status: OverlayGameStatus;
  coverUrl: string | null;
  /** Objective text for the run's current difficulty. Pre-resolved server-side
   *  so the widget doesn't need to know about the normal/hardcore split. */
  objective: string;
}

export interface OverlayState {
  totalElapsed: number;
  startedAt: number | null;
  victories: number;
  goal: number;
  resets: number;
  currentGameId: number | null;
  currentGameStartedAt: number | null;
  currentGameElapsed: number;
  games: OverlayGame[];
}

const POOL_BY_ID = new Map(POOL.map((g) => [g.id, g]));

export function mapToOverlay(
  state: GauntletState,
  currentGameStartedAt: number | null,
  gameDurations: Record<number, number>,
): OverlayState {
  const currentGameId = state.run[state.current] ?? null;
  const doneSet = new Set(state.done);

  const games: OverlayGame[] = state.run.map((id, idx) => {
    const g = POOL_BY_ID.get(id);
    // Same-origin proxy for Steam art — see app/api/steam/cover/[appid]/route.ts
    // for why we don't hotlink the Steam CDN directly.
    const coverUrl =
      g?.cover ?? (g?.appid ? `/api/steam/cover/${g.appid}` : null);
    const objective = g
      ? state.difficulty === "hardcore" ? g.hardcore : g.normal
      : "";
    return {
      id,
      name: g?.name ?? `Game ${id}`,
      player: state.champions[id] ?? "",
      duration: gameDurations[id] ?? 0,
      status: doneSet.has(id)
        ? "completed"
        : idx === state.current
          ? "current"
          : "upcoming",
      coverUrl,
      objective,
    };
  });

  return {
    totalElapsed: 0,
    startedAt: state.runStartTime,
    victories: state.done.length,
    goal: state.run.length || 10,
    resets: Math.max(0, state.attempt - 1),
    currentGameId,
    currentGameStartedAt: currentGameId !== null ? currentGameStartedAt : null,
    currentGameElapsed: 0,
    games,
  };
}
