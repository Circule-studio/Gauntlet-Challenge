// Helix + OAuth client for Twitch. Thin wrappers around fetch — no SDK, the
// surface we need is small. All functions throw on transport / non-2xx.

import { env } from "./env";
import {
  deleteLink,
  getLinkBySteamId,
  updateTokens,
  type TwitchLink,
} from "./twitch-store";

const OAUTH_BASE = "https://id.twitch.tv/oauth2";
const HELIX_BASE = "https://api.twitch.tv/helix";

// Refresh proactively when less than this is left on the token.
const REFRESH_LEEWAY_MS = 60_000;

export interface TwitchTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string[];
  token_type: "bearer";
}

export interface TwitchUser {
  id: string;
  login: string;
  display_name: string;
  profile_image_url: string;
}

export class TwitchApiError extends Error {
  constructor(
    public status: number,
    public body: string,
    message: string,
  ) {
    super(message);
  }
}

async function postForm(
  url: string,
  params: Record<string, string>,
): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
}

async function readJsonOrThrow<T>(res: Response, ctx: string): Promise<T> {
  const text = await res.text();
  if (!res.ok) {
    throw new TwitchApiError(res.status, text, `${ctx} failed (${res.status})`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new TwitchApiError(res.status, text, `${ctx} returned invalid JSON`);
  }
}

export async function exchangeCodeForTokens(code: string): Promise<TwitchTokenResponse> {
  const res = await postForm(`${OAUTH_BASE}/token`, {
    client_id: env.TWITCH_CLIENT_ID,
    client_secret: env.TWITCH_CLIENT_SECRET,
    code,
    grant_type: "authorization_code",
    redirect_uri: env.TWITCH_REDIRECT_URI,
  });
  return readJsonOrThrow<TwitchTokenResponse>(res, "token exchange");
}

export async function refreshAccessToken(refreshToken: string): Promise<TwitchTokenResponse> {
  const res = await postForm(`${OAUTH_BASE}/token`, {
    client_id: env.TWITCH_CLIENT_ID,
    client_secret: env.TWITCH_CLIENT_SECRET,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  return readJsonOrThrow<TwitchTokenResponse>(res, "token refresh");
}

export async function revokeToken(token: string): Promise<void> {
  // Twitch returns 200 on success and 400 if the token was already invalid;
  // both are fine for our "best-effort" disconnect flow, so don't throw.
  await postForm(`${OAUTH_BASE}/revoke`, {
    client_id: env.TWITCH_CLIENT_ID,
    token,
  });
}

export async function getSelfUser(accessToken: string): Promise<TwitchUser> {
  const res = await fetch(`${HELIX_BASE}/users`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Client-Id": env.TWITCH_CLIENT_ID,
    },
  });
  const body = await readJsonOrThrow<{ data: TwitchUser[] }>(res, "users self");
  if (!body.data || body.data.length === 0) {
    throw new TwitchApiError(500, JSON.stringify(body), "users self returned empty");
  }
  return body.data[0];
}

export interface HelixGame {
  id: string;
  name: string;
  box_art_url?: string;
}

/**
 * Resolve a Twitch category by exact name (case-insensitive). Returns null when
 * Twitch doesn't have a matching category — the caller decides whether to log
 * and skip or fall back to a manual id.
 */
export async function getHelixGameByName(
  name: string,
  accessToken: string,
): Promise<HelixGame | null> {
  const url = `${HELIX_BASE}/games?name=${encodeURIComponent(name)}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Client-Id": env.TWITCH_CLIENT_ID,
    },
  });
  const body = await readJsonOrThrow<{ data: HelixGame[] }>(res, "games by name");
  return body.data?.[0] ?? null;
}

/**
 * Update a broadcaster's stream category. Requires the
 * `channel:manage:broadcast` scope on the access token. Twitch returns 204 on
 * success.
 */
export async function modifyChannelGame(
  broadcasterId: string,
  gameId: string,
  accessToken: string,
): Promise<void> {
  const res = await fetch(
    `${HELIX_BASE}/channels?broadcaster_id=${encodeURIComponent(broadcasterId)}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Client-Id": env.TWITCH_CLIENT_ID,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ game_id: gameId }),
    },
  );
  if (res.status !== 204) {
    const text = await res.text().catch(() => "");
    throw new TwitchApiError(res.status, text, `modify channel failed (${res.status})`);
  }
}

/**
 * Return a Twitch access token usable right now for a given Steam user, refreshing
 * with the stored refresh_token if the current one is expiring within the leeway.
 *
 * Returns null when the user has no Twitch link or the refresh failed (in which
 * case the link is wiped — they'll need to re-authorize).
 */
export async function getValidAccessToken(steamId: string): Promise<string | null> {
  const link = getLinkBySteamId(steamId);
  if (!link) return null;
  if (link.expiresAt - Date.now() > REFRESH_LEEWAY_MS) return link.accessToken;

  try {
    const fresh = await refreshAccessToken(link.refreshToken);
    const expiresAt = Date.now() + fresh.expires_in * 1000;
    updateTokens(steamId, fresh.access_token, fresh.refresh_token, expiresAt);
    return fresh.access_token;
  } catch (err) {
    console.warn(`[twitch] refresh failed for steamId=${steamId}, dropping link:`, err);
    deleteLink(steamId);
    return null;
  }
}

export type { TwitchLink };
