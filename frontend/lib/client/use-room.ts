"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { DEFAULT_STATE, type GauntletState } from "@/lib/types";
import type { RoomEvent, RoomMember } from "@/lib/types/room";

export interface UseRoomResult {
  state: GauntletState;
  setState: React.Dispatch<React.SetStateAction<GauntletState>>;
  members: RoomMember[];
  ownerSteamId: string | null;
  connected: boolean;
  closed: string | null;
  addBot: (name: string) => void;
  removeBot: (botSteamId: string) => void;
  startTimer: (minutes: number) => void;
  clearTimer: () => void;
}

export function useRoom(code: string): UseRoomResult {
  const [state, setLocalState] = useState<GauntletState>(DEFAULT_STATE);
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [ownerSteamId, setOwnerSteamId] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [closed, setClosed] = useState<string | null>(null);

  const stateRef  = useRef<GauntletState>(DEFAULT_STATE);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!code) return;

    const socket: Socket = io({
      withCredentials: true,
      // Polling d'abord (connexion instantanée, compatible proxy),
      // puis Socket.io tente l'upgrade WebSocket automatiquement.
      transports: ["polling", "websocket"],
      // Reconnexion automatique robuste
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 5_000,
      // Timeout de connexion initiale — doit être > pingInterval serveur (10s)
      timeout: 20_000,
    });

    socketRef.current = socket;

    // ── connexion / reconnexion ──────────────────────────────────────────────
    socket.on("connect", () => {
      setConnected(true);
      // Rejoint (ou rejoint à nouveau après reconnexion) pour recevoir le snapshot
      socket.emit("join", { code });
    });

    socket.on("disconnect", () => {
      setConnected(false);
    });

    // ── événements serveur ───────────────────────────────────────────────────
    socket.on("state", (event: Extract<RoomEvent, { type: "state" }>) => {
      // Always apply the server's authoritative state — including the sender's
      // own echo. The previous JSON-equality echo-suppression saved one
      // re-render but caused divergence when property order changed during the
      // round-trip (e.g. stale backend that initialised state without a newer
      // field, then re-emitted it in a different position). The cost of an
      // extra render after each local mutation is negligible vs the bug class
      // it eliminates.
      stateRef.current = event.state;
      setLocalState(event.state);
    });

    socket.on("members", (event: Extract<RoomEvent, { type: "members" }>) => {
      setMembers(event.members);
      if (event.ownerSteamId !== undefined) setOwnerSteamId(event.ownerSteamId);
    });

    socket.on("closed", (event: Extract<RoomEvent, { type: "closed" }>) => {
      setClosed(event.reason ?? "closed");
      socket.disconnect();
    });

    // ── erreurs room ─────────────────────────────────────────────────────────
    socket.on("room_error", ({ message, code: errCode }: { message: string; code?: string }) => {
      console.warn("[room] server error:", message);
      // Si la room n'existe plus (serveur redémarré etc.) → rediriger vers lobby
      if (errCode === "NOT_FOUND" || message.toLowerCase().includes("introuvable")) {
        setClosed("not_found");
        socket.disconnect();
      }
    });

    return () => {
      // Don't emit "leave" — disconnecting is enough. The server keeps the
      // user in the room's member list during a short grace window so a
      // refresh / brief drop can reconnect cleanly. Explicit leave goes
      // through the REST endpoint when the user clicks "Quitter".
      socket.disconnect();
      socketRef.current = null;
    };
  }, [code]);

  const setState = useCallback<React.Dispatch<React.SetStateAction<GauntletState>>>(
    (value) => {
      const prev = stateRef.current;
      const next =
        typeof value === "function"
          ? (value as (s: GauntletState) => GauntletState)(prev)
          : value;

      if (next === prev) return; // no-op

      // 1. Mise à jour locale optimiste (UI instantanée). Le broadcast
      //    serveur ré-appliquera l'état canonique en arrivant — on ne
      //    suppresse plus l'écho, ce qui élimine les divergences subtiles
      //    quand l'ordre des propriétés change pendant le round-trip.
      stateRef.current = next;
      setLocalState(next);

      // 2. Envoyer au serveur — qui broadcast à tous les membres.
      socketRef.current?.emit("mutate", { state: next });
    },
    [],
  );

  const addBot = useCallback((name: string) => {
    socketRef.current?.emit("add_bot", { name });
  }, []);

  const removeBot = useCallback((botSteamId: string) => {
    socketRef.current?.emit("remove_bot", { botSteamId });
  }, []);

  const startTimer = useCallback((minutes: number) => {
    socketRef.current?.emit("start_timer", { minutes });
  }, []);

  const clearTimer = useCallback(() => {
    socketRef.current?.emit("clear_timer");
  }, []);

  return { state, setState, members, ownerSteamId, connected, closed, addBot, removeBot, startTimer, clearTimer };
}
