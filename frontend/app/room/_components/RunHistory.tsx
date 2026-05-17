import type { Game, GauntletState } from "@/lib/types";
import { POOL } from "@/lib/games";
import { Icon } from "./Icon";
import { fmtDate, fmtDuration } from "./utils";

export interface RunStats {
  total: number;
  wins: number;
  successRate: number;
  totalDuration: number;
  avgAttempts: string;
  mostFailedGame: Game | null | undefined;
  mostFailedCount: number;
  topChampion: string;
  topChampionCount: number;
}

export function RunHistory({
  state,
  stats,
  onToggleShowHistory,
}: {
  state: GauntletState;
  stats: RunStats;
  onToggleShowHistory: () => void;
}) {
  return (
    <div className="panel">
      <h2>
        Stats &amp; Historique
        <button
          className="stats-toggle-btn"
          style={{ margin: "0 0 0 auto" }}
          onClick={onToggleShowHistory}
        >
          {state.showHistory
            ? <><Icon name="eyeOff" size={12} /> Masquer l'historique</>
            : <><Icon name="eye" size={12} /> Afficher l'historique</>}
        </button>
      </h2>
      <div className="stats-grid">
        {[
          { value: stats.total, label: "Runs lancées" },
          { value: stats.wins, label: "Runs réussies" },
          { value: stats.successRate + "%", label: "Taux de réussite" },
          { value: stats.avgAttempts, label: "Tentatives moy." },
          { value: fmtDuration(stats.totalDuration), label: "Temps total joué" },
          {
            value: stats.mostFailedGame ? stats.mostFailedGame.name : "—",
            label: `Jeu le + raté${stats.mostFailedCount ? " (×" + stats.mostFailedCount + ")" : ""}`,
          },
          {
            value: stats.topChampion,
            label: `Champion le + tiré${stats.topChampionCount ? " (×" + stats.topChampionCount + ")" : ""}`,
          },
        ].map((s, i) => (
          <div className="stat" key={i}>
            <div className="stat-value">{s.value}</div>
            <div className="stat-label">{s.label}</div>
          </div>
        ))}
      </div>
      {state.showHistory && (
        <div className="history-list">
          {state.history.length === 0 ? (
            <div className="history-empty">Aucune run terminée. Lance une run pour commencer !</div>
          ) : (
            state.history.map((entry) => {
              const failed = entry.failedGameId ? POOL.find((g) => g.id === entry.failedGameId) : null;
              const tag = entry.outcome === "win" ? "🏆" : "💀";
              const status = entry.outcome === "win" ? "GAUNTLET WIN" : "GAUNTLET FAILED";
              return (
                <div
                  key={entry.id}
                  className={`history-item ${entry.outcome === "win" ? "win" : "lose"}`}
                >
                  <div className="history-item-icon">{tag}</div>
                  <div>
                    <strong>{status}</strong>
                    <div className="history-item-meta">
                      {fmtDate(entry.ts)} · {entry.completed || 0}/{entry.total || 10} jeux
                      {failed && (
                        <>
                          {" · raté sur "}<strong>{failed.name}</strong>
                        </>
                      )}
                      {" · "}{entry.difficulty === "hardcore" ? "HC" : "N"}
                    </div>
                  </div>
                  <div className="history-item-meta">
                    <strong>{entry.attempts}</strong> tentatives
                    <br />
                    {fmtDuration(entry.duration)}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
