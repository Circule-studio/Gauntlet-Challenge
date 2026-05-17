"use client";

import { useState } from "react";

const WIDGETS: { key: string; label: string; file: string; size: string }[] = [
  { key: "total",   label: "Temps total",    file: "total-time.html",   size: "320 × 140" },
  { key: "wins",    label: "Victoires",      file: "victories.html",    size: "320 × 140" },
  { key: "resets",  label: "Resets",         file: "resets.html",       size: "320 × 140" },
  { key: "current", label: "Jeu en cours",   file: "current-game.html", size: "400 × 180" },
  { key: "list",    label: "Liste des jeux", file: "game-list.html",    size: "400 × 950" },
];

export function OverlayLinksModal({
  overlayToken,
  overlayTokenLoading,
  onClose,
}: {
  overlayToken: string | null;
  overlayTokenLoading: boolean;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const buildUrl = (file: string) =>
    overlayToken
      ? `${origin}/overlays/widgets/${file}?token=${encodeURIComponent(overlayToken)}`
      : "";

  const copy = async (key: string, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(key);
      setTimeout(() => setCopied((k) => (k === key ? null : k)), 1400);
    } catch {
      window.prompt("Copie ce lien :", url);
    }
  };

  return (
    <div className="overlay show" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="overlay-links-modal">
        <button className="overlay-links-close" onClick={onClose} aria-label="Fermer">×</button>
        <h3>Overlays Twitch</h3>
        <p className="overlay-links-hint">
          Sources navigateur OBS personnelles. À configurer une seule fois — les liens suivent ton
          compte Steam et basculent automatiquement vers la room courante à chaque nouvelle run.
          Garde-les privés : ils donnent un accès lecture à ton état de jeu.
        </p>
        {!overlayToken ? (
          <div className="overlay-links-loading">
            {overlayTokenLoading ? "Génération du token…" : "Token indisponible — réessaie."}
          </div>
        ) : (
          <div className="overlay-links-list">
            {WIDGETS.map((w) => {
              const url = buildUrl(w.file);
              const isCopied = copied === w.key;
              return (
                <div key={w.key} className="overlay-links-row">
                  <div className="overlay-links-row-label">
                    {w.label}
                    <div className="overlay-links-row-size" title="Résolution OBS recommandée (largeur × hauteur en px)">{w.size}</div>
                  </div>
                  <input className="overlay-links-row-url" type="text" value={url} readOnly onFocus={(e) => e.currentTarget.select()} />
                  <button
                    className={`overlay-links-row-copy${isCopied ? " copied" : ""}`}
                    onClick={() => copy(w.key, url)}
                  >
                    {isCopied ? "Copié !" : "Copier"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
