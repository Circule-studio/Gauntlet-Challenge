"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { isGuestId, type SteamSessionUser } from "@/lib/types/steam";
import type { RoomSnapshot } from "@/lib/types/room";

interface TwitchSummary {
  login: string;
  displayName: string;
}

// Mirrors the allowlist in backend/src/routes/games.ts. Hiding the link is UX
// only — the API enforces the real check.
const GAMES_EDITORS = new Set([
  "76561198285334414",
  "76561198300061591",
]);

export default function LobbyPage() {
  const router = useRouter();
  const [user, setUser] = useState<SteamSessionUser | null>(null);
  const [twitch, setTwitch] = useState<TwitchSummary | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/me", { cache: "no-store" });
        if (cancelled) return;
        if (!res.ok) {
          setAuthError(`Le serveur a répondu ${res.status} ${res.statusText}.`);
          return;
        }
        const data = (await res.json()) as { user: SteamSessionUser | null };
        if (cancelled) return;
        if (!data.user) {
          // /api/auth/me returns null + clears any stale cookie. Safe to redirect.
          router.replace("/login");
          return;
        }
        setUser(data.user);
        // Best-effort Twitch link probe — the lobby still renders if it fails.
        fetch("/api/twitch/me", { cache: "no-store" })
          .then((r) => (r.ok ? r.json() : null))
          .then((d: { connected?: boolean; login?: string; displayName?: string } | null) => {
            if (cancelled || !d?.connected || !d.login || !d.displayName) return;
            setTwitch({ login: d.login, displayName: d.displayName });
          })
          .catch(() => {});
      } catch (e) {
        if (cancelled) return;
        // Network failure (server down, mid-request shutdown, blocked by proxy).
        // Don't auto-redirect — that just loops. Show the error so we know.
        setAuthError(`Connexion au serveur impossible : ${(e as Error).message}`);
      }
    })();
    return () => { cancelled = true; };
  }, [router]);

  const createRoom = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/room", { method: "POST" });
      if (!res.ok) throw new Error("create_failed");
      const room = (await res.json()) as RoomSnapshot;
      router.push(`/room?code=${room.code}`);
    } catch {
      setError("Impossible de créer la room");
    } finally {
      setBusy(false);
    }
  };

  const joinRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/room/${code}`);
      if (res.status === 404) {
        setError("Room introuvable");
        return;
      }
      if (!res.ok) throw new Error("join_failed");
      router.push(`/room?code=${code}`);
    } catch {
      setError("Erreur réseau");
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  };

  if (authError) {
    return (
      <main className="auth-shell">
        <div className="auth-card">
          <h1 className="auth-title">Erreur</h1>
          <p className="auth-error">{authError}</p>
          <button className="auth-btn" onClick={() => window.location.reload()}>
            Réessayer
          </button>
          <button
            className="auth-btn auth-btn-secondary"
            onClick={async () => {
              await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
              router.replace("/login");
            }}
          >
            Se reconnecter
          </button>
        </div>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="auth-shell">
        <div className="auth-card">
          <p className="auth-subtitle">Chargement…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="auth-shell">
      <div className="auth-card lobby-card">
        <div className="lobby-user">
          <img src={user.avatarUrl} alt="" className="lobby-avatar" />
          <div className="lobby-user-info">
            <div className="lobby-user-name">
              <span>{user.displayName}</span>
              {twitch && (
                <span
                  className="lobby-user-twitch"
                  title={`Twitch connecté : ${twitch.displayName}`}
                  aria-label={`Twitch connecté : ${twitch.displayName}`}
                >
                  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M21 2H3v16h5v4l4-4h5l4-4V2zM11 11V7M16 11V7"/>
                  </svg>
                </span>
              )}
            </div>
            <button className="lobby-logout" onClick={logout}>Se déconnecter</button>
          </div>
        </div>

        <div className="lobby-quick-links">
          {!isGuestId(user.steamId) && (
            <>
              <a href={`/u?id=${user.steamId}`}>Mon profil</a>
              <span aria-hidden>·</span>
            </>
          )}
          <a href="/leaderboards/">Classements</a>
          <span aria-hidden>·</span>
          <a href="/games/">Stats par jeu</a>
          {!isGuestId(user.steamId) && (
            <>
              <span aria-hidden>·</span>
              <a href="/twitch/">Twitch</a>
            </>
          )}
        </div>

        <h1 className="auth-title">Salon</h1>

        <button className="auth-btn" disabled={busy} onClick={createRoom}>
          Créer une room
        </button>

        <div className="lobby-divider"><span>ou</span></div>

        <form onSubmit={joinRoom} className="lobby-join">
          <label htmlFor="join-code">Rejoindre une room</label>
          <input
            id="join-code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))}
            placeholder="ABC123"
            spellCheck={false}
            autoComplete="off"
            className="pair-code-input"
          />
          <button className="auth-btn auth-btn-secondary" type="submit" disabled={busy || code.length !== 6}>
            Rejoindre
          </button>
        </form>

        {GAMES_EDITORS.has(user.steamId) && (
          <a href="/admin/games/" className="auth-btn lobby-admin-btn">
            Admin — éditer les jeux
          </a>
        )}

        {error && <p className="auth-error">{error}</p>}
      </div>
    </main>
  );
}
