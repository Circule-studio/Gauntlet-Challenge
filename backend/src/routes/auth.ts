// /api/auth/* — Steam OpenID flow + logout + session probe.

import crypto from "crypto";
import { Router } from "express";
import { buildLoginUrl, verifyAssertion, extractSteamId } from "../lib/openid";
import { getPlayerSummary } from "../lib/steam-api";
import { signSession, sessionCookieAttrs, SESSION_COOKIE, verifySession } from "../lib/auth";
import { claimCode } from "../lib/pair-store";
import { GUEST_ID_PREFIX } from "@shared/types/steam";

const router = Router();

const GUEST_NAME_MIN = 2;
const GUEST_NAME_MAX = 24;

function sanitizeGuestName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  // Drop ASCII control characters, then collapse runs of whitespace.
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if (code < 32 || code === 127) continue;
    out += raw[i];
  }
  const cleaned = out.replace(/\s+/g, " ").trim();
  if (cleaned.length < GUEST_NAME_MIN || cleaned.length > GUEST_NAME_MAX) return null;
  return cleaned;
}

function generateGuestId(): string {
  return `${GUEST_ID_PREFIX}${crypto.randomBytes(8).toString("hex")}`;
}

/** Cheap, deterministic colour pick from the name so the same guest gets the
 *  same avatar tone across page loads. */
function nameHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return ((h % 360) + 360) % 360;
}

function makeGuestAvatar(name: string): string {
  const initial = (name.match(/[\p{L}\p{N}]/u)?.[0] ?? "?").toUpperCase();
  const hue = nameHue(name);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="184" height="184" viewBox="0 0 184 184">` +
    `<rect width="184" height="184" fill="hsl(${hue},45%,35%)"/>` +
    `<text x="92" y="120" font-family="sans-serif" font-size="96" font-weight="700" text-anchor="middle" fill="white">${initial}</text>` +
    `</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

// Room codes are 4-8 alphanumeric chars (uppercase). Anything else in `next`
// is rejected so the param can't be used to open-redirect off-site.
const ROOM_CODE_RE = /^[A-Z0-9]{4,8}$/;
function sanitizeNext(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const code = raw.toUpperCase();
  return ROOM_CODE_RE.test(code) ? code : undefined;
}

// GET /api/auth/steam — kick off Steam OpenID by 302-ing to Steam.
router.get("/steam", (req, res) => {
  const pair = typeof req.query.pair === "string" ? req.query.pair : undefined;
  const next = sanitizeNext(req.query.next);
  res.redirect(buildLoginUrl(pair, next));
});

// GET /api/auth/steam/callback — Steam redirects here with openid.* params.
router.get("/steam/callback", async (req, res) => {
  const pair = typeof req.query.pair === "string" ? req.query.pair : null;
  const next = sanitizeNext(req.query.next);
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(req.query)) {
    if (typeof value === "string") params.set(key, value);
    else if (Array.isArray(value)) params.set(key, String(value[0]));
  }

  try {
    if (params.get("openid.mode") !== "id_res") return redirectFor(res, pair, "cancelled");

    const ok = await verifyAssertion(params);
    console.log("[steam/callback] verifyAssertion:", ok);
    if (!ok) return redirectFor(res, pair, "invalid");

    const steamId = extractSteamId(params.get("openid.claimed_id"));
    console.log("[steam/callback] steamId:", steamId);
    if (!steamId) return redirectFor(res, pair, "invalid");

    const summary = await getPlayerSummary(steamId);
    const user = {
      steamId,
      displayName: summary?.personaname ?? "Steam User",
      avatarUrl: summary?.avatarfull ?? "",
      profileUrl: summary?.profileurl ?? `https://steamcommunity.com/profiles/${steamId}`,
    };
    console.log("[steam/callback] user:", user.displayName);

    if (pair) {
      const claimed = claimCode(pair, user);
      res.redirect(`/pair?code=${encodeURIComponent(pair)}&status=${claimed ? "ok" : "expired"}`);
      return;
    }

    const token = signSession(user);
    const attrs = sessionCookieAttrs();
    res.cookie(attrs.name, token, {
      httpOnly: attrs.httpOnly,
      secure: attrs.secure,
      sameSite: attrs.sameSite,
      path: attrs.path,
      maxAge: attrs.maxAge * 1000,
    });
    const dest = next ? `/room?code=${encodeURIComponent(next)}` : "/lobby";
    console.log(`[steam/callback] cookie set, redirecting to ${dest}`);
    res.redirect(dest);
  } catch (err) {
    console.error("[steam/callback] error:", err);
    redirectFor(res, pair, "invalid");
  }
});

// POST /api/auth/guest — issue a session for a guest user (no Steam OAuth).
// Body: { name: string }. Returns { user } or { error }.
router.post("/guest", (req, res) => {
  const body = (req.body ?? {}) as { name?: unknown };
  const name = sanitizeGuestName(body.name);
  if (!name) {
    res.status(400).json({ error: "invalid_name" });
    return;
  }
  const steamId = generateGuestId();
  const user = {
    steamId,
    displayName: name,
    avatarUrl: makeGuestAvatar(name),
    profileUrl: "",
  };
  const token = signSession(user);
  const attrs = sessionCookieAttrs();
  res.cookie(attrs.name, token, {
    httpOnly: attrs.httpOnly,
    secure: attrs.secure,
    sameSite: attrs.sameSite,
    path: attrs.path,
    maxAge: attrs.maxAge * 1000,
  });
  res.json({ user });
});

// POST /api/auth/logout
router.post("/logout", (_req, res) => {
  const attrs = sessionCookieAttrs();
  res.cookie(attrs.name, "", {
    httpOnly: attrs.httpOnly,
    secure: attrs.secure,
    sameSite: attrs.sameSite,
    path: attrs.path,
    maxAge: 0,
  });
  res.json({ ok: true });
});

// GET /api/auth/me — vérifie la session, clear le cookie si invalide.
router.get("/me", (req, res) => {
  const token = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
  const user = token ? verifySession(token) : null;
  if (!user) {
    if (token) {
      const attrs = sessionCookieAttrs();
      res.cookie(attrs.name, "", {
        httpOnly: attrs.httpOnly,
        secure: attrs.secure,
        sameSite: attrs.sameSite,
        path: attrs.path,
        maxAge: 0,
      });
    }
    res.json({ user: null });
    return;
  }
  res.json({ user });
});

function redirectFor(res: import("express").Response, pair: string | null, status: string): void {
  if (pair) {
    res.redirect(`/pair?code=${encodeURIComponent(pair)}&status=${status}`);
    return;
  }
  res.redirect(`/?login=${status}`);
}

export default router;
