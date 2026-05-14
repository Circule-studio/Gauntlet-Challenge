// /api/stats/* — public read-only stats. No auth: Steam profiles are public
// info and these endpoints only surface aggregate gameplay outcomes.

import { Router } from "express";
import { getGameStats, getLeaderboards, getProfile, getGamePlayCountsForPlayers } from "../lib/db";

const router = Router();

const STEAM_ID_RE = /^\d{17}$/;

router.get("/profile", (req, res) => {
  const steamId = String(req.query.steamId ?? "");
  if (!STEAM_ID_RE.test(steamId)) {
    res.status(400).json({ error: "invalid steamId" });
    return;
  }
  const profile = getProfile(steamId);
  if (!profile) {
    res.status(404).json({ error: "no runs recorded" });
    return;
  }
  res.json(profile);
});

router.get("/leaderboards", (_req, res) => {
  res.json(getLeaderboards());
});

router.get("/games", (_req, res) => {
  res.json(getGameStats());
});

// GET /api/stats/play-counts?steamIds=A,B,C
// Returns play counts per game_id, restricted to runs involving any of the
// given Steam IDs. Used by the "least played" mode to weight selection.
router.get("/play-counts", (req, res) => {
  const raw = String(req.query.steamIds ?? "");
  const ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
  for (const id of ids) {
    if (!STEAM_ID_RE.test(id)) {
      res.status(400).json({ error: `invalid steamId: ${id}` });
      return;
    }
  }
  res.json({ counts: getGamePlayCountsForPlayers(ids) });
});

export default router;
