"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type {
  EffectStatus,
  EventSubStatusPayload,
  TwitchEvent,
  TwitchFullStatus,
} from "@/lib/types/twitch";

const EVENTSUB_LABEL: Record<EventSubStatusPayload["status"], string> = {
  disconnected: "Déconnecté",
  connecting: "Connexion…",
  welcomed: "Connecté (sub en cours)",
  subscribed: "Connecté + abonné",
  stopping: "Arrêt…",
};

function TwitchShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth-shell">
      <div className="auth-card profile-card twitch-card">{children}</div>
    </main>
  );
}

function TwitchBody() {
  const params = useSearchParams();
  const [status, setStatus] = useState<TwitchFullStatus | null>(null);
  const [events, setEvents] = useState<TwitchEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const flashError = params.get("error");
  const flashConnected = params.get("connected");

  const refresh = async () => {
    try {
      const res = await fetch("/api/twitch/status", { cache: "no-store" });
      if (res.status === 401) {
        setError("Connecte-toi d'abord avec Steam.");
        return;
      }
      if (!res.ok) throw new Error(`http_${res.status}`);
      const data = (await res.json()) as TwitchFullStatus;
      setStatus(data);
      setError(null);
      // Only fetch events when actually connected — saves a 404 round-trip.
      if (data.connected) {
        const evRes = await fetch("/api/twitch/events?limit=30", { cache: "no-store" });
        if (evRes.ok) {
          const body = (await evRes.json()) as { events: TwitchEvent[] };
          setEvents(body.events);
        }
      } else {
        setEvents([]);
      }
    } catch (e) {
      setError(`Erreur réseau : ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // Light polling so the streamer sees EventSub connecting → subscribed and
    // any incoming events without manual refresh.
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, []);

  const connect = () => {
    window.location.href = "/api/twitch/auth/start";
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/twitch/auth/disconnect", { method: "POST" });
      if (!res.ok) throw new Error(`http_${res.status}`);
      await refresh();
    } catch (e) {
      setError(`Déconnexion impossible : ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const toggleAutoCategory = async (enabled: boolean) => {
    setBusy(true);
    try {
      const res = await fetch("/api/twitch/auto-category", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error(`http_${res.status}`);
      await refresh();
    } catch (e) {
      setError(`Échec : ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <TwitchShell>
      <h1 className="profile-name" style={{ marginBottom: 0 }}>Intégration Twitch</h1>
      <p className="auth-subtitle" style={{ marginTop: 0 }}>
        Connecte ton compte Twitch pour permettre à tes viewers de déclencher des effets en jeu via channel points et bits.
      </p>

      {flashError && (
        <p className="auth-error">
          Échec de la connexion Twitch : <code>{flashError}</code>
        </p>
      )}
      {flashConnected && status?.connected && (
        <p className="twitch-flash-success">Twitch connecté avec succès !</p>
      )}

      {loading && <p className="auth-subtitle">Chargement…</p>}
      {error && <p className="auth-error">{error}</p>}

      {status && status.connected && (
        <>
          <div className="twitch-status">
            <div className="twitch-status-header">
              <div className="twitch-status-name">
                <strong>{status.displayName}</strong>
                <span className="twitch-status-login">@{status.login}</span>
              </div>
              <span className="twitch-status-pill">Connecté</span>
            </div>

            <div className="twitch-eventsub">
              <div className="twitch-eventsub-row">
                <span className="twitch-eventsub-label">EventSub</span>
                <span
                  className={`twitch-eventsub-state state-${status.eventsub.status}`}
                >
                  {EVENTSUB_LABEL[status.eventsub.status]}
                </span>
              </div>
              <div className="twitch-eventsub-row">
                <span className="twitch-eventsub-label">Abonnements</span>
                <span>
                  {status.eventsub.subscribedTypes.length === 0
                    ? "—"
                    : status.eventsub.subscribedTypes
                        .map((t) => t.replace("channel.", "").replace("channel_points_custom_reward_redemption.", "redemption."))
                        .join(" · ")}
                </span>
              </div>
              {status.eventsub.lastEventAt && (
                <div className="twitch-eventsub-row">
                  <span className="twitch-eventsub-label">Dernier event</span>
                  <span>
                    {status.eventsub.lastEventType ?? "?"}
                    {" · "}
                    {new Date(status.eventsub.lastEventAt).toLocaleTimeString("fr-FR")}
                  </span>
                </div>
              )}
              {status.eventsub.lastError && (
                <div className="twitch-eventsub-row">
                  <span className="twitch-eventsub-label">Erreur</span>
                  <span className="twitch-eventsub-error">{status.eventsub.lastError}</span>
                </div>
              )}
            </div>

            <button
              className="auth-btn auth-btn-secondary"
              onClick={disconnect}
              disabled={busy}
            >
              {busy ? "Déconnexion…" : "Déconnecter Twitch"}
            </button>
          </div>

          <section>
            <h2 className="profile-section-title">Catégorie automatique</h2>
            <label className="twitch-auto-cat">
              <input
                type="checkbox"
                checked={status.autoCategory}
                disabled={busy || !status.canAutoCategory}
                onChange={(e) => toggleAutoCategory(e.target.checked)}
              />
              <span>
                Mettre à jour la catégorie de ma chaîne Twitch quand le jeu en cours change.
              </span>
            </label>
            {!status.canAutoCategory && (
              <p className="auth-subtitle twitch-auto-cat-hint">
                Cette option nécessite la permission <code>channel:manage:broadcast</code>. Reconnecte ton Twitch pour l&apos;accorder.
              </p>
            )}
          </section>

          <section>
            <h2 className="profile-section-title">Effets configurés</h2>
            <ul className="twitch-effects">
              {status.effects.map((e) => (
                <EffectRow key={e.key} effect={e} />
              ))}
            </ul>
            <p className="auth-subtitle" style={{ fontSize: 11, marginTop: 8 }}>
              Bits : les viewers cheerent en chat avec un mot-clé, ex.{" "}
              <code>Cheer100 !reroll</code>, <code>Cheer200 !shield</code>,{" "}
              <code>Cheer500 !skip</code>, <code>Cheer50 !pin</code>,{" "}
              <code>Cheer100 !joker</code>. Les cheers sous-financés sont ignorés.
            </p>
          </section>

          <section>
            <h2 className="profile-section-title">Activité récente</h2>
            {events.length === 0 ? (
              <p className="auth-subtitle">Aucun event reçu pour l&apos;instant.</p>
            ) : (
              <ul className="twitch-activity">
                {events.map((ev) => <ActivityRow key={ev.id} ev={ev} />)}
              </ul>
            )}
          </section>
        </>
      )}

      {status && !status.connected && (
        <div className="twitch-connect">
          <p className="auth-subtitle" style={{ marginBottom: 12 }}>
            Compte non connecté. Clique pour autoriser l&apos;application sur Twitch.
          </p>
          <button className="auth-btn twitch-btn-primary" onClick={connect}>
            Connecter Twitch
          </button>
          <p className="auth-subtitle" style={{ fontSize: 11, marginTop: 12 }}>
            Permissions demandées : lecture des channel points, gestion des récompenses personnalisées, lecture des cheers.
          </p>
        </div>
      )}

      <Link className="auth-btn auth-btn-secondary" href="/lobby/">Retour au salon</Link>
    </TwitchShell>
  );
}

const FAIL_REASON_LABEL: Record<string, string> = {
  no_link: "Aucun compte Twitch",
  no_active_room: "Aucune room active",
  no_change: "État inchangé",
  not_applicable: "Effet non applicable",
  unknown_reward: "Récompense inconnue",
  no_keyword: "Pas de mot-clé",
  not_bits_eligible: "Pas en bits",
};

function ActivityRow({ ev }: { ev: TwitchEvent }) {
  const time = new Date(ev.receivedAt).toLocaleTimeString("fr-FR");
  const sourceIcon = ev.source === "bits" ? "💎" : "★";
  const failLabel = ev.failReason
    ? (FAIL_REASON_LABEL[ev.failReason] ?? (ev.failReason.startsWith("underfunded_") ? `Sous-financé (besoin ${ev.failReason.split("_").pop()} bits)` : ev.failReason))
    : null;
  return (
    <li className={`twitch-activity-row ${ev.applied ? "applied" : "failed"}`}>
      <span className="twitch-activity-time">{time}</span>
      <span className="twitch-activity-source" title={ev.source}>{sourceIcon}</span>
      <span className="twitch-activity-effect">
        {ev.effectKey ?? ev.rewardTitle ?? "—"}
        {ev.bits !== null && <small> · {ev.bits} bits</small>}
      </span>
      <span className="twitch-activity-user">@{ev.userLogin ?? "anon"}</span>
      <span className="twitch-activity-outcome">
        {ev.applied ? "✓ Appliqué" : `✕ ${failLabel ?? "Échec"}`}
      </span>
    </li>
  );
}

function EffectRow({ effect }: { effect: EffectStatus }) {
  const hasReward = effect.reward !== null;
  const cpDisplay = effect.channelPointCost === null
    ? "—"
    : hasReward
      ? `${effect.reward!.cost} pts ✓`
      : `${effect.channelPointCost} pts (en attente)`;
  const bitsDisplay = effect.bitsCost === null ? "—" : `${effect.bitsCost} bits`;
  return (
    <li className="twitch-effect-row">
      <div className="twitch-effect-main">
        <strong>{effect.title}</strong>
        <small>{effect.prompt}</small>
      </div>
      <div className="twitch-effect-costs">
        <span className={hasReward ? "twitch-cost-ok" : "twitch-cost-pending"}>{cpDisplay}</span>
        <span>{bitsDisplay}</span>
      </div>
    </li>
  );
}

export default function TwitchPage() {
  return (
    <Suspense fallback={<TwitchShell><p className="auth-subtitle">Chargement…</p></TwitchShell>}>
      <TwitchBody />
    </Suspense>
  );
}
