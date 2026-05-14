// /api/steam/* — ownership lookups + library art proxy.

import { Router, type Response } from "express";
import { requireAuth } from "../middleware/auth";
import { HttpError } from "../lib/auth";
import { resolveOwnership } from "../lib/ownership";
import { rateLimit } from "../lib/rate-limit";
import { getRoom } from "../lib/room-store";
import { getOwnedGames, getPlayerAchievements } from "../lib/steam-api";
import { isSyntheticId } from "@shared/types/steam";
import type { OwnershipResult } from "@shared/types/steam";

const router = Router();

const MAX_BATCH = 100;

router.post("/owns", requireAuth, async (req, res) => {
  try {
    const user = req.user!;
    const body = req.body as { appIds?: unknown } | undefined;
    const ids = Array.isArray(body?.appIds) ? body!.appIds : null;
    if (!ids || ids.length === 0) {
      res.status(400).json({ error: "Body must include appIds: number[]" });
      return;
    }
    if (ids.length > MAX_BATCH) {
      res.status(400).json({ error: `Max ${MAX_BATCH} appIds per batch` });
      return;
    }
    const appIds: number[] = [];
    for (const v of ids) {
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) {
        res.status(400).json({ error: `Invalid appId: ${v}` });
        return;
      }
      appIds.push(n);
    }

    const limit = rateLimit(user.steamId);
    if (!limit.ok) {
      res.set("Retry-After", String(Math.ceil(limit.retryAfterMs / 1000)));
      res.status(429).json({ error: "Rate limited", retryAfterMs: limit.retryAfterMs });
      return;
    }

    const refresh = req.query.refresh === "true";
    const map = await resolveOwnership({ steamId: user.steamId, appIds, refresh });

    const results: Record<string, boolean | "unknown"> = {};
    const details: Record<string, OwnershipResult> = {};
    for (const id of appIds) {
      const r = map.get(id);
      if (!r) {
        results[id] = "unknown";
        continue;
      }
      results[id] = r.owned === "likely" ? true : r.owned;
      details[id] = r;
    }

    res.json({ steamId: user.steamId, results, details });
  } catch (e) {
    sendError(res, e);
  }
});

router.get("/owns/:appId", requireAuth, async (req, res) => {
  try {
    const user = req.user!;
    const appId = Number(req.params.appId);
    if (!Number.isFinite(appId) || appId <= 0) {
      res.status(400).json({ error: "Invalid appId" });
      return;
    }
    const limit = rateLimit(user.steamId);
    if (!limit.ok) {
      res.set("Retry-After", String(Math.ceil(limit.retryAfterMs / 1000)));
      res.status(429).json({ error: "Rate limited", retryAfterMs: limit.retryAfterMs });
      return;
    }
    const refresh = req.query.refresh === "true";
    const map = await resolveOwnership({ steamId: user.steamId, appIds: [appId], refresh });
    const result = map.get(appId);
    if (!result) {
      res.status(500).json({ error: "Resolution failed" });
      return;
    }
    res.json(result);
  } catch (e) {
    sendError(res, e);
  }
});

// GET /api/steam/room-libraries/:code
// Returns the Steam library appIds for every human member of the room. The
// requester must themselves be a human member of that room. Used by the
// "Steam library only" mode so the host can intersect everyone's libraries
// and pick games only from games owned by everyone.
router.get("/room-libraries/:code", requireAuth, async (req, res) => {
  try {
    const user = req.user!;
    const code = String(req.params.code ?? "").toUpperCase();
    if (!/^[A-Z0-9]{4,8}$/.test(code)) {
      res.status(400).json({ error: "Invalid room code" });
      return;
    }
    const room = getRoom(code);
    if (!room) {
      res.status(404).json({ error: "Room introuvable" });
      return;
    }
    if (!room.members.some((m) => m.steamId === user.steamId)) {
      res.status(403).json({ error: "Pas membre de cette room" });
      return;
    }

    const libraries: Record<string, { appIds: number[]; visible: boolean }> = {};
    const humans = room.members.filter((m) => !isSyntheticId(m.steamId));
    await Promise.all(
      humans.map(async (m) => {
        try {
          const games = await getOwnedGames(m.steamId);
          libraries[m.steamId] = {
            appIds: games.map((g) => g.appid),
            visible: games.length > 0,
          };
        } catch {
          libraries[m.steamId] = { appIds: [], visible: false };
        }
      }),
    );

    res.json({ code, libraries });
  } catch (e) {
    sendError(res, e);
  }
});

// GET /api/steam/achievement/:appid/:apiname
// Returns the requester's unlock state for a single achievement on a single
// app. Used by the achievement-based game objective.
router.get("/achievement/:appid/:apiname", requireAuth, async (req, res) => {
  try {
    const user = req.user!;
    const appid = Number(req.params.appid);
    const apiname = String(req.params.apiname ?? "").trim();
    if (!Number.isFinite(appid) || appid <= 0) {
      res.status(400).json({ error: "Invalid appid" });
      return;
    }
    if (!apiname || apiname.length > 200) {
      res.status(400).json({ error: "Invalid apiname" });
      return;
    }
    const list = await getPlayerAchievements(user.steamId, appid);
    const match = list.find((a) => a.apiname === apiname);
    if (!match) {
      res.json({ unlocked: false, unlocktime: null, known: false });
      return;
    }
    res.json({
      unlocked: match.achieved === 1,
      unlocktime: match.unlocktime > 0 ? match.unlocktime : null,
      known: true,
    });
  } catch (e) {
    sendError(res, e);
  }
});

// GET /api/steam/cover/:appid — public proxy for Steam library art.
const STEAM_CDN = "https://cdn.cloudflare.steamstatic.com/steam/apps";
const ASSET_PRIORITY = ["library_600x900.jpg", "header.jpg"];

router.get("/cover/:appid", async (req, res) => {
  const appid = req.params.appid;
  if (!/^\d+$/.test(appid)) {
    res.status(400).send("Invalid appid");
    return;
  }

  for (const asset of ASSET_PRIORITY) {
    const upstream = await fetch(`${STEAM_CDN}/${appid}/${asset}`, { cache: "no-store" });
    if (upstream.ok && upstream.body) {
      res.status(200);
      res.set("Content-Type", upstream.headers.get("content-type") ?? "image/jpeg");
      res.set("Cache-Control", "public, max-age=86400, s-maxage=604800, immutable");
      res.set("Access-Control-Allow-Origin", "*");
      const reader = upstream.body.getReader();
      const pump = async (): Promise<void> => {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!res.write(Buffer.from(value))) {
              await new Promise<void>((r) => res.once("drain", () => r()));
            }
          }
          res.end();
        } catch {
          res.end();
        }
      };
      void pump();
      return;
    }
  }

  res.status(404).send("Cover not available");
});

function sendError(res: Response, e: unknown): void {
  if (e instanceof HttpError) {
    res.status(e.status).json({ error: e.message });
    return;
  }
  console.error("[steam route]", e);
  res.status(500).json({ error: "Internal error" });
}

export default router;
