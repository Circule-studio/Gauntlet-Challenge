import React from "react";
import type { Game, GauntletState } from "@/lib/types";
import type { RoomMember } from "@/lib/types/room";
import type { SteamSessionUser } from "@/lib/types/steam";
import { isSyntheticId } from "@/lib/types/steam";
import { effectiveMode } from "@/lib/games";
import { CAT_ICONS } from "@/lib/icons";
import { POOL } from "@/lib/games";
import { Icon } from "./Icon";
import { GameCover } from "./GameCover";
import { ChampionName } from "./ChampionName";
import { AchievementCheck } from "./AchievementCheck";

export function RoomRun({
  state,
  members,
  me,
  now,
  swappedIdx,
  nameToAvatar,
  timerInputMin,
  setTimerInputMin,
  swapGame,
  drawChampion,
  winGame,
  loseGame,
  winVersusGame,
  startTimer,
  resetTimer,
  toggleOwnershipOverride,
}: {
  state: GauntletState;
  members: RoomMember[];
  me: SteamSessionUser | null;
  now: number;
  swappedIdx: number | null;
  nameToAvatar: Record<string, string>;
  timerInputMin: number;
  setTimerInputMin: React.Dispatch<React.SetStateAction<number>>;
  swapGame: (gameId: number) => void;
  drawChampion: (gameId: number, mode: "solo" | "duo") => void;
  winGame: (gameId: number) => void;
  loseGame: (gameId: number) => void;
  winVersusGame: (gameId: number, team: "red" | "blue") => void;
  startTimer: (minutes: number) => void;
  resetTimer: () => void;
  toggleOwnershipOverride: (appid: number) => void;
}) {
  const totalSegs = state.run.length || 10;

  return (
    <div className="panel" id="runPanel">
      <h2>
        <span className="panel-title"><span className="panel-section-num">3</span> Run en cours</span>
        {state.run.length > 0 && (
          <span className="badge">
            {state.done.length}/{state.run.length}
          </span>
        )}
      </h2>
      <div className="progress-wrap">
        <div className="progress-info">
          <span>{state.difficulty === "hardcore" ? "Mode Hardcore" : "Mode Normal"}</span>
          <span>{state.done.length} / {totalSegs}</span>
        </div>
        <div className={`seg-progress ${state.difficulty === "hardcore" ? "hardcore" : ""}`}>
          {Array.from({ length: totalSegs }).map((_, i) => {
            let cls = "seg";
            if (i < state.done.length) cls += " done";
            else if (i === state.current && state.run.length > 0) cls += " current";
            return <div key={i} className={cls}></div>;
          })}
        </div>
      </div>

      {state.run.length === 0 ? (
        <div className="empty-run">
          <h3>Aucune run générée</h3>
          <p>
            Épingle 0 à 5 jeux ci-dessus puis clique sur <strong>Générer la run</strong>.
          </p>
        </div>
      ) : (
        <div className="games" id="gamesList">
          {state.run.map((gameId, idx) => {
            const g = POOL.find((x) => x.id === gameId) as Game | undefined;
            if (!g) return null;
            const isDone = state.done.includes(gameId);
            const isCurrent = idx === state.current && !isDone;
            const isLocked = idx > state.current && !isDone;
            const effMode = effectiveMode(g, state.difficulty);
            const isSolo = effMode === "solo" || effMode === "duo";
            const isPinned = state.pinned.includes(gameId);
            const objective = state.difficulty === "hardcore" ? g.hardcore : g.normal;
            const champion = state.champions[gameId];
            const isDrawing = state.drawing?.gameId === gameId;

            const classes = [
              "game",
              "tiltable",
              isLocked ? "locked" : "",
              isCurrent ? "current" : "",
              isDone ? "done" : "",
              isPinned ? "pinned-run" : "",
              swappedIdx === idx ? "swapped" : "",
            ]
              .filter(Boolean)
              .join(" ");

            const modeTagClass = effMode === "solo" ? "solo" : effMode === "duo" ? "duo" : "team";
            const modeIcon = effMode === "solo" ? "star" : effMode === "duo" ? "user" : "users";
            const modeTagText = g.cat;

            return (
              <div key={`${gameId}-${idx}`} className={classes}>
                <div className="game-num">{String(idx + 1).padStart(2, "0")}</div>
                <GameCover appid={g.appid} cover={g.cover} name={g.name} size="md" />
                <div className="game-info">
                  <div className="game-title-row">
                    <div className="game-title">
                      {CAT_ICONS[g.cat] ?? ""} {g.name}
                    </div>
                    <div className={`game-tag ${modeTagClass}`}><Icon name={modeIcon} size={11} /> {modeTagText}</div>
                    {isPinned && <div className="game-tag pinned-tag"><Icon name="pin" size={11} /> Épinglé</div>}
                  </div>
                  <div className={`game-objective ${state.difficulty === "hardcore" ? "hc" : ""}`}>
                    Objectif : <strong>{objective}</strong>
                  </div>
                  {g.achievement && g.appid && isCurrent && !isDone && (
                    <AchievementCheck
                      gameId={gameId}
                      appid={g.appid}
                      apiname={g.achievement.apiname}
                      label={g.achievement.label}
                      onUnlocked={() => (state.versusMode ? null : winGame(gameId))}
                    />
                  )}
                  {g.appid && members.some((m) => !isSyntheticId(m.steamId)) && (
                    <div className="game-owners" aria-label="Possession Steam">
                      {members.filter((m) => !isSyntheticId(m.steamId)).map((m) => {
                        const key = String(g.appid);
                        const auto = state.ownership?.[m.steamId]?.[key];
                        const override = state.ownershipOverride?.[m.steamId]?.[key];
                        const owned = override !== undefined ? override : auto;
                        const status = owned === true ? "owns" : owned === false ? "missing" : "unknown";
                        const isMe = me?.steamId === m.steamId;
                        const isOverride = override !== undefined;
                        const baseTip =
                          status === "owns" ? `${m.displayName} possède ${g.name}` :
                          status === "missing" ? `${m.displayName} n'a pas ${g.name} sur Steam` :
                          `${m.displayName} : possession inconnue (profil privé ?)`;
                        const tip =
                          isMe ? `${baseTip} — clique pour ${owned === true ? "indiquer que tu ne l'as pas" : "indiquer que tu l'as"}` :
                          isOverride ? `${baseTip} (déclaration manuelle)` :
                          baseTip;
                        return (
                          <span
                            key={m.steamId}
                            className={`owner-chip ${status}${isMe ? " clickable" : ""}${isOverride ? " override" : ""}`}
                            title={tip}
                            onClick={isMe && g.appid ? () => toggleOwnershipOverride(g.appid as number) : undefined}
                            role={isMe ? "button" : undefined}
                            tabIndex={isMe ? 0 : undefined}
                            onKeyDown={isMe && g.appid ? (e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                toggleOwnershipOverride(g.appid as number);
                              }
                            } : undefined}
                          >
                            <img src={m.avatarUrl} alt="" />
                            <span className="owner-mark">{status === "owns" ? "✓" : status === "missing" ? "✗" : "?"}</span>
                          </span>
                        );
                      })}
                    </div>
                  )}
                  {isSolo && (
                    <div className="game-champion">
                      {isDrawing && state.drawing ? (() => {
                        const drawing = state.drawing;
                        // Each reel finishes its rAF after `1200 + r * 400` ms; once every reel
                        // has finished, the whole machine snaps to "locked" styling.
                        const allLocked = drawing.reels.every((_, r) => (now - drawing.startedAt) >= (1200 + r * 400));
                        return (
                          <>
                            Tirage en cours…
                            <div className={`slot-machine ${allLocked ? "locked" : ""}`}>
                              {drawing.reels.map((cells, r) => {
                                // For duo draws (pairSize=2), drop a separator between consecutive
                                // pairs: "&" within a pair, "·" between independent pairs.
                                const inPair = drawing.pairSize > 1 && r > 0 && r % drawing.pairSize !== 0;
                                const betweenPairs = drawing.pairSize > 1 && r > 0 && r % drawing.pairSize === 0;
                                return (
                                  <React.Fragment key={r}>
                                    {inPair && <div className="slot-sep slot-sep-and" aria-hidden="true">&amp;</div>}
                                    {betweenPairs && <div className="slot-sep slot-sep-pair" aria-hidden="true">·</div>}
                                    <div className="slot-reel">
                                      <div className="slot-strip" id={`strip${r}`}>
                                        {cells.map((c, ci) => {
                                          const av = nameToAvatar[c];
                                          return (
                                            <div className="slot-cell" key={ci}>
                                              {av && <img className="slot-avatar" src={av} alt="" />}
                                              <span className="slot-name">{c}</span>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  </React.Fragment>
                                );
                              })}
                            </div>
                          </>
                        );
                      })() : champion ? (
                        effMode === "duo" ? (
                          <>{champion.includes(" · ") ? "Duos désignés" : "Duo désigné"} : <ChampionName text={champion} nameToAvatar={nameToAvatar} /></>
                        ) : (
                          <>Champion désigné : <ChampionName text={champion} nameToAvatar={nameToAvatar} /></>
                        )
                      ) : effMode === "duo" ? (
                        <>Aucun duo tiré — <em>Tirage au sort requis</em></>
                      ) : (
                        <>Aucun champion tiré — <em>Tirage au sort requis</em></>
                      )}
                    </div>
                  )}
                  {isCurrent && g.timer && (
                    (() => {
                      // `?? null` normalises any pre-feature room state where the field is
                      // undefined — keeps the active/inactive check simple.
                      const deadline = state.timerDeadline ?? null;
                      const remainingMs = deadline !== null ? Math.max(0, deadline - now) : 0;
                      const expired = deadline !== null && remainingMs === 0;
                      const totalSec = Math.floor(remainingMs / 1000);
                      const mm = String(Math.floor(totalSec / 60)).padStart(2, "0");
                      const ss = String(totalSec % 60).padStart(2, "0");
                      return (
                        <div className={`game-timer ${expired ? "expired" : ""} ${deadline !== null ? "running" : ""}`}>
                          <span className="game-timer-icon" aria-hidden="true"><Icon name="clock" size={14} /></span>
                          {deadline === null ? (
                            <>
                              <span className="game-timer-label">Minuteur</span>
                              <div className="game-timer-stepper">
                                <button
                                  type="button"
                                  className="game-timer-step"
                                  onClick={() => setTimerInputMin((m) => Math.max(1, m - 1))}
                                  aria-label="Diminuer la durée"
                                >−</button>
                                <input
                                  type="number"
                                  className="game-timer-input"
                                  min={1}
                                  max={120}
                                  value={timerInputMin}
                                  onChange={(e) => setTimerInputMin(Number(e.target.value))}
                                  aria-label="Durée en minutes"
                                />
                                <button
                                  type="button"
                                  className="game-timer-step"
                                  onClick={() => setTimerInputMin((m) => Math.min(120, m + 1))}
                                  aria-label="Augmenter la durée"
                                >+</button>
                              </div>
                              <span className="game-timer-unit">min</span>
                              <button className="btn btn-timer" onClick={() => startTimer(timerInputMin)}>
                                Démarrer
                              </button>
                            </>
                          ) : (
                            <>
                              <span className="game-timer-label">{expired ? "Temps écoulé" : "Temps restant"}</span>
                              <span className="game-timer-clock">{mm}:{ss}</span>
                              <button className="btn btn-timer-reset" onClick={resetTimer}>
                                Reset
                              </button>
                            </>
                          )}
                        </div>
                      );
                    })()
                  )}
                </div>
                <div className="game-actions">
                  {isDone ? (
                    <div className="check"></div>
                  ) : (
                    <>
                      <button
                        className="btn btn-swap"
                        onClick={() => swapGame(gameId)}
                        title="On n'a pas ce jeu / on veut le remplacer"
                      >
                        Swap
                      </button>
                      {isSolo && (
                        <button
                          className="btn btn-draw"
                          disabled={!isCurrent}
                          onClick={() => drawChampion(gameId, effMode as "solo" | "duo")}
                        >
                          Tirer
                        </button>
                      )}
                      {state.versusMode ? (
                        <>
                          <button
                            className="btn btn-win btn-vs-red"
                            disabled={!isCurrent}
                            onClick={() => winVersusGame(gameId, "red")}
                            title="Équipe Rouge gagne ce jeu"
                          >
                            Rouge gagne
                          </button>
                          <button
                            className="btn btn-win btn-vs-blue"
                            disabled={!isCurrent}
                            onClick={() => winVersusGame(gameId, "blue")}
                            title="Équipe Bleue gagne ce jeu"
                          >
                            Bleue gagne
                          </button>
                        </>
                      ) : (
                        <>
                          <button className="btn btn-win" disabled={!isCurrent} onClick={() => winGame(gameId)}>
                            Validé
                          </button>
                          <button className="btn btn-lose" disabled={!isCurrent} onClick={() => loseGame(gameId)}>
                            Échoué
                          </button>
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
