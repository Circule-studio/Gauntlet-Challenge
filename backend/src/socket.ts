// Socket.io setup — multiplayer room sync.

import type { Server as HttpServer } from "http";
import { Server as SocketIOServer, type Socket } from "socket.io";
import {
  joinRoom,
  leaveRoom,
  subscribe,
  mutateState,
  schedulePendingLeave,
  cancelPendingLeave,
  addBot,
  removeBot,
  setTimer,
  clearTimer,
} from "./lib/room-store";
import { verifyToken } from "./lib/verify-token";
import { SESSION_COOKIE } from "@shared/session-cookie";
import type { GauntletState } from "@shared/types";
import type { SteamSessionUser } from "@shared/types/steam";

// How long a member stays in their room after their last socket drops. Refreshes
// and brief network blips reconnect within this window and rejoin transparently.
const ROOM_GRACE_MS = 30_000;

function parseCookies(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

export function attachSocketIO(httpServer: HttpServer): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    // pingTimeout DOIT être > pingInterval, sinon le serveur déclare le client
    // mort avant que le pong puisse arriver → déconnexions en boucle.
    pingInterval: 10_000,
    pingTimeout: 30_000,
    upgradeTimeout: 15_000,
    transports: ["polling", "websocket"],
    // Frontend et backend partagent le même origin → pas besoin de CORS.
    cors: { origin: true, credentials: true },
  });

  // AlwaysData utilise nginx qui bufferise les réponses proxy par défaut.
  // Sans ce header, les données Socket.io (polling) arrivent en retard ou jamais.
  io.engine.on("headers", (headers: Record<string, string>) => {
    headers["X-Accel-Buffering"] = "no";
    headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
  });

  io.use((socket, next) => {
    const cookies = parseCookies(socket.handshake.headers.cookie ?? "");
    const token = cookies[SESSION_COOKIE];
    if (!token) return next(new Error("Not authenticated"));
    const user = verifyToken(token);
    if (!user) return next(new Error("Invalid session"));
    (socket as Socket & { data: { user: SteamSessionUser } }).data.user = user;
    next();
  });

  io.on("connection", (socket) => {
    const user: SteamSessionUser = socket.data.user;
    let currentCode: string | null = null;
    let unsub: (() => void) | null = null;

    const detach = (): void => {
      unsub?.();
      unsub = null;
    };

    const fullLeave = (): void => {
      if (!currentCode) return;
      detach();
      cancelPendingLeave(currentCode, user.steamId);
      leaveRoom(currentCode, user.steamId);
      currentCode = null;
    };

    socket.on("join", ({ code }: { code: string }) => {
      if (currentCode && currentCode.toUpperCase() !== code.toUpperCase()) {
        fullLeave();
      } else {
        detach();
      }

      const joined = joinRoom(code, user);
      if ("error" in joined) {
        socket.emit("room_error", { message: joined.error, code: "NOT_FOUND" });
        return;
      }

      cancelPendingLeave(code, user.steamId);
      currentCode = code;

      const result = subscribe(code, user.steamId, (event) => {
        socket.emit(event.type, event);
      });

      if ("error" in result) {
        socket.emit("room_error", { message: result.error, code: "NOT_FOUND" });
        leaveRoom(code, user.steamId);
        currentCode = null;
        return;
      }

      unsub = result.unsubscribe;

      socket.emit("state",   { type: "state",   state:   result.snapshot.state });
      socket.emit("members", { type: "members", members: result.snapshot.members, ownerSteamId: result.snapshot.ownerSteamId });
    });

    socket.on("mutate", ({ state }: { state: GauntletState }) => {
      if (!currentCode) return;
      const result = mutateState(currentCode, user.steamId, state);
      if ("error" in result) {
        console.warn(`[socket] mutate failed for ${user.steamId}: ${result.error}`);
        socket.emit("room_error", { message: result.error, code: "NOT_FOUND" });
      }
    });

    socket.on("add_bot", ({ name }: { name?: string }) => {
      if (!currentCode) return;
      const result = addBot(currentCode, user.steamId, typeof name === "string" ? name : "");
      if ("error" in result) {
        socket.emit("room_error", { message: result.error });
      }
    });

    socket.on("remove_bot", ({ botSteamId }: { botSteamId?: string }) => {
      if (!currentCode || typeof botSteamId !== "string") return;
      const result = removeBot(currentCode, user.steamId, botSteamId);
      if ("error" in result) {
        socket.emit("room_error", { message: result.error });
      }
    });

    // Server-authoritative per-game timer. The server stamps the deadline so
    // clients with skewed clocks all converge on the same remaining time.
    socket.on("start_timer", ({ minutes }: { minutes?: number }) => {
      if (!currentCode) return;
      const m = Number(minutes);
      if (!Number.isFinite(m) || m <= 0) {
        socket.emit("room_error", { message: "Durée timer invalide" });
        return;
      }
      const result = setTimer(currentCode, user.steamId, m);
      if ("error" in result) {
        socket.emit("room_error", { message: result.error });
      }
    });

    socket.on("clear_timer", () => {
      if (!currentCode) return;
      const result = clearTimer(currentCode, user.steamId);
      if ("error" in result) {
        socket.emit("room_error", { message: result.error });
      }
    });

    socket.on("leave", fullLeave);

    socket.on("disconnect", () => {
      detach();
      if (currentCode) {
        schedulePendingLeave(currentCode, user.steamId, ROOM_GRACE_MS);
        currentCode = null;
      }
    });
  });

  return io;
}
