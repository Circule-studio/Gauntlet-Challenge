import type { GauntletState } from "@/lib/types";
import type { RoomMember } from "@/lib/types/room";
import type { SteamSessionUser } from "@/lib/types/steam";
import { isSyntheticId } from "@/lib/types/steam";
import { POOL, effectiveMode } from "@/lib/games";
import { Icon } from "./Icon";
import { GameCover } from "./GameCover";

export function ReviewModal({
  state,
  pendingRun,
  members,
  me,
  isHost,
  onToggleReady,
  onSwapInPending,
  onCancelReview,
  onLaunchCountdown,
}: {
  state: GauntletState;
  pendingRun: number[];
  members: RoomMember[];
  me: SteamSessionUser | null;
  isHost: boolean;
  onToggleReady: () => void;
  onSwapInPending: (gameId: number) => void;
  onCancelReview: () => void;
  onLaunchCountdown: () => void;
}) {
  const steamSearchUrl = (name: string) =>
    `https://store.steampowered.com/search/?term=${encodeURIComponent(name)}`;

  const humans = members.filter((m) => !isSyntheticId(m.steamId));
  const ready = new Set(state.readyPlayers ?? []);
  const readyCount = humans.filter((m) => ready.has(m.steamId)).length;
  const allReady = humans.length > 0 && humans.every((m) => ready.has(m.steamId));
  const meIsHuman = !!me && !isSyntheticId(me.steamId);
  const meIsReady = meIsHuman && (state.readyPlayers ?? []).includes(me.steamId);

  return (
    <div className="overlay show">
      <div className="overlay-content review-content">
        <h2>Préparation de la run</h2>
        <p>Vérifie que tous les jeux sont installés. Tu peux ouvrir Steam pour télécharger ce qui te manque, ou remplacer un jeu qui ne convient pas.</p>
        <div className="review-list">
          {pendingRun.map((id, idx) => {
            const g = POOL.find((x) => x.id === id);
            if (!g) return null;
            const effMode = effectiveMode(g, state.difficulty);
            const modeLabel = effMode === "solo" ? "Solo" : effMode === "duo" ? "Duo" : "Team";
            const modeIconName = effMode === "solo" ? "star" : effMode === "duo" ? "user" : "users";
            const obj = state.difficulty === "hardcore" ? g.hardcore : g.normal;
            return (
              <div className="review-item" key={`${id}-${idx}`}>
                <div className="review-num">{String(idx + 1).padStart(2, "0")}</div>
                <GameCover appid={g.appid} cover={g.cover} name={g.name} size="sm" />
                <div className="review-info">
                  <div className="review-name">{g.name}</div>
                  <div className="review-meta">
                    <span className={`game-tag ${effMode === "solo" ? "solo" : effMode === "duo" ? "duo" : "team"}`}>
                      <Icon name={modeIconName} size={11} /> {modeLabel}
                    </span>
                    <span className="review-objective">{obj}</span>
                  </div>
                </div>
                <a href={steamSearchUrl(g.name)} target="_blank" rel="noopener noreferrer" className="btn btn-steam" title="Ouvrir Steam pour télécharger">
                  Steam
                </a>
                {isHost && (
                  <button className="btn btn-swap" onClick={() => onSwapInPending(id)}>
                    <Icon name="refresh" /> Remplacer
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {humans.length > 0 && (
          <div className="ready-roster">
            <div className="ready-roster-title">
              Prêts : <strong>{readyCount}/{humans.length}</strong>
            </div>
            <div className="ready-chips">
              {humans.map((m) => {
                const isReady = ready.has(m.steamId);
                return (
                  <span key={m.steamId} className={`ready-chip ${isReady ? "ready" : "waiting"}`}>
                    <img src={m.avatarUrl} alt="" />
                    <span className="ready-chip-name">{m.displayName}</span>
                    <span className="ready-chip-status" aria-hidden="true">{isReady ? "✓" : "…"}</span>
                  </span>
                );
              })}
            </div>
          </div>
        )}
        <div className="review-actions">
          {isHost && (
            <button className="btn btn-large btn-reset" onClick={onCancelReview}>Annuler</button>
          )}
          {meIsHuman && (
            <button
              className={`btn btn-large ${meIsReady ? "btn-reset" : "btn-start"}`}
              onClick={onToggleReady}
            >
              {meIsReady ? (<><Icon name="x" /> Pas prêt</>) : (<><Icon name="check" /> Je suis prêt</>)}
            </button>
          )}
          {isHost && (
            <button
              className="btn btn-large btn-start"
              onClick={onLaunchCountdown}
              disabled={!allReady}
              title={allReady ? "Lancer la run" : "En attente que tous les joueurs soient prêts"}
            >
              <Icon name="sparkles" /> Lancer maintenant
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
