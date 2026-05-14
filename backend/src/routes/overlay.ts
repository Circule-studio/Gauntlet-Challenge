// /api/overlay/* — public, read-only SSE streams for Twitch overlays.
//
// /api/overlay/:code/events       — pinned to a room code
// /api/overlay/me/:token/events   — stable per-user feed (auto-hops between rooms)

import { Router, type Request, type Response } from "express";
import { subscribeOverlay, subscribeUserOverlay } from "../lib/room-store";
import { verifyOverlayToken } from "../lib/overlay-token";
import type { OverlayState } from "../lib/overlay-state";

const router = Router();

const NOROOM_PLACEHOLDER: OverlayState = {
  totalElapsed: 0,
  startedAt: null,
  victories: 0,
  goal: 10,
  resets: 0,
  currentGameId: null,
  currentGameStartedAt: null,
  currentGameElapsed: 0,
  games: [],
  timerDeadline: null,
};

function setSseHeaders(res: Response): void {
  res.status(200);
  res.set({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-store, must-revalidate, no-transform",
    Connection: "keep-alive",
    // nginx (AlwaysData) bufferise par défaut → coupe le streaming.
    "X-Accel-Buffering": "no",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.flushHeaders?.();
}

function preflight(_req: Request, res: Response): void {
  res.status(204);
  res.set({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end();
}

router.options("/:code/events", preflight);
router.options("/me/:token/events", preflight);

router.get("/:code/events", (req, res) => {
  setSseHeaders(res);

  const send = (state: OverlayState): void => {
    res.write(`data: ${JSON.stringify(state)}\n\n`);
  };

  const result = subscribeOverlay(req.params.code, send);
  if ("error" in result) {
    res.write(`event: error\ndata: ${JSON.stringify({ error: result.error })}\n\n`);
    res.end();
    return;
  }

  res.write(`retry: 1500\n\n`);
  send(result.snapshot);

  const keepAlive = setInterval(() => {
    try { res.write(`: ka\n\n`); } catch { /* stream gone */ }
  }, 15_000);

  const cleanup = (): void => {
    clearInterval(keepAlive);
    result.unsubscribe();
  };
  req.on("close", cleanup);
  req.on("aborted", cleanup);
});

router.get("/me/:token/events", (req, res) => {
  const verified = verifyOverlayToken(req.params.token);
  if (!verified) {
    setSseHeaders(res);
    res.write(`event: error\ndata: ${JSON.stringify({ error: "Invalid token" })}\n\n`);
    res.end();
    return;
  }

  setSseHeaders(res);

  const send = (overlay: OverlayState | null): void => {
    const payload = overlay ?? NOROOM_PLACEHOLDER;
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  const result = subscribeUserOverlay(verified.steamId, send);

  res.write(`retry: 1500\n\n`);
  send(result.snapshot);

  const keepAlive = setInterval(() => {
    try { res.write(`: ka\n\n`); } catch { /* stream gone */ }
  }, 15_000);

  const cleanup = (): void => {
    clearInterval(keepAlive);
    result.unsubscribe();
  };
  req.on("close", cleanup);
  req.on("aborted", cleanup);
});

export default router;
