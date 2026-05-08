// Auto-update a broadcaster's Twitch category to match the current gauntlet
// game. Best-effort: every step swallows errors and logs, since a Twitch API
// blip should never affect the live room state.
//
// Wiring: room-store calls `triggerCategoryUpdate` whenever the active game
// changes. We iterate the room's members, look up each one's Twitch link,
// and PATCH /helix/channels for the ones who opted in.

import { POOL } from "@shared/games";
import { getLinkBySteamId } from "./twitch-store";
import {
  getHelixGameByName,
  getValidAccessToken,
  modifyChannelGame,
} from "./twitch-api";

const AUTO_CATEGORY_SCOPE = "channel:manage:broadcast";
const POOL_BY_ID = new Map(POOL.map((g) => [g.id, g]));

// Cache name → Twitch game id lookups for the lifetime of the process. Names
// don't change, so this is safe forever; the only downside on a long-lived
// host is "I renamed a game in games.ts and the old id is still cached" —
// restart fixes it.
const idCache = new Map<string, string | null>();

/**
 * Fire the auto-category update for every member of `memberSteamIds` whose
 * Twitch link has the toggle on AND the required scope. Returns immediately;
 * the actual Helix calls happen in the background.
 */
export function triggerCategoryUpdate(
  memberSteamIds: string[],
  gameId: number,
): void {
  const game = POOL_BY_ID.get(gameId);
  if (!game) {
    console.warn(`[twitch-category] unknown gameId=${gameId}`);
    return;
  }
  for (const steamId of memberSteamIds) {
    const link = getLinkBySteamId(steamId);
    if (!link) continue;
    if (!link.autoCategory) continue;
    if (!link.scopes.includes(AUTO_CATEGORY_SCOPE)) {
      console.warn(
        `[twitch-category] steamId=${steamId} has autoCategory=on but missing ${AUTO_CATEGORY_SCOPE} scope — skipping`,
      );
      continue;
    }
    void updateOne(steamId, link.broadcasterId, game.name).catch((err) => {
      console.warn(
        `[twitch-category] update failed for ${link.login} (${game.name}):`,
        err instanceof Error ? err.message : err,
      );
    });
  }
}

async function updateOne(
  steamId: string,
  broadcasterId: string,
  gameName: string,
): Promise<void> {
  const token = await getValidAccessToken(steamId);
  if (!token) return; // link evicted by token refresh — nothing to do
  const gameId = await resolveTwitchGameId(gameName, token);
  if (!gameId) {
    console.warn(`[twitch-category] no Twitch category found for "${gameName}"`);
    return;
  }
  await modifyChannelGame(broadcasterId, gameId, token);
  console.log(`[twitch-category] ${broadcasterId} → "${gameName}" (${gameId})`);
}

async function resolveTwitchGameId(
  gameName: string,
  accessToken: string,
): Promise<string | null> {
  if (idCache.has(gameName)) return idCache.get(gameName) ?? null;
  const helixGame = await getHelixGameByName(gameName, accessToken);
  const id = helixGame?.id ?? null;
  idCache.set(gameName, id);
  return id;
}
