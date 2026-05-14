// Steam OpenID 2.0 — manual implementation.
//
// The flow:
//   1. buildLoginUrl() returns the URL we redirect the user to. Steam handles login.
//   2. Steam redirects back to STEAM_RETURN_URL with a bunch of openid.* params.
//   3. verifyAssertion() POSTs those params back to Steam with mode=check_authentication.
//      Steam responds with `is_valid:true` if the assertion is genuine.
//   4. extractSteamId() pulls the SteamID64 out of the claimed_id URL.

import { env } from "./env";

const STEAM_OPENID_ENDPOINT = "https://steamcommunity.com/openid/login";

export function buildLoginUrl(pairCode?: string, next?: string): string {
  // Append optional state as a query param on return_to. Steam preserves it
  // through the round-trip, so the callback can read it and route the user
  // back to wherever they came from (pairing flow, room invite link, etc.).
  const state = new URLSearchParams();
  if (pairCode) state.set("pair", pairCode);
  if (next) state.set("next", next);
  const stateQs = state.toString();
  const returnTo = stateQs ? `${env.STEAM_RETURN_URL}?${stateQs}` : env.STEAM_RETURN_URL;
  const params = new URLSearchParams({
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.mode": "checkid_setup",
    "openid.return_to": returnTo,
    "openid.realm": env.STEAM_REALM,
    "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
    "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
  });
  return `${STEAM_OPENID_ENDPOINT}?${params.toString()}`;
}

/**
 * Verify the openid.* params returned by Steam by echoing them back with mode=check_authentication.
 * Steam returns a key:value text body; we look for `is_valid:true`.
 */
export async function verifyAssertion(query: URLSearchParams): Promise<boolean> {
  const body = new URLSearchParams(query);
  body.set("openid.mode", "check_authentication");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(STEAM_OPENID_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: ctrl.signal,
    });
    if (!res.ok) return false;
    const text = await res.text();
    return /is_valid\s*:\s*true/i.test(text);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** SteamID64 lives at the end of the claimed_id URL, e.g. .../openid/id/76561198XXXXXXXXX */
export function extractSteamId(claimedId: string | null): string | null {
  if (!claimedId) return null;
  const m = claimedId.match(/\/openid\/id\/(\d{17})$/);
  return m ? m[1] : null;
}
