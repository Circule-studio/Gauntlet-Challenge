// Express app composition. Mounts API routes and serves the static frontend
// build (frontend/out/) on the same origin — option 1 du plan.

import path from "path";
import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import { env } from "./lib/env";
import { attachUser } from "./middleware/auth";

import authRoutes from "./routes/auth";
import meRoutes from "./routes/me";
import pairRoutes from "./routes/pair";
import roomRoutes from "./routes/room";
import steamRoutes from "./routes/steam";
import overlayRoutes from "./routes/overlay";
import statsRoutes from "./routes/stats";
import twitchRoutes from "./routes/twitch";
import gamesRoutes from "./routes/games";

export function createApp(): Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  // Inject req.user from the session cookie when present (best-effort).
  app.use(attachUser);

  // === API ===
  app.use("/api/auth", authRoutes);
  app.use("/api/me", meRoutes);
  app.use("/api/pair", pairRoutes);
  app.use("/api/room", roomRoutes);
  app.use("/api/steam", steamRoutes);
  app.use("/api/overlay", overlayRoutes);
  app.use("/api/stats", statsRoutes);
  app.use("/api/twitch", twitchRoutes);
  app.use("/api/games", gamesRoutes);

  // === Static frontend ===
  // `next build` (output: 'export') → frontend/out/ contient l'app statique.
  // FRONTEND_DIST est résolu depuis backend/ par défaut → ../frontend/out
  const frontendDist = path.resolve(process.cwd(), env.FRONTEND_DIST);

  // / n'a pas de page Next (le tracker solo a été supprimé) — on redirige
  // vers /lobby/. Doit passer avant express.static sinon il essaie de servir
  // un index.html qui n'existe pas.
  app.get("/", (_req, res) => {
    res.redirect("/lobby/");
  });

  app.use(
    express.static(frontendDist, {
      index: "index.html",
      // Long-cache pour les assets immutables (Next met un hash dans le nom).
      setHeaders: (res, filePath) => {
        if (filePath.includes(`${path.sep}_next${path.sep}static${path.sep}`)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    }),
  );

  // Fallback pour les routes GET inconnues — on renvoie sur /lobby/ plutôt
  // que de 404. Les /api/* qui ne matchent rien retournent 404 normal.
  app.use((req, res, next) => {
    if (req.method !== "GET") return next();
    if (req.path.startsWith("/api/")) return next();
    if (req.path.startsWith("/socket.io/")) return next();
    res.redirect("/lobby/");
  });

  // === Error handler ===
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("[express] error:", err);
    if (res.headersSent) return;
    res.status(500).json({ error: "Internal error" });
  });

  return app;
}
