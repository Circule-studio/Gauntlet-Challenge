// /api/twitch/* — OAuth flow + connection status. EventSub plumbing lives in
// later phases; Phase 1 is just "Steam user can connect their Twitch".

import { Router } from "express";
import jwt from "jsonwebtoken";
import { env } from "../lib/env";
import { requireAuth } from "../middleware/auth";
import {
  exchangeCodeForTokens,
  getSelfUser,
  revokeToken,
} from "../lib/twitch-api";
import {
  deleteEventsForBroadcaster,
  deleteLink,
  getLinkBySteamId,
  listRewards,
  listTwitchEvents,
  setAutoCategory,
  upsertLink,
} from "../lib/twitch-store";
import { ensureRewards, tearDownRewards } from "../lib/twitch-rewards";
import {
  start as startEventSub,
  stop as stopEventSub,
  getStatus as getEventSubStatus,
} from "../lib/twitch-eventsub";
import { EFFECTS, EFFECT_KEYS } from "../lib/twitch-effects";
import { broadcastMembersForUser } from "../lib/room-store";

const router = Router();

const SCOPES = [
  "channel:read:redemptions",
  "channel:manage:redemptions",
  "bits:read",
  // Required for the auto-category feature (PATCH /helix/channels). Users who
  // connected before this scope was added will see canAutoCategory=false until
  // they reconnect.
  "channel:manage:broadcast",
];
const AUTO_CATEGORY_SCOPE = "channel:manage:broadcast";
const STATE_TTL_SECONDS = 600; // 10 min — enough for a slow Twitch login.

interface OAuthState {
  steamId: string;
  type: "twitch_oauth";
}

function signOAuthState(steamId: string): string {
  const payload: OAuthState = { steamId, type: "twitch_oauth" };
  return jwt.sign(payload, env.JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: STATE_TTL_SECONDS,
  });
}

function verifyOAuthState(token: string): OAuthState | null {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: ["HS256"] });
    if (typeof decoded !== "object" || decoded === null) return null;
    const obj = decoded as Partial<OAuthState>;
    if (obj.type !== "twitch_oauth" || typeof obj.steamId !== "string") return null;
    return { steamId: obj.steamId, type: "twitch_oauth" };
  } catch {
    return null;
  }
}

/** Status of the current user's Twitch link (or no link). */
router.get("/me", requireAuth, (req, res) => {
  const link = getLinkBySteamId(req.user!.steamId);
  if (!link) {
    res.json({ connected: false });
    return;
  }
  res.json({
    connected: true,
    broadcasterId: link.broadcasterId,
    login: link.login,
    displayName: link.displayName,
    scopes: link.scopes,
    connectedAt: link.createdAt,
    autoCategory: link.autoCategory,
    canAutoCategory: link.scopes.includes(AUTO_CATEGORY_SCOPE),
  });
});

