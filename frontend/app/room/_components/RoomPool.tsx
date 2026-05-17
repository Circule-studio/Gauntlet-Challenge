import type { Dispatch, SetStateAction } from "react";
import type { Game, GauntletState } from "@/lib/types";
import { effectiveMode, getCategories } from "@/lib/games";
import { CAT_ICONS } from "@/lib/icons";
import { Icon } from "./Icon";
import { GameCover } from "./GameCover";
import { pinCap } from "./utils";

export interface ObjTipState {
  id: number;
  right: number;
  top: number;
  bottom: number;
  flipUp: boolean;
}

export function RoomPool({
  state,
  isHost,
  filteredPool,
  localSearch,
  setLocalSearch,
  localFilter,
  setLocalFilter,
  setConfigStep,
  setObjTip,
  togglePin,
  generateRun,
  rerollRun,
}: {
  state: GauntletState;
  isHost: boolean;
  filteredPool: Game[];
  localSearch: string;
  setLocalSearch: (v: string) => void;
  localFilter: string;
  setLocalFilter: (v: string) => void;
  setConfigStep: (step: "config" | "pool") => void;
  setObjTip: Dispatch<SetStateAction<ObjTipState | null>>;
  togglePin: (id: number) => void;
  generateRun: () => void;
  rerollRun: () => void;
}) {
  const hostOnlyHint = !isHost ? "Seul l'hôte peut modifier ce paramètre" : undefined;

  return (
    <div className="panel">
      <div className="config-step-actions config-step-actions-top">
        <button
          type="button"
          className="btn btn-config-back"
          onClick={() => setConfigStep("config")}
          disabled={!isHost}
          title={hostOnlyHint ?? "Revenir à la configuration"}
        >
          <Icon name="refresh" size={14} /> Modifier la configuration
        </button>
      </div>
      <h2>
        <span className="panel-title"><span className="panel-section-num">2</span> Sélection du pool</span>
        <span className="badge">{state.pinned.length} / {pinCap(state.runLength ?? 10)} épinglés</span>
      </h2>
      <p style={{ color: "var(--muted)", fontSize: 13, marginBottom: 14 }}>
        Clique pour <strong style={{ color: "var(--gold)" }}>épingler jusqu&apos;à 5 jeux</strong> qui seront forcés dans la run. Les autres sont tirés au sort dans le reste du pool.
      </p>
      <div className="pool-controls">
        <input
          type="text"
          className="pool-search"
          placeholder="Chercher un jeu..."
          value={localSearch}
          onChange={(e) => setLocalSearch(e.target.value)}
        />
      </div>
      <div className="filter-pills">
        {getCategories().map((cat) => (
          <button
            key={cat}
            className={`filter-pill ${localFilter === cat ? "active" : ""}`}
            onClick={() => setLocalFilter(cat)}
          >
            {cat === "all" ? "Toutes" : `${CAT_ICONS[cat] ?? ""} ${cat}`}
          </button>
        ))}
      </div>
      <div className="mode-legend">
        <span className="mode-legend-item"><span className="dot solo"></span> Solo Champion</span>
        <span className="mode-legend-item"><span className="dot duo"></span> Duo</span>
        <span className="mode-legend-item"><span className="dot team"></span> Team (3 joueurs)</span>
      </div>
      <div className="pool-grid">
        {filteredPool.map((g) => {
          const effMode = effectiveMode(g, state.difficulty);
          const isPinned = state.pinned.includes(g.id);
          const modeLabelText = effMode === "solo" ? "Solo" : effMode === "duo" ? "Duo" : "Team";
          let modeLabel = modeLabelText;
          if (g.soloHardcore && state.difficulty !== "hardcore") modeLabel += " (HC = Solo)";
          return (
            <div
              key={g.id}
              className={`pool-card ${effMode === "solo" ? "solo" : effMode === "duo" ? "duo" : "team"} ${isPinned ? "pinned" : ""}`}
              onClick={() => togglePin(g.id)}
            >
              <span className="pool-card-pin"><Icon name="pin" size={12} /></span>
              <GameCover appid={g.appid} cover={g.cover} name={g.name} size="sm" />
              <div className="pool-card-info">
                <div className="pool-card-name">{g.name}</div>
                <div className="pool-card-meta">{g.cat}</div>
                <div className="pool-card-mode">
                  {effMode === "solo" ? <Icon name="star" size={11} /> :
                   effMode === "duo" ? <Icon name="user" size={11} /> :
                   <Icon name="users" size={11} />} {modeLabel}
                </div>
              </div>
              <button
                type="button"
                className="pool-card-objectives-btn"
                onClick={(e) => e.stopPropagation()}
                onMouseEnter={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  const flipUp = r.bottom + 120 > window.innerHeight;
                  setObjTip({ id: g.id, right: window.innerWidth - r.right, top: r.bottom, bottom: window.innerHeight - r.top, flipUp });
                }}
                onMouseLeave={() => setObjTip((t) => (t && t.id === g.id ? null : t))}
                onFocus={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  const flipUp = r.bottom + 120 > window.innerHeight;
                  setObjTip({ id: g.id, right: window.innerWidth - r.right, top: r.bottom, bottom: window.innerHeight - r.top, flipUp });
                }}
                onBlur={() => setObjTip((t) => (t && t.id === g.id ? null : t))}
                aria-label="Voir les objectifs"
              >
                <Icon name="info" size={14} />
              </button>
            </div>
          );
        })}
      </div>
      <div className="generate-row">
        <button
          className="btn btn-large btn-start"
          onClick={generateRun}
          disabled={!isHost}
          title={!isHost ? "Seul l'hôte peut générer la run" : undefined}
        >
          {state.run.length > 0
            ? <><Icon name="sparkles" /> Régénérer une nouvelle run</>
            : <><Icon name="sparkles" /> Générer la run ({state.runLength ?? 10} jeux)</>}
        </button>
        <button
          className="btn btn-large btn-reroll"
          onClick={rerollRun}
          disabled={state.run.length === 0 || !isHost}
          title={!isHost ? "Seul l'hôte peut re-roll" : undefined}
        >
          <Icon name="refresh" /> Re-roll les jeux aléatoires
        </button>
      </div>
      {!isHost && (
        <div className="host-only-hint">
          <Icon name="info" size={12} /> Seul l'hôte peut générer ou re-roll la run.
        </div>
      )}
    </div>
  );
}
