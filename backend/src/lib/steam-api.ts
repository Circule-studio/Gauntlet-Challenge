// Calls to api.steampowered.com — GetOwnedGames + GetPlayerSummaries.
// Handles 10s timeout, retries 429s up to 3x with exponential backoff.

import { env } from "./env";
import { cache } from "./cache";
import { HttpError } from "./auth";
import type {
  GetOwnedGamesResponse,
  GetPlayerSummariesResponse,
  SteamPlayerSummary,
  SteamOwnedGame,
} from "@shared/types/steam";

const API_BASE = "https://api.steampowered.com";
const TIMEOUT_MS = 10_000;
const MAX_RETRIES = 3;

async function steamFetch(url: string, attempt = 0): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (res.status === 429 && attempt < MAX_RETRIES) {
      const retryAfter = Number(res.headers.get("retry-after")) * 1000 || 2000 * (attempt + 1);
      await new Promise((r) => setTimeout(r, retryAfter));
      return steamFetch(url, attempt + 1);
    }
    return res;
  } catch (e) {
    if ((e as Error).name === "AbortError") {
      throw new HttpError(502, "Steam API timeout");
    }
    throw new HttpError(502, "Steam API unreachable");
  } finally {
    clearTimeout(timer);
  }
}

/** Returns the player summary or null if Steam returned no entry for that ID. */
export async function getPlayerSummary(steamId: string): Promise<SteamPlayerSummary | null> {
  const cacheKey = `summary:${steamId}`;
  const cached = cache.get<SteamPlayerSummary | null>(cacheKey);
  if (cached !== undefined) return cached;

  const url = `${API_BASE}/ISteamUser/GetPlayerSummaries/v2/?key=${env.STEAM_API_KEY}&steamids=${steamId}`;
  const res = await steamFetch(url);
  if (res.status === 401 || res.status === 403) {
    throw new HttpError(403, "Steam API key invalid");
  }
  if (!res.ok) throw new HttpError(502, `Steam API error ${res.status}`);
  const data = (await res.json()) as GetPlayerSummariesResponse;
  const summary = data.response.players?.[0] ?? null;
  cache.set(cacheKey, summary, 300); // 5 min — matches the visibility cache requirement
  return summary;
}

/**
 * GetOwnedGames. Returns the user's full visible library (empty if game-details
 * privacy hides it). Cached for 5 min per steamId so a run with multiple games
 * only triggers one Steam call. We deliberately don't pass appids_filter — the
 * per-key array form (`appids_filter[0]=…`) is sometimes silently ignored by
 * Steam, which wipes the response and made everything look unowned. Filtering
 * locally against the full library is reliable.
 */
export interface SteamPlayerAchievement {
  apiname: string;
  achieved: 0 | 1;
  unlocktime: number;
}

/**
 * GetPlayerAchievements. Returns the user's achievement state for a single
 * Steam app. Cached 30s per (steamId, appid) — short enough that "verify"
 * feels fresh, long enough to avoid hammering on a busy room.
 *
 * Throws HttpError 403 when the profile or game stats are private.
 */
export async function getPlayerAchievements(
  steamId: string,
  appid: number,
): Promise<SteamPlayerAchievement[]> {
  const cacheKey = `ach:${steamId}:${appid}`;
  const cached = cache.get<SteamPlayerAchievement[]>(cacheKey);
  if (cached !== undefined) return cached;
  const params = new URLSearchParams({
    key: env.STEAM_API_KEY,
    steamid: steamId,
    appid: String(appid),
  });
  const url = `${API_BASE}/ISteamUserStats/GetPlayerAchievements/v1/?${params.toString()}`;
  const res = await steamFetch(url);
  if (res.status === 401 || res.status === 403) {
    throw new HttpError(403, "Profil Steam privé ou succès non accessibles");
  }
  if (res.status === 400) {
    // Steam returns 400 when the game has no public achievements schema.
    cache.set(cacheKey, [], 30);
    return [];
  }
  if (!res.ok) throw new HttpError(502, `Steam API error ${res.status}`);
  const data = (await res.json()) as { playerstats?: { achievements?: SteamPlayerAchievement[]; success?: boolean } };
  const list = data.playerstats?.achievements ?? [];
  cache.set(cacheKey, list, 30);
  return list;
}

export async function getOwnedGames(steamId: string): Promise<SteamOwnedGame[]> {
  const cacheKey = `games:${steamId}`;
  const cached = cache.get<SteamOwnedGame[]>(cacheKey);
  if (cached !== undefined) return cached;
  const params = new URLSearchParams({
    key: env.STEAM_API_KEY,
    steamid: steamId,
    include_appinfo: "true",
    include_played_free_games: "true",
  });
  const url = `${API_BASE}/IPlayerService/GetOwnedGames/v1/?${params.toString()}`;
  const res = await steamFetch(url);
  if (res.status === 401 || res.status === 403) {
    throw new HttpError(403, "Steam API key invalid");
  }
  if (!res.ok) throw new HttpError(502, `Steam API error ${res.status}`);
  const data = (await res.json()) as GetOwnedGamesResponse;
  const games = data.response.games ?? [];
  cache.set(cacheKey, games, 300);
  return games;
}
