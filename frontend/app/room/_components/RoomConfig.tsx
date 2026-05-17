import type { Difficulty, GauntletState, PenaltyMode } from "@/lib/types";
import type { RoomMember } from "@/lib/types/room";
import { Icon } from "./Icon";
import { PlayerSlots } from "./PlayerSlots";

export function RoomConfig({
  state,
  members,
  ownerSteamId,
  isHost,
  runLocked,
  slotCount,
  configStep,
  setConfigStep,
  update,
  onPromptAddBot,
  onRemoveBot,
  onAssignTeams,
}: {
  state: GauntletState;
  members: RoomMember[];
  ownerSteamId: string | null;
  isHost: boolean;
  runLocked: boolean;
  slotCount: number;
  configStep: "config" | "pool";
  setConfigStep: (step: "config" | "pool") => void;
  update: (patch: Partial<GauntletState>) => void;
  onPromptAddBot: () => void;
  onRemoveBot: (botSteamId: string) => void;
  onAssignTeams: () => void;
}) {
  const hostOnlyHint = !isHost ? "Seul l'hôte peut modifier ce paramètre" : undefined;
  const HostOnlyBadge = !isHost ? (
    <span className="host-only-badge" title={hostOnlyHint} aria-label={hostOnlyHint}>
      <Icon name="lock" size={11} />
    </span>
  ) : null;

  return (
    <>
      <div className="config-stepper" role="tablist" aria-label="Étapes de configuration">
        <button
          type="button"
          role="tab"
          aria-selected={configStep === "config"}
          className={`config-step ${configStep === "config" ? "active" : "done"}`}
          onClick={() => setConfigStep("config")}
          disabled={!isHost}
          title={hostOnlyHint}
        >
          <span className="config-step-num">1</span>
          <span className="config-step-label">Configuration</span>
        </button>
        <span className="config-stepper-sep" aria-hidden="true" />
        <button
          type="button"
          role="tab"
          aria-selected={configStep === "pool"}
          className={`config-step ${configStep === "pool" ? "active" : ""}`}
          onClick={() => setConfigStep("pool")}
          disabled={!isHost}
          title={hostOnlyHint}
        >
          <span className="config-step-num">2</span>
          <span className="config-step-label">Sélection du pool</span>
        </button>
      </div>

      {configStep === "config" && (
        <div className="panel">
          <h2>
            <span className="panel-title"><span className="panel-section-num">1</span> Configuration</span>
          </h2>
          <PlayerSlots
            members={members}
            ownerSteamId={ownerSteamId}
            runLocked={runLocked}
            slotCount={slotCount}
            onPromptAddBot={onPromptAddBot}
            onRemoveBot={onRemoveBot}
          />

          <div className="field" style={{ marginTop: 18 }}>
            <label>Difficulté{HostOnlyBadge}</label>
            <div className="toggle-group" title={hostOnlyHint}>
              <button
                className={`toggle ${state.difficulty === "normal" ? "active" : ""}`}
                onClick={() => update({ difficulty: "normal" as Difficulty })}
                disabled={runLocked || !isHost}
                title={hostOnlyHint ?? "Objectifs accessibles — souvent finir, atteindre un palier ou un Top X"}
              >
                Normal
              </button>
              <button
                className={`toggle hardcore ${state.difficulty === "hardcore" ? "active" : ""}`}
                onClick={() => update({ difficulty: "hardcore" as Difficulty })}
                disabled={runLocked || !isHost}
                title={hostOnlyHint ?? "Objectifs exigeants — gagner, enchaîner plusieurs victoires, ou jouer en mode hard"}
              >
                Hardcore
              </button>
            </div>
            <p className="field-hint">
              <strong>Normal</strong> : objectifs <strong>accessibles</strong> (atteindre un Top, finir un niveau, un round gagné). <strong>Hardcore</strong> : objectifs <strong>exigeants</strong> (gagner, enchaîner plusieurs victoires d'affilée, ou jouer en mode hard).
            </p>
          </div>

          <div className="field" style={{ marginTop: 18 }}>
            <label>Pénalité en cas de défaite{HostOnlyBadge}</label>
            <div className="toggle-group" title={hostOnlyHint}>
              <button
                className={`toggle ${state.penaltyMode === "reset" ? "active" : ""}`}
                onClick={() => update({ penaltyMode: "reset" as PenaltyMode })}
                disabled={runLocked || !isHost}
                title={hostOnlyHint}
              >
                Reset complet (retour jeu 1)
              </button>
              <button
                className={`toggle ${state.penaltyMode === "stepback" ? "active" : ""}`}
                onClick={() => update({ penaltyMode: "stepback" as PenaltyMode })}
                disabled={runLocked || !isHost}
                title={hostOnlyHint}
              >
                Recule d&apos;un jeu
              </button>
            </div>
          </div>

          <div className="field" style={{ marginTop: 18 }}>
            <label>Atouts (Joker, Bouclier, Relance){HostOnlyBadge}</label>
            <div className="toggle-group" title={hostOnlyHint}>
              <button
                className={`toggle ${state.powerUpsEnabled !== false ? "active" : ""}`}
                onClick={() => update({ powerUpsEnabled: true })}
                disabled={runLocked || !isHost}
                title={hostOnlyHint}
              >
                Activés
              </button>
              <button
                className={`toggle ${state.powerUpsEnabled === false ? "active" : ""}`}
                onClick={() => update({ powerUpsEnabled: false })}
                disabled={runLocked || !isHost}
                title={hostOnlyHint}
              >
                Désactivés
              </button>
            </div>
          </div>

          <div className="field" style={{ marginTop: 18 }}>
            <label>
              Longueur de la run
              {HostOnlyBadge}
              <span className="run-length-value">{state.runLength ?? 10} jeux</span>
            </label>
            {(() => {
              // Fully custom slider visuals: the native <input type=range> is invisible
              // and only handles input. The visible track, fill, thumb, and ticks all use
              // the SAME `pct` percentage, so alignment is guaranteed regardless of
              // browser-specific thumb positioning quirks.
              const value = state.runLength ?? 10;
              const pct = ((value - 1) / 9) * 100;
              return (
                <div className="run-length-slider-wrap" title={hostOnlyHint}>
                  <div className="run-length-rail">
                    <div className="run-length-rail-track">
                      <div className="run-length-rail-fill" style={{ width: `${pct}%` }} />
                    </div>
                    <div
                      className={`run-length-rail-thumb${runLocked || !isHost ? " disabled" : ""}`}
                      style={{ left: `${pct}%` }}
                      aria-hidden="true"
                    />
                    <input
                      type="range"
                      className="run-length-slider"
                      min={1}
                      max={10}
                      step={1}
                      value={value}
                      onChange={(e) => update({ runLength: Math.max(1, Math.min(10, Number(e.target.value))) })}
                      disabled={runLocked || !isHost}
                      aria-label="Longueur de la run"
                      title={hostOnlyHint}
                    />
                  </div>
                  <div className="run-length-ticks" aria-hidden="true">
                    {Array.from({ length: 10 }, (_, i) => (
                      <span
                        key={i}
                        className={`run-length-tick ${i + 1 <= value ? "on" : ""}`}
                        style={{ left: `${(i / 9) * 100}%` }}
                      >
                        {i + 1}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>

          <div className="field" style={{ marginTop: 18 }}>
            <label>Bibliothèque Steam uniquement{HostOnlyBadge}</label>
            <div className="toggle-group" title={hostOnlyHint}>
              <button
                className={`toggle ${!state.libraryOnlyMode ? "active" : ""}`}
                onClick={() => update({ libraryOnlyMode: false })}
                disabled={runLocked || !isHost}
                title={hostOnlyHint}
              >
                Tout le pool
              </button>
              <button
                className={`toggle ${state.libraryOnlyMode ? "active" : ""}`}
                onClick={() => update({ libraryOnlyMode: true })}
                disabled={runLocked || !isHost}
                title={hostOnlyHint ?? "Ne tirer que des jeux qu'au moins un joueur a dans sa bibliothèque Steam"}
              >
                Bibliothèque commune
              </button>
            </div>
            <p className="field-hint">
              Quand activé, seuls les jeux Steam qu'<strong>au moins un membre</strong> possède sont tirés au sort.
            </p>
          </div>

          <div className="field" style={{ marginTop: 18 }}>
            <label>Mode de tirage{HostOnlyBadge}</label>
            <div className="toggle-group" title={hostOnlyHint}>
              <button
                className={`toggle ${!state.leastPlayedMode ? "active" : ""}`}
                onClick={() => update({ leastPlayedMode: false })}
                disabled={runLocked || !isHost}
                title={hostOnlyHint}
              >
                Aléatoire
              </button>
              <button
                className={`toggle ${state.leastPlayedMode ? "active" : ""}`}
                onClick={() => update({ leastPlayedMode: true })}
                disabled={runLocked || !isHost}
                title={hostOnlyHint ?? "Force les jeux que vous avez le moins joués dans vos précédentes runs"}
              >
                Moins joués
              </button>
            </div>
            <p className="field-hint">
              Force les jeux que les membres ont <strong>le moins joués</strong> dans leur historique.
            </p>
          </div>

          <div className="field" style={{ marginTop: 18 }}>
            <label>Mode VS (versus){HostOnlyBadge}</label>
            <div className="toggle-group" title={hostOnlyHint}>
              <button
                className={`toggle ${!state.versusMode ? "active" : ""}`}
                onClick={() => update({ versusMode: false, teams: {}, gameWinners: {} })}
                disabled={runLocked || !isHost}
                title={hostOnlyHint}
              >
                Coopératif
              </button>
              <button
                className={`toggle vs-toggle ${state.versusMode ? "active" : ""}`}
                onClick={onAssignTeams}
                disabled={runLocked || !isHost}
                title={hostOnlyHint ?? "Deux équipes s'affrontent — Rouge vs Bleue"}
              >
                Rouge vs Bleue
              </button>
            </div>
            {state.versusMode && (
              <>
                <button
                  type="button"
                  className="btn btn-team-shuffle"
                  onClick={onAssignTeams}
                  disabled={runLocked || !isHost}
                  title={hostOnlyHint ?? "Re-tirer les équipes au hasard"}
                >
                  <Icon name="dice" size={14} /> Mélanger les équipes
                </button>
                <p className="field-hint">
                  Chaque jeu est gagné par <strong>une seule équipe</strong>. À la fin, l'équipe avec le plus de victoires l'emporte.
                </p>
              </>
            )}
          </div>
          <div className="config-step-actions">
            <button
              type="button"
              className="btn btn-large btn-start btn-config-next"
              onClick={() => setConfigStep("pool")}
              disabled={!isHost}
              title={hostOnlyHint}
            >
              <Icon name="check" size={16} /> Valider la configuration
            </button>
          </div>
        </div>
      )}
    </>
  );
}