/** Kick off the Twitch OAuth flow. Redirects the browser to Twitch. */
router.get("/auth/start", requireAuth, (req, res) => {
  const state = signOAuthState(req.user!.steamId);
  const url = new URL("https://id.twitch.tv/oauth2/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", env.TWITCH_CLIENT_ID);
  url.searchParams.set("redirect_uri", env.TWITCH_REDIRECT_URI);
  url.searchParams.set("scope", SCOPES.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("force_verify", "true");
  res.redirect(url.toString());
});

/**
 * Twitch redirects here with `code` + `state`. We verify the state (signed by
 * us, matches the live session), exchange the code, fetch the broadcaster's
 * user info, and store the link.
 *
 * On any failure we redirect back to /twitch/ with ?error=… so the settings
 * page can surface a human message rather than a JSON 4xx.
 */
router.get("/auth/callback", async (req, res) => {
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const stateRaw = typeof req.query.state === "string" ? req.query.state : "";
  const userDenied = typeof req.query.error === "string" ? req.query.error : null;

  const fail = (reason: string): void => {
    res.redirect(`/twitch/?error=${encodeURIComponent(reason)}`);
  };

  if (userDenied) return fail(userDenied);
  if (!code || !stateRaw) return fail("missing_code_or_state");

  const state = verifyOAuthState(stateRaw);
  if (!state) return fail("invalid_state");
  if (!req.user || req.user.steamId !== state.steamId) return fail("session_mismatch");

  try {
    const tokens = await exchangeCodeForTokens(code);
    const user = await getSelfUser(tokens.access_token);
    upsertLink({
      steamId: state.steamId,
      broadcasterId: user.id,
      login: user.login,
      displayName: user.display_name,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + tokens.expires_in * 1000,
      scopes: Array.isArray(tokens.scope) ? tokens.scope : SCOPES,
    });
    // Spin up EventSub + provision channel-point rewards in the background.
    // Both are best-effort; any failure surfaces in /api/twitch/status rather
    // than blocking the OAuth round-trip.
    startEventSub(user.id, state.steamId);
    void ensureRewards(user.id, state.steamId).then((r) => {
      if (!r.ok) console.warn(`[twitch] ensureRewards on connect failed: ${r.reason} ${r.detail ?? ""}`);
    });
    broadcastMembersForUser(state.steamId);
    res.redirect("/twitch/?connected=1");
  } catch (err) {
    const msg = err instanceof Error ? err.message : "exchange_failed";
    console.error("[twitch] callback error:", err);
    return fail(msg);
  }
});

/** Revoke the current access token on Twitch and drop the local link row. */
router.post("/auth/disconnect", requireAuth, async (req, res) => {
  const link = getLinkBySteamId(req.user!.steamId);
  if (link) {
    // Stop EventSub + delete custom rewards on Twitch BEFORE we drop the
    // tokens — once tokens are gone we can't call Helix any more.
    stopEventSub(link.broadcasterId);
    await tearDownRewards(link.broadcasterId, req.user!.steamId).catch((err) => {
      console.warn("[twitch] tearDownRewards failed (ignored):", err);
    });
    revokeToken(link.accessToken).catch((err) => {
      console.warn("[twitch] revoke failed (ignored):", err);
    });
    deleteEventsForBroadcaster(link.broadcasterId);
    deleteLink(req.user!.steamId);
    broadcastMembersForUser(req.user!.steamId);
  }
  res.json({ ok: true });
});

/**
 * Connection + rewards + EventSub status for the current Steam user.
 * Used by /twitch settings page to show provisioning state.
 */
router.get("/status", requireAuth, (req, res) => {
  const link = getLinkBySteamId(req.user!.steamId);
  if (!link) {
    res.json({ connected: false });
    return;
  }
  const eventsub = getEventSubStatus(link.broadcasterId);
  const rewards = listRewards(link.broadcasterId);
  // Surface every effect with its current Twitch reward (or null if missing).
  const rewardByEffect = new Map(rewards.map((r) => [r.effectKey, r]));
  const effects = EFFECT_KEYS.map((key) => {
    const def = EFFECTS[key];
    const row = rewardByEffect.get(key) ?? null;
    return {
      key,
      title: def.title,
      prompt: def.prompt,
      channelPointCost: def.channelPointCost,
      bitsCost: def.bitsCost,
      applicableWhen: def.applicableWhen,
      reward: row
        ? { rewardId: row.rewardId, cost: row.cost, enabled: row.enabled }
        : null,
    };
  });
  res.json({
    connected: true,
    broadcasterId: link.broadcasterId,
    login: link.login,
    displayName: link.displayName,
    eventsub: eventsub ?? {
      broadcasterId: link.broadcasterId,
      status: "disconnected" as const,
      sessionId: null,
      subscribedTypes: [],
      lastEventAt: null,
      lastEventType: null,
      lastError: null,
    },
    effects,
    autoCategory: link.autoCategory,
    canAutoCategory: link.scopes.includes(AUTO_CATEGORY_SCOPE),
  });
});

/**
 * Toggle the per-user "auto-update Twitch category from current game" setting.
 * Requires a connected Twitch link. Enabling without the broadcast scope is
 * accepted but the actual API call will fail at fire-time — UI is expected to
 * gate this on canAutoCategory and prompt for reconnect.
 */
router.post("/auto-category", requireAuth, (req, res) => {
  const link = getLinkBySteamId(req.user!.steamId);
  if (!link) {
    res.status(404).json({ error: "no_twitch_link" });
    return;
  }
  const body = (req.body ?? {}) as { enabled?: unknown };
  if (typeof body.enabled !== "boolean") {
    res.status(400).json({ error: "enabled must be boolean" });
    return;
  }
  setAutoCategory(req.user!.steamId, body.enabled);
  res.json({ ok: true, autoCategory: body.enabled });
});

/** Recent activity log for the current user's broadcaster (capped at 50). */
router.get("/events", requireAuth, (req, res) => {
  const link = getLinkBySteamId(req.user!.steamId);
  if (!link) {
    res.status(404).json({ error: "no_twitch_link" });
    return;
  }
  const limit = Math.min(parseInt(String(req.query.limit ?? "50"), 10) || 50, 100);
  const events = listTwitchEvents(link.broadcasterId, limit);
  res.json({ events });
});

export default router;
