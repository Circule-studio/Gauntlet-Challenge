"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { POOL, effectiveMode } from "@/lib/games";
import {
  DEFAULT_STATE,
  type GauntletState,
  type Game,
  type RunHistoryEntry,
} from "@/lib/types";
import { useRoom } from "@/lib/client/use-room";
import { useMeStatus } from "@/lib/client/use-me";
import { isGuestId, isSyntheticId } from "@/lib/types/steam";

import { COUNTDOWN_MS, MAX_MEMBERS, formatChampion, pinCap, shuffle } from "./_components/utils";
import { RoomBanner } from "./_components/RoomBanner";
import { RoomHero } from "./_components/RoomHero";
import { RoomConfig } from "./_components/RoomConfig";
import { RoomPool, type ObjTipState } from "./_components/RoomPool";
import { PlayersPanel } from "./_components/PlayersPanel";
import { RoomRun } from "./_components/RoomRun";
import { RunHistory, type RunStats } from "./_components/RunHistory";
import { PowerUpsBar } from "./_components/PowerUpsBar";
import { GameRules } from "./_components/GameRules";
import { WinLoseOverlay, type OverlayState } from "./_components/WinLoseOverlay";
import { ReviewModal } from "./_components/ReviewModal";
import { CountdownOverlay } from "./_components/CountdownOverlay";
import { ObjectivesTooltip } from "./_components/ObjectivesTooltip";
import { OverlayLinksModal } from "./_components/OverlayLinksModal";

export default function Page() {
  // Static export ne supporte pas les segments dynamiques [code], on lit le code
  // depuis ?code=XXX. useSearchParams demande un Suspense boundary autour.
  return (
    <Suspense fallback={<main className="auth-shell"><div className="auth-card"><p className="auth-subtitle">Chargement…</p></div></main>}>
      <RoomPageInner />
    </Suspense>
  );
}

function RoomPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const roomCode = (searchParams.get("code") ?? "").toUpperCase();
  const { user: me, loading: meLoading } = useMeStatus();
  // Pas de code → retour au lobby. Code présent mais pas authentifié → login avec
  // `next` pour revenir directement à la room après connexion.
  useEffect(() => {
    if (!roomCode) {
      router.replace("/lobby");
      return;
    }
    if (!meLoading && me === null) {
      router.replace(`/login?next=${encodeURIComponent(roomCode)}`);
    }
  }, [roomCode, me, meLoading, router]);
  const {
    state,
    setState,
    members,
    ownerSteamId,
    connected,
    closed,
    addBot,
    removeBot,
    startTimer: socketStartTimer,
    clearTimer: socketClearTimer,
  } = useRoom(roomCode);
  const isHost = !!me && !!ownerSteamId && me.steamId === ownerSteamId;
  // Map displayName -> avatarUrl for the champion slot machine. Names are unique
  // within a room (the lobby enforces this), so a flat map is safe.
  const nameToAvatar = useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of members) {
      if (m.displayName && m.avatarUrl) map[m.displayName] = m.avatarUrl;
    }
    return map;
  }, [members]);
  const [localSearch, setLocalSearch] = useState("");
  const [localFilter, setLocalFilter] = useState("all");
  // Two-step config flow: first the room config (player slots, difficulty, etc.),
  // validated, then the game pool selection. Stored in shared state so every
  // viewer sees the same step — only the host can change it (mirrors the
  // host-only nature of the rest of the config).
  const configStep = state.configStep ?? "config";
  const setConfigStep = (step: "config" | "pool") => {
    if (!isHost) return;
    update({ configStep: step });
  };
  const [overlay, setOverlay] = useState<OverlayState>({ kind: null });
  const [swappedIdx, setSwappedIdx] = useState<number | null>(null);
  const [shaking, setShaking] = useState(false);
  const [now, setNow] = useState<number>(Date.now());
  // Shared review modal — `pendingRun`, ready states and countdown all live in
  // `state` so every member sees the same view. Derived flags below keep the
  // existing render logic compatible.
  const pendingRun = state.pendingRun ?? null;
  const reviewing = pendingRun !== null && state.countdownStartedAt === null;
  const countdownDigit: number | null = (() => {
    const start = state.countdownStartedAt;
    if (start === null) return null;
    // `now` only ticks while the countdown effect is mounted — at the very
    // first render after the countdown starts, `now` is still the stale value
    // from page mount (or the last live-timer tick), which can be earlier than
    // `start`. Without the max-0 clamp, `elapsed` is negative and the digit
    // briefly shows nonsense (e.g. "17") before the 100ms tick corrects it.
    const elapsed = Math.max(0, now - start);
    const remaining = Math.ceil((COUNTDOWN_MS - elapsed) / 1000);
    if (remaining > 0) return remaining;
    // ~600ms "GO" window then the countdown auto-clears via the launch effect.
    return 0;
  })();
  // Per-game timer duration the local user has dialled in (minutes). Synced
  // deadline lives in `state.timerDeadline`; this is just the input box.
  const [timerInputMin, setTimerInputMin] = useState<number>(5);
  const [objTip, setObjTip] = useState<ObjTipState | null>(null);
  const [showOverlays, setShowOverlays] = useState(false);
  const [overlayToken, setOverlayToken] = useState<string | null>(null);
  const [overlayTokenLoading, setOverlayTokenLoading] = useState(false);
  const swapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const confettiRef = useRef<HTMLCanvasElement | null>(null);
  const particlesRef = useRef<HTMLDivElement | null>(null);

  // === ROOM CLOSED HANDLER ===
  useEffect(() => {
    if (closed) {
      const msg =
        closed === "expired"   ? "La room a expiré." :
        closed === "empty"     ? "La room a été fermée (plus aucun joueur)." :
        closed === "not_found" ? "Room introuvable — le serveur a peut-être redémarré." :
        `Room fermée (${closed}).`;
      alert(msg);
      router.replace("/lobby");
    }
  }, [closed, router]);

  // === OVERLAY TOKEN — lazy fetch on first modal open ===
  useEffect(() => {
    if (!showOverlays || overlayToken || overlayTokenLoading) return;
    setOverlayTokenLoading(true);
    fetch("/api/me/overlay-token")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { token?: string } | null) => { if (d?.token) setOverlayToken(d.token); })
      .catch(() => {})
      .finally(() => setOverlayTokenLoading(false));
  }, [showOverlays, overlayToken, overlayTokenLoading]);


  // === OWNERSHIP FETCH ===
  // For every Steam-backed game in the current run, ask /api/steam/owns whether
  // *I* own it. Publish the result into shared state so other members see the
  // same matrix. Each client only ever publishes its own row of the map.
  const runAppIdsKey = state.run
    .map((id) => POOL.find((g) => g.id === id)?.appid)
    .filter((a): a is number => typeof a === "number")
    .join(",");
  useEffect(() => {
    if (!me) return;
    // Guests have no Steam library to query — leave ownership map empty so the
    // chips render as "unknown" without burning an API round-trip per run.
    if (isGuestId(me.steamId)) return;
    if (!runAppIdsKey) return;
    const runAppIds = runAppIdsKey.split(",").map(Number).filter((n) => Number.isFinite(n));
    if (runAppIds.length === 0) return;

    let cancelled = false;
    // refresh=true so we bypass any stale per-appid cache on the server side
    // (the upstream Steam call is still gated by a 5-minute library cache, so
    // this isn't a free pass to hammer the API). Always re-fetching on mount /
    // run change also means a flipped privacy setting or a newly-bought game
    // shows up on the next page load instead of waiting 10 minutes.
    fetch("/api/steam/owns?refresh=true", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appIds: runAppIds }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { results?: Record<string, boolean | "unknown"> } | null) => {
        if (cancelled || !data?.results) return;
        const updates: Record<string, boolean> = {};
        for (const [appid, owned] of Object.entries(data.results)) {
          // Skip "unknown" — leave the slot empty so the next mount retries.
          if (typeof owned === "boolean") updates[appid] = owned;
        }
        if (Object.keys(updates).length === 0) return;
        setState((s) => ({
          ...s,
          ownership: {
            ...(s.ownership ?? {}),
            [me.steamId]: { ...(s.ownership?.[me.steamId] ?? {}), ...updates },
          },
        }));
      })
      .catch(() => {});

    return () => { cancelled = true; };
  }, [me?.steamId, runAppIdsKey, setState]);


  // === LIVE TIMER (ticks every second while run active) ===
  useEffect(() => {
    if (!state.runStartTime || state.run.length === 0 || state.done.length === state.run.length) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [state.runStartTime, state.run.length, state.done.length]);

  // === COUNTDOWN — ticks while countdownStartedAt is set ===
  useEffect(() => {
    if (state.countdownStartedAt === null) return;
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [state.countdownStartedAt]);

  // === LAUNCH — host-only commit when the countdown finishes ===
  // We funnel the "commit run" mutation through the host so two clients can't
  // race to set runStartTime. Every other client just renders the countdown.
  useEffect(() => {
    if (!isHost) return;
    if (state.countdownStartedAt === null) return;
    if (!state.pendingRun) return;
    const elapsed = Date.now() - state.countdownStartedAt;
    const remaining = COUNTDOWN_MS - elapsed + 600; // small "GO" tail
    const launch = () => {
      setState((s) => {
        if (!s.pendingRun) return s;
        return {
          ...s,
          run: s.pendingRun,
          current: 0,
          done: [],
          champions: {},
          attempt: 1,
          runStartTime: Date.now(),
          timerDeadline: null,
          runFails: {},
          pendingRun: null,
          readyPlayers: [],
          countdownStartedAt: null,
        };
      });
    };
    if (remaining <= 0) {
      launch();
      return;
    }
    const t = setTimeout(launch, remaining);
    return () => clearTimeout(t);
  }, [isHost, state.countdownStartedAt, state.pendingRun, setState]);

  // === SLOT MACHINE ANIMATION ===
  // Driven entirely by `state.drawing`. Every client receiving the broadcast
  // runs its own local rAF, but the animation timing is wall-clock based on
  // `drawing.startedAt`, so late-arriving receivers fast-forward to the right
  // frame instead of replaying from zero. Only the initiator writes the
  // result back into `state.champions`, avoiding multi-writer races.
  useEffect(() => {
    const drawing = state.drawing;
    if (!drawing) return;

    initAudio();

    let cancelled = false;
    const stripCellHeight = 32;
    const cyclesForReel = (r: number) => 10 + r * 4;

    const runReel = (r: number): Promise<void> => {
      const strip = document.getElementById(`strip${r}`) as HTMLDivElement | null;
      if (!strip) return Promise.resolve();
      const totalCells = cyclesForReel(r) + 1;
      const targetY = (totalCells - 1) * stripCellHeight;
      const duration = 1200 + r * 400;
      return new Promise<void>((resolve) => {
        let lastCell = -1;
        const frame = () => {
          if (cancelled) return resolve();
          const elapsed = Date.now() - drawing.startedAt;
          const t = Math.min(1, elapsed / duration);
          const ease = 1 - Math.pow(1 - t, 3);
          const y = ease * targetY;
          strip.style.transform = `translateY(-${y}px)`;
          if (t < 1) {
            const cellsPassed = Math.floor(y / stripCellHeight);
            if (cellsPassed !== lastCell) {
              lastCell = cellsPassed;
              beep(300 + Math.random() * 200, 0.04, "square", 0.05);
            }
            requestAnimationFrame(frame);
          } else {
            beep(800, 0.08, "triangle", 0.18);
            resolve();
          }
        };
        requestAnimationFrame(frame);
      });
    };

    // One-frame delay so the slot DOM is committed before we read strip refs.
    const rafId = requestAnimationFrame(() => {
      Promise.all(drawing.final.map((_, r) => runReel(r))).then(() => {
        if (cancelled) return;
        if (drawing.initiator !== me?.steamId) return;
        setTimeout(() => {
          if (cancelled) return;
          const finalName = formatChampion(drawing.final, drawing.pairSize);
          setState((s) => ({
            ...s,
            champions: { ...s.champions, [drawing.gameId]: finalName },
            drawing: null,
          }));
        }, 350);
      });
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.drawing?.startedAt, state.drawing?.gameId, state.drawing?.initiator, me?.steamId]);

  // === SOUND ===
  const initAudio = () => {
    if (!audioCtxRef.current) {
      try {
        const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
        audioCtxRef.current = new Ctx();
      } catch (e) {
        console.warn("Audio not supported");
      }
    }
  };
  const beep = (freq: number, duration: number, type: OscillatorType = "sine", volume = 0.15) => {
    if (!state.soundEnabled || !audioCtxRef.current) return;
    const ctx = audioCtxRef.current;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  };
  const playClick = () => {
    if (!state.soundEnabled) return;
    initAudio();
    beep(800, 0.04, "square", 0.07);
  };
  const playLose = () => {
    if (!state.soundEnabled) return;
    initAudio();
    [400, 300, 200, 100].forEach((f, i) => setTimeout(() => beep(f, 0.3, "sawtooth", 0.18), i * 100));
  };
  const playGauntletWin = () => {
    if (!state.soundEnabled) return;
    initAudio();
    [523, 659, 784, 1047, 1319, 1568, 2093].forEach((f, i) =>
      setTimeout(() => beep(f, 0.18, "triangle", 0.2), i * 100)
    );
  };

  // First click unlocks audio context (browser policy)
  useEffect(() => {
    const handler = () => initAudio();
    document.addEventListener("click", handler, { once: true });
    return () => document.removeEventListener("click", handler);
  }, []);

  // === CONFETTI ===
  const fireConfetti = (intensity = 1) => {
    const canvas = confettiRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const colors = ["#00f0a8", "#7c5cff", "#ffd23f", "#ff3860", "#ffffff"];
    const count = Math.floor(180 * intensity);
    type P = { x: number; y: number; vx: number; vy: number; g: number; size: number; color: string; rot: number; vr: number; life: number };
    const particles: P[] = [];
    for (let i = 0; i < count; i++) {
      particles.push({
        x: canvas.width / 2 + (Math.random() - 0.5) * 200,
        y: canvas.height / 2,
        vx: (Math.random() - 0.5) * 18,
        vy: (Math.random() - 1) * 14 - 6,
        g: 0.4,
        size: 4 + Math.random() * 6,
        color: colors[Math.floor(Math.random() * colors.length)],
        rot: Math.random() * 360,
        vr: (Math.random() - 0.5) * 12,
        life: 0,
      });
    }
    let frame = 0;
    const tick = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      let alive = 0;
      particles.forEach((p) => {
        if (p.y > canvas.height + 50) return;
        alive++;
        p.vy += p.g;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        p.life++;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rot * Math.PI) / 180);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = Math.max(0, 1 - p.life / 200);
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.4);
        ctx.restore();
      });
      frame++;
      if (alive > 0 && frame < 400) requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, canvas.width, canvas.height);
    };
    requestAnimationFrame(tick);
  };

  // Resize confetti canvas on window resize
  useEffect(() => {
    const onResize = () => {
      const c = confettiRef.current;
      if (c) {
        c.width = window.innerWidth;
        c.height = window.innerHeight;
      }
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // === BACKGROUND PARTICLES ===
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.hidden || !particlesRef.current) return;
      const p = document.createElement("div");
      const colorClass = ["", "purple", "gold"][Math.floor(Math.random() * 3)];
      p.className = "particle " + colorClass;
      p.style.left = Math.random() * 100 + "vw";
      const dur = 8 + Math.random() * 12;
      p.style.animationDuration = dur + "s";
      particlesRef.current.appendChild(p);
      setTimeout(() => p.remove(), dur * 1000);
    }, 700);
    return () => clearInterval(interval);
  }, []);

  // === TILT 3D ===
  useEffect(() => {
    const cards = document.querySelectorAll<HTMLDivElement>(".game.tiltable");
    const handlers: Array<{ el: HTMLDivElement; move: (e: MouseEvent) => void; leave: () => void }> = [];
    cards.forEach((card) => {
      const move = (e: MouseEvent) => {
        const rect = card.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width - 0.5;
        const y = (e.clientY - rect.top) / rect.height - 0.5;
        card.style.transform = `perspective(900px) rotateX(${-y * 4}deg) rotateY(${x * 6}deg)`;
      };
      const leave = () => {
        card.style.transform = "";
      };
      card.addEventListener("mousemove", move);
      card.addEventListener("mouseleave", leave);
      handlers.push({ el: card, move, leave });
    });
    return () => {
      handlers.forEach((h) => {
        h.el.removeEventListener("mousemove", h.move);
        h.el.removeEventListener("mouseleave", h.leave);
      });
    };
  }, [state.run, state.current, state.done.length, state.drawing?.gameId]);

  // === SHAKE ===
  const shakeScreen = () => {
    setShaking(false);
    setTimeout(() => setShaking(true), 10);
    setTimeout(() => setShaking(false), 600);
  };

  useEffect(() => {
    document.body.classList.toggle("shake", shaking);
  }, [shaking]);

  // === HELPERS ===
  const update = (patch: Partial<GauntletState>) => setState((s) => {
    const next = { ...s, ...patch };
    // If runLength shrinks, trim pinned to the new cap (floor(runLength / 2)).
    if (patch.runLength !== undefined) {
      const cap = pinCap(next.runLength);
      if (next.pinned.length > cap) next.pinned = next.pinned.slice(0, cap);
    }
    return next;
  });

  const leaveRoom = async () => {
    await fetch(`/api/room/${roomCode}/leave`, { method: "POST" }).catch(() => {});
    router.push("/lobby");
  };

  // Suggest the next available NATO-letter name so successive bots are easy to
  // tell apart in the slot machine.
  const nextDefaultBotName = (): string => {
    const NATO = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel"];
    const taken = new Set(members.map((m) => m.displayName.trim()));
    for (const w of NATO) {
      const candidate = `Bot ${w}`;
      if (!taken.has(candidate)) return candidate;
    }
    return `Bot ${members.length + 1}`;
  };

  const promptAddBot = () => {
    const name = window.prompt("Nom du bot :", nextDefaultBotName());
    if (name === null) return;
    const trimmed = name.trim();
    if (trimmed.length < 1) return;
    addBot(trimmed);
  };

  const copyRoomLink = async () => {
    // Static export ne supporte pas /room/[code], on utilise le query param qui
    // est lu par useSearchParams dans RoomPageInner.
    const url = `${window.location.origin}/room?code=${encodeURIComponent(roomCode)}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.prompt("Copie ce lien:", url);
    }
  };

  const togglePin = (id: number) => {
    setState((s) => {
      if (s.pinned.includes(id)) {
        return { ...s, pinned: s.pinned.filter((x) => x !== id) };
      }
      const cap = pinCap(s.runLength ?? 10);
      if (s.pinned.length < cap) {
        playClick();
        return { ...s, pinned: [...s.pinned, id] };
      }
      alert(`Maximum ${cap} jeu${cap > 1 ? "x" : ""} épinglé${cap > 1 ? "s" : ""} pour une run de ${s.runLength ?? 10}. Augmente la longueur ou retire-en un.`);
      return s;
    });
  };

  const generateRun = async () => {
    if (!isHost) {
      alert("Seul l'hôte peut générer la run.");
      return;
    }
    const pinned = [...state.pinned];
    // When library-only mode is on, fetch every member's library and shrink the
    // candidate pool to games every human owns. Pinned games are kept as-is —
    // they're an explicit override.
    let candidates = POOL.filter((g) => !pinned.includes(g.id));
    if (state.libraryOnlyMode) {
      try {
        const r = await fetch(`/api/steam/room-libraries/${roomCode}`, { credentials: "include" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json() as { libraries: Record<string, { appIds: number[]; visible: boolean }> };
        const libs = Object.values(data.libraries).filter((l) => l.visible);
        if (libs.length === 0) {
          alert("Bibliothèques Steam privées — impossible de filtrer. Désactive le mode ou rends ta bibliothèque publique.");
          return;
        }
        const ownedSets = libs.map((l) => new Set(l.appIds));
        candidates = candidates.filter((g) => {
          if (!g.appid) return false; // library-only mode excludes non-Steam games
          // Only one member needs to own the game — the team can rely on that
          // person to run / share it.
          return ownedSets.some((s) => s.has(g.appid as number));
        });
      } catch (e) {
        console.warn("[generateRun] library fetch failed", e);
        alert("Impossible de récupérer les bibliothèques Steam.");
        return;
      }
    }
    const runLength = Math.max(1, Math.min(10, state.runLength || 10));
    // Pinned games can never exceed the chosen run length — trim if needed.
    if (pinned.length > runLength) pinned.length = runLength;
    const remainingNeeded = runLength - pinned.length;
    if (remainingNeeded > candidates.length) {
      alert(
        state.libraryOnlyMode
          ? `Seulement ${candidates.length} jeu(x) dans la bibliothèque commune — il en faut ${remainingNeeded}.`
          : "Pas assez de jeux dans le pool !",
      );
      return;
    }
    let picks: number[];
    if (state.leastPlayedMode) {
      // Sort candidates by ascending play count, with a random tiebreak so two
      // runs of the same N rarely produce the same first slice. Then take the
      // top-N least played.
      let counts: Record<number, number> = {};
      try {
        const humanIds = members.filter((m) => !isSyntheticId(m.steamId)).map((m) => m.steamId);
        if (humanIds.length > 0) {
          const r = await fetch(`/api/stats/play-counts?steamIds=${humanIds.join(",")}`);
          if (r.ok) {
            const data = await r.json() as { counts: Record<number, number> };
            counts = data.counts ?? {};
          }
        }
      } catch (e) {
        console.warn("[generateRun] play-counts fetch failed", e);
      }
      const weighted = candidates
        .map((g) => ({ g, plays: counts[g.id] ?? 0, jitter: Math.random() }))
        .sort((a, b) => a.plays - b.plays || a.jitter - b.jitter);
      picks = weighted.slice(0, remainingNeeded).map((x) => x.g.id);
    } else {
      picks = shuffle(candidates).slice(0, remainingNeeded).map((g) => g.id);
    }
    const run = shuffle([...pinned, ...picks]);
    setState((s) => ({
      ...s,
      pendingRun: run,
      readyPlayers: [],
      countdownStartedAt: null,
    }));
    playClick();
  };

  const swapInPending = (gameId: number) => {
    if (!isHost) return;
    const pr = state.pendingRun;
    if (!pr) return;
    const idx = pr.indexOf(gameId);
    if (idx === -1) return;
    const available = POOL.filter((g) => !pr.includes(g.id));
    if (available.length === 0) {
      alert("Plus aucun jeu disponible dans le pool pour swap.");
      return;
    }
    const newGame = available[Math.floor(Math.random() * available.length)];
    const newRun = [...pr];
    newRun[idx] = newGame.id;
    // Swapping invalidates everyone's ready state — they need to re-confirm.
    setState((s) => ({ ...s, pendingRun: newRun, readyPlayers: [] }));
    playClick();
  };

  // Toggle the current player's ready state.
  const toggleReady = () => {
    if (!me) return;
    if (!state.pendingRun) return;
    if (state.countdownStartedAt !== null) return;
    setState((s) => {
      const ready = new Set(s.readyPlayers ?? []);
      if (ready.has(me.steamId)) ready.delete(me.steamId); else ready.add(me.steamId);
      return { ...s, readyPlayers: Array.from(ready) };
    });
    playClick();
  };

  // Launch the countdown. Triggered manually by the host, or automatically
  // when every human member is ready.
  const launchCountdown = () => {
    if (!state.pendingRun) return;
    if (state.countdownStartedAt !== null) return;
    const ups: Record<string, { joker: number; shield: number; reroll: number }> = {};
    if (state.powerUpsEnabled !== false) {
      members.forEach((m) => { ups[m.steamId] = { joker: 1, shield: 1, reroll: 1 }; });
    }
    setState((s) => ({
      ...s,
      countdownStartedAt: Date.now(),
      powerUps: ups,
      shieldActive: false,
    }));
    playClick();
  };

  const cancelReview = () => {
    if (!isHost) return;
    setState((s) => ({
      ...s,
      pendingRun: null,
      readyPlayers: [],
      countdownStartedAt: null,
    }));
  };

  const elapsed = state.runStartTime && state.run.length > 0 ? now - state.runStartTime : 0;

  const rerollRun = () => {
    if (state.run.length === 0) return;
    if (state.done.length > 0 && !confirm("Une run est en cours. Re-roll va tout remettre à zéro. Continuer ?")) return;
    generateRun();
  };

  const swapGame = (gameId: number) => {
    if (state.done.includes(gameId)) {
      alert("Ce jeu est déjà validé, impossible de le swap.");
      return;
    }
    const idx = state.run.indexOf(gameId);
    if (idx === -1) return;
    const available = POOL.filter((g) => !state.run.includes(g.id));
    if (available.length === 0) {
      alert("Plus aucun jeu disponible dans le pool pour swap.");
      return;
    }
    const newGame = available[Math.floor(Math.random() * available.length)];
    const newRun = [...state.run];
    newRun[idx] = newGame.id;
    const newPinned = state.pinned.filter((x) => x !== gameId);
    const newChampions = { ...state.champions };
    delete newChampions[gameId];
    setSwappedIdx(idx);
    if (swapTimer.current) clearTimeout(swapTimer.current);
    swapTimer.current = setTimeout(() => setSwappedIdx(null), 700);
    setState((s) => ({ ...s, run: newRun, pinned: newPinned, champions: newChampions }));
    playClick();
  };

  // === POWER-UPS ===
  const useJoker = (steamId: string) => {
    setState((s) => {
      const pu = s.powerUps[steamId];
      if (!pu || pu.joker <= 0 || s.run.length === 0) return s;
      const undone = s.run.filter((id) => !s.done.includes(id));
      if (undone.length === 0) return s;
      const gameToSwap = undone[Math.floor(Math.random() * undone.length)];
      const idx = s.run.indexOf(gameToSwap);
      const available = POOL.filter((g) => !s.run.includes(g.id));
      if (available.length === 0) return s;
      const newGame = available[Math.floor(Math.random() * available.length)];
      const newRun = [...s.run];
      newRun[idx] = newGame.id;
      const newPinned = s.pinned.filter((x) => x !== gameToSwap);
      const newChampions = { ...s.champions };
      delete newChampions[gameToSwap];
      return {
        ...s,
        run: newRun,
        pinned: newPinned,
        champions: newChampions,
        powerUps: { ...s.powerUps, [steamId]: { ...pu, joker: pu.joker - 1 } },
      };
    });
    playClick();
  };

  const useShield = (steamId: string) => {
    setState((s) => {
      const pu = s.powerUps[steamId];
      if (!pu || pu.shield <= 0 || s.shieldActive) return s;
      return {
        ...s,
        shieldActive: true,
        powerUps: { ...s.powerUps, [steamId]: { ...pu, shield: pu.shield - 1 } },
      };
    });
    playClick();
  };

  const useReroll = (steamId: string) => {
    const currentGameId = state.run[state.current];
    if (!currentGameId) return;
    if (!state.champions[currentGameId]) return;
    const currentGame = POOL.find((g) => g.id === currentGameId);
    if (!currentGame) return;
    const effMode = effectiveMode(currentGame, state.difficulty);
    if (effMode !== "solo" && effMode !== "duo") return;
    setState((s) => {
      const pu = (s.powerUps ?? {})[steamId];
      if (!pu || pu.reroll <= 0) return s;
      const newChampions = { ...s.champions };
      delete newChampions[currentGameId];
      return {
        ...s,
        champions: newChampions,
        powerUps: { ...s.powerUps, [steamId]: { ...pu, reroll: pu.reroll - 1 } },
      };
    });
    setTimeout(() => drawChampion(currentGameId, effMode as "solo" | "duo"), 80);
  };

  // === OWNERSHIP OVERRIDE ===
  // Click your own avatar on a game card to claim/un-claim ownership when Steam
  // can't see your library (private game-details setting) or just got it wrong.
  // Cycles: unknown/missing → owned → not owned → owned → … Steam-fetched data
  // stays in `ownership`; this only writes to `ownershipOverride`, which the
  // chip renderer prefers when present.
  const toggleOwnershipOverride = (appid: number) => {
    if (!me) return;
    const key = String(appid);
    setState((s) => {
      const myOverrides = { ...(s.ownershipOverride?.[me.steamId] ?? {}) };
      const current = myOverrides[key];
      const auto = s.ownership?.[me.steamId]?.[key];
      const displayed = current !== undefined ? current : auto;
      myOverrides[key] = displayed !== true; // unknown/false → true ; true → false
      return {
        ...s,
        ownershipOverride: {
          ...(s.ownershipOverride ?? {}),
          [me.steamId]: myOverrides,
        },
      };
    });
    playClick();
  };

  // === SLOT MACHINE DRAW ===
  const drawChampion = (gameId: number, mode: "solo" | "duo") => {
    const players = members.map((m) => m.displayName).filter((p) => p && p.trim());
    if (players.length === 0) {
      alert("Aucun joueur dans la room !");
      return;
    }
    if (mode === "duo" && players.length < 2) {
      alert("Il faut au moins 2 joueurs pour un duo.");
      return;
    }
    initAudio();

    // Decide who's drawn and how the slots are partitioned.
    //   solo:               1 player    → pairSize = 1, final.length = 1
    //   duo with 2 players: 1 duo       → pairSize = 2, final.length = 2 (A & B)
    //   duo with 4 players: 2 duos      → pairSize = 2, final.length = 4 (A & B · C & D)
    //   duo with N players (N>=2):      → pairSize = 2, final.length = 2*floor(N/2)
    // Duos are cooperating pairs running the objective independently — they're
    // not opposing teams. Any leftover odd player is benched.
    let final: string[];
    let pairSize: number;
    if (mode === "duo") {
      const numDuos = Math.max(1, Math.floor(players.length / 2));
      const drawn = numDuos * 2;
      final = shuffle(players).slice(0, drawn);
      pairSize = 2;
    } else {
      final = [players[Math.floor(Math.random() * players.length)]];
      pairSize = 1;
    }

    const reelCount = final.length;
    // Stagger the reels so each one finishes a beat after the previous; keeps the
    // animation feeling weighty even when the draw expands to 6 reels (3v3).
    const cyclesForReel = (r: number) => 10 + r * 4;
    const reels: string[][] = [];
    for (let r = 0; r < reelCount; r++) {
      const cells: string[] = [];
      const totalCells = cyclesForReel(r) + 1;
      for (let i = 0; i < totalCells; i++) {
        cells.push(i === totalCells - 1 ? final[r] : players[Math.floor(Math.random() * players.length)]);
      }
      reels.push(cells);
    }

    // Push the draw into synced state — every client reads `state.drawing` and
    // runs the local rAF animation in the effect below. Animation start time is
    // wall-clock so late receivers catch up to the right frame instead of
    // replaying from zero.
    setState((s) => ({
      ...s,
      drawing: {
        gameId,
        reels,
        final,
        pairSize,
        startedAt: Date.now(),
        initiator: me?.steamId ?? "",
      },
    }));
  };

  // === HISTORY ===
  const logRunToHistory = (
    s: GauntletState,
    outcome: "win" | "lose",
    failedGameId: number | null = null
  ): RunHistoryEntry[] => {
    if (!s.runStartTime) return s.history;
    const entry: RunHistoryEntry = {
      id: Date.now(),
      ts: Date.now(),
      outcome,
      attempts: s.attempt,
      duration: Date.now() - s.runStartTime,
      difficulty: s.difficulty,
      penaltyMode: s.penaltyMode,
      runIds: [...s.run],
      failedGameId,
      championPicks: { ...s.champions },
      completed: s.done.length,
      total: s.run.length,
    };
    return [entry, ...(s.history || [])].slice(0, 50);
  };

  // === PER-GAME COUNTDOWN (only for games with `timer: true`) ===
  // Now goes through the websocket: the server stamps `timerDeadline` so every
  // client converges on the same remaining time regardless of clock skew.
  const startTimer = (minutes: number) => {
    const m = Number.isFinite(minutes) && minutes > 0 ? Math.min(minutes, 120) : 5;
    socketStartTimer(m);
  };
  const resetTimer = () => socketClearTimer();

  // === VERSUS — auto-assigns humans into red/blue teams, alternating ===
  const assignVersusTeams = () => {
    if (!isHost) return;
    const humans = members.filter((m) => !isSyntheticId(m.steamId));
    const shuffled = shuffle(humans);
    const teams: Record<string, "red" | "blue"> = {};
    shuffled.forEach((m, i) => { teams[m.steamId] = i % 2 === 0 ? "red" : "blue"; });
    setState((s) => ({ ...s, versusMode: true, teams, gameWinners: {} }));
    playClick();
  };

  // Toggle a single player's team — host can rebalance manually.
  const togglePlayerTeam = (steamId: string) => {
    if (!isHost) return;
    setState((s) => {
      const current = s.teams[steamId];
      const next = current === "red" ? "blue" : "red";
      return { ...s, teams: { ...s.teams, [steamId]: next } };
    });
  };

  // Versus score derived from gameWinners.
  const versusScore = (() => {
    let red = 0, blue = 0;
    for (const t of Object.values(state.gameWinners)) {
      if (t === "red") red++; else if (t === "blue") blue++;
    }
    return { red, blue };
  })();

  // === VERSUS — one team scores the current game ===
  const winVersusGame = (gameId: number, team: "red" | "blue") => {
    setState((s) => {
      if (s.done.includes(gameId)) return s;
      const newDone = [...s.done, gameId];
      const newCurrent = s.current + 1;
      const winners = { ...s.gameWinners, [gameId]: team };
      let next: GauntletState = {
        ...s,
        done: newDone,
        current: newCurrent,
        gameWinners: winners,
        timerDeadline: null,
      };
      if (newDone.length === s.run.length) {
        next = { ...next, history: logRunToHistory({ ...next }, "win") };
      }
      return next;
    });
    playClick();
  };

  // === WIN / LOSE ===
  const winGame = (gameId: number) => {
    setState((s) => {
      if (s.done.includes(gameId)) return s;
      const newDone = [...s.done, gameId];
      const newCurrent = s.current + 1;
      let next: GauntletState = { ...s, done: newDone, current: newCurrent, timerDeadline: null };
      if (newDone.length === s.run.length) {
        // FULL GAUNTLET — append the history entry; the celebration useEffect
        // below picks up the new history[0].id and fires confetti + overlay.
        // Same code path also handles Twitch-triggered skips that complete the
        // gauntlet (server appends history, client sees it, useEffect fires).
        next = { ...next, history: logRunToHistory({ ...next }, "win") };
      }
      return next;
    });
    playClick();
    fireConfetti(0.15);
  };

  // Win-celebration trigger — fires once per winning history entry, regardless
  // of whether the gauntlet was completed locally (winGame) or remotely
  // (Twitch skip effect). Deduped via a ref keyed on the entry id.
  const celebratedWinIdRef = useRef<number | null>(null);
  useEffect(() => {
    const top = state.history[0];
    if (!top || top.outcome !== "win") return;
    if (state.run.length === 0 || state.done.length !== state.run.length) return;
    if (celebratedWinIdRef.current === top.id) return;
    celebratedWinIdRef.current = top.id;
    const t = setTimeout(() => {
      fireConfetti(2);
      playGauntletWin();
      setOverlay({ kind: "win" });
    }, 400);
    return () => clearTimeout(t);
  }, [state.history, state.run.length, state.done.length]);

  const loseGame = (gameId: number) => {
    setState((s) => {
      if (s.shieldActive) {
        const g = POOL.find((x) => x.id === gameId);
        const msg = `Défaite sur ${g?.name ?? "ce jeu"} — le Bouclier a absorbé la pénalité !`;
        setOverlay({ kind: "lose", msg });
        return { ...s, shieldActive: false };
      }
      const g = POOL.find((x) => x.id === gameId);
      const idx = s.run.indexOf(gameId);
      const runFails = { ...s.runFails, [gameId]: (s.runFails[gameId] || 0) + 1 };
      let msg = "";
      let next: GauntletState;

      if (s.penaltyMode === "stepback") {
        if (idx <= 0) {
          msg = `Défaite sur ${g?.name ?? "ce jeu"}. Tu es au jeu 1, impossible de reculer plus — réessaye !`;
          next = { ...s, attempt: s.attempt + 1, runFails, timerDeadline: null };
        } else {
          const prevGameId = s.run[idx - 1];
          const prevG = POOL.find((x) => x.id === prevGameId);
          msg = `Défaite sur ${g?.name ?? "ce jeu"}. Tu recules d'un jeu : retour sur ${prevG?.name ?? "le jeu précédent"} (jeu #${idx}).`;
          next = {
            ...s,
            attempt: s.attempt + 1,
            current: idx - 1,
            done: s.done.filter((x) => x !== prevGameId),
            runFails,
            timerDeadline: null,
          };
        }
      } else {
        // Reset complet — log this run as failed
        msg = `Défaite sur ${g?.name ?? "ce jeu"}. Tentative #${s.attempt + 1} — la run recommence depuis le jeu 1.`;
        const newHistory = logRunToHistory(s, "lose", gameId);
        next = {
          ...s,
          attempt: s.attempt + 1,
          current: 0,
          done: [],
          champions: {},
          runStartTime: Date.now(),
          timerDeadline: null,
          runFails: {},
          history: newHistory,
        };
      }

      setOverlay({ kind: "lose", msg });
      return next;
    });
    shakeScreen();
    playLose();
  };

  const fullReset = () => {
    setState((s) => ({
      ...s,
      attempt: 1,
      current: 0,
      done: [],
      champions: {},
      run: [],
      runStartTime: null,
      timerDeadline: null,
      runFails: {},
    }));
  };

  const hardReset = () => {
    if (!confirm("Reset complet ? Toute la progression et les épinglages seront effacés.")) return;
    setState((s) => ({
      ...DEFAULT_STATE,
      difficulty: s.difficulty,
      penaltyMode: s.penaltyMode,
      players: s.players,
      playerCount: s.playerCount,
      soundEnabled: s.soundEnabled,
      history: s.history,
    }));
  };

  // === STATS ===
  const computeStats = (): RunStats => {
    const h = state.history || [];
    const total = h.length;
    const wins = h.filter((x) => x.outcome === "win").length;
    const successRate = total > 0 ? Math.round((wins / total) * 100) : 0;
    const totalDuration = h.reduce((acc, x) => acc + (x.duration || 0), 0);
    const avgAttempts =
      total > 0 ? (h.reduce((a, x) => a + (x.attempts || 1), 0) / total).toFixed(1) : "0";
    const failedCounts: Record<number, number> = {};
    h.filter((x) => x.outcome === "lose" && x.failedGameId).forEach((x) => {
      const id = x.failedGameId as number;
      failedCounts[id] = (failedCounts[id] || 0) + 1;
    });
    let mostFailedId: number | null = null;
    let mostFailedCount = 0;
    Object.entries(failedCounts).forEach(([id, c]) => {
      if (c > mostFailedCount) {
        mostFailedCount = c;
        mostFailedId = parseInt(id);
      }
    });
    const mostFailedGame: Game | null | undefined = mostFailedId ? POOL.find((g) => g.id === mostFailedId) : null;
    const championCounts: Record<string, number> = {};
    h.forEach((x) => {
      Object.values(x.championPicks || {}).forEach((name) => {
        String(name).split(" & ").forEach((n) => {
          championCounts[n] = (championCounts[n] || 0) + 1;
        });
      });
    });
    let topChampion = "—";
    let topChampionCount = 0;
    Object.entries(championCounts).forEach(([name, c]) => {
      if (c > topChampionCount) {
        topChampionCount = c;
        topChampion = name;
      }
    });
    return { total, wins, successRate, totalDuration, avgAttempts, mostFailedGame, mostFailedCount, topChampion, topChampionCount };
  };

  // === DERIVED ===
  const filteredPool = POOL.filter(
    (g) =>
      (localFilter === "all" || g.cat === localFilter) &&
      (!localSearch || g.name.toLowerCase().includes(localSearch.toLowerCase()))
  ).sort((a, b) => {
    const aPinned = state.pinned.includes(a.id);
    const bPinned = state.pinned.includes(b.id);
    if (aPinned !== bPinned) return aPinned ? -1 : 1;
    return a.name.localeCompare(b.name, "fr", { sensitivity: "base" });
  });
  // Lock config once a run is active (run generated + countdown done)
  const runLocked = state.run.length > 0;
  // Player slots: every member + one waiting placeholder, with a minimum of 3
  // (so an empty room still shows the familiar layout). Capped at the server's
  // 8-member limit.
  const slotCount = Math.min(MAX_MEMBERS, Math.max(3, members.length + 1));

  const stats = computeStats();

  return (
    <>
      {/* Background particles */}
      <div id="bgParticles" ref={particlesRef}></div>
      {/* Confetti canvas */}
      <canvas id="confettiCanvas" ref={confettiRef}></canvas>

      <div className="room-layout">
        {/* Mirror spacer — keeps `room-main` centered between the spacer (left) and
            the Atouts sidebar (right). The sidebar is always rendered now (showing a
            compact "disabled" state when powerUps are off), so the spacer stays too. */}
        <div className="room-spacer" aria-hidden="true" />
        <div className="room-main">
          <RoomBanner
            roomCode={roomCode}
            members={members}
            ownerSteamId={ownerSteamId}
            connected={connected}
            onCopyLink={copyRoomLink}
            onShowOverlays={() => setShowOverlays(true)}
            onLeave={leaveRoom}
          />

          <RoomHero
            state={state}
            members={members}
            elapsed={elapsed}
            isHost={isHost}
            runLocked={runLocked}
            versusScore={versusScore}
            onAssignTeams={assignVersusTeams}
            onTogglePlayerTeam={togglePlayerTeam}
          />

          {/* CONFIG — hidden once a run is generated. Reopens after Reset complet.
              Two-step flow: first the room configuration, then the pool selection. */}
          {!runLocked && (
            <>
              <RoomConfig
                state={state}
                members={members}
                ownerSteamId={ownerSteamId}
                isHost={isHost}
                runLocked={runLocked}
                slotCount={slotCount}
                configStep={configStep}
                setConfigStep={setConfigStep}
                update={update}
                onPromptAddBot={promptAddBot}
                onRemoveBot={removeBot}
                onAssignTeams={assignVersusTeams}
              />
              {configStep === "pool" && (
                <RoomPool
                  state={state}
                  isHost={isHost}
                  filteredPool={filteredPool}
                  localSearch={localSearch}
                  setLocalSearch={setLocalSearch}
                  localFilter={localFilter}
                  setLocalFilter={setLocalFilter}
                  setConfigStep={setConfigStep}
                  setObjTip={setObjTip}
                  togglePin={togglePin}
                  generateRun={generateRun}
                  rerollRun={rerollRun}
                />
              )}
            </>
          )}

          {runLocked && (
            <PlayersPanel
              members={members}
              ownerSteamId={ownerSteamId}
              runLocked={runLocked}
              slotCount={slotCount}
              onPromptAddBot={promptAddBot}
              onRemoveBot={removeBot}
            />
          )}

          <RoomRun
            state={state}
            members={members}
            me={me}
            now={now}
            swappedIdx={swappedIdx}
            nameToAvatar={nameToAvatar}
            timerInputMin={timerInputMin}
            setTimerInputMin={setTimerInputMin}
            swapGame={swapGame}
            drawChampion={drawChampion}
            winGame={winGame}
            loseGame={loseGame}
            winVersusGame={winVersusGame}
            startTimer={startTimer}
            resetTimer={resetTimer}
            toggleOwnershipOverride={toggleOwnershipOverride}
          />

          <RunHistory
            state={state}
            stats={stats}
            onToggleShowHistory={() => update({ showHistory: !state.showHistory })}
          />

          {/* GLOBAL CONTROLS */}
          <div className="controls">
            <button className="btn btn-large btn-reset" onClick={hardReset}>
              Reset complet
            </button>
          </div>

          <GameRules />
        </div>{/* end room-main */}

        <PowerUpsBar
          state={state}
          members={members}
          me={me}
          onUseJoker={useJoker}
          onUseShield={useShield}
          onUseReroll={useReroll}
        />
      </div>{/* end room-layout */}

      <WinLoseOverlay
        overlay={overlay}
        onCloseWin={() => { setOverlay({ kind: null }); fullReset(); }}
        onCloseLose={() => setOverlay({ kind: null })}
      />

      {reviewing && pendingRun && (
        <ReviewModal
          state={state}
          pendingRun={pendingRun}
          members={members}
          me={me}
          isHost={isHost}
          onToggleReady={toggleReady}
          onSwapInPending={swapInPending}
          onCancelReview={cancelReview}
          onLaunchCountdown={launchCountdown}
        />
      )}

      {countdownDigit !== null && <CountdownOverlay countdown={countdownDigit} />}

      {objTip !== null && <ObjectivesTooltip objTip={objTip} />}

      {showOverlays && (
        <OverlayLinksModal
          overlayToken={overlayToken}
          overlayTokenLoading={overlayTokenLoading}
          onClose={() => setShowOverlays(false)}
        />
      )}
    </>
  );
}
