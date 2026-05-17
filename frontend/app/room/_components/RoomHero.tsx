import type { GauntletState } from "@/lib/types";
import type { RoomMember } from "@/lib/types/room";
import { Icon } from "./Icon";
import { fmtDuration } from "./utils";

export function RoomHero({
  state,
  members,
  elapsed,
  isHost,
  runLocked,
  versusScore,
  onAssignTeams,
  onTogglePlayerTeam,
}: {
  state: GauntletState;
  members: RoomMember[];
  elapsed: number;
  isHost: boolean;
  runLocked: boolean;
  versusScore: { red: number; blue: number };
  onAssignTeams: () => void;
  onTogglePlayerTeam: (steamId: string) => void;
}) {
  return (
    <div className="hero">
      <h1>GAUNTLET CHALLENGE</h1>
      <div className="subtitle">{state.run.length || (state.runLength ?? 10)} jeux · 0 défaite autorisée</div>
      <div className="lives">
        <span>#</span><span className="lives-num">{state.attempt}</span>
      </div>
      <div className="hero-meta">
        <span className={`hero-meta-pill ${state.difficulty}`}>
          <span className="dot"></span>
          {state.difficulty === "hardcore" ? "Hardcore" : "Normal"}
        </span>
        <span className="hero-meta-pill">
          <span className="dot"></span>
          {state.penaltyMode === "stepback" ? "Recule d'un jeu" : "Reset complet"}
        </span>
        <span className="hero-meta-pill">
          <span className="dot"></span>
          {members.length || 1} joueur{members.length > 1 ? "s" : ""}
        </span>
        {state.runStartTime && state.run.length > 0 && (
          <span className="hero-meta-pill timer">
            <span className="dot"></span>
            {fmtDuration(elapsed)}
          </span>
        )}
      </div>
      {state.versusMode && (
        <div className="vs-scoreboard" aria-label="Score Versus">
          {isHost && !runLocked && (
            <button
              type="button"
              className="vs-shuffle-btn"
              onClick={onAssignTeams}
              title="Mélanger les équipes au hasard"
              aria-label="Mélanger les équipes au hasard"
            >
              <Icon name="dice" size={14} />
            </button>
          )}
          <div className="vs-team vs-team-red">
            <div className="vs-team-label">Équipe Rouge</div>
            <div className="vs-team-score">{versusScore.red}</div>
            <div className="vs-team-roster">
              {members
                .filter((m) => state.teams[m.steamId] === "red")
                .map((m) => (
                  <span
                    key={m.steamId}
                    className="vs-roster-chip"
                    title={isHost ? "Cliquer pour changer d'équipe" : `${m.displayName} — seul l'hôte peut changer les équipes`}
                    onClick={isHost ? () => onTogglePlayerTeam(m.steamId) : undefined}
                    role={isHost ? "button" : undefined}
                  >
                    <img src={m.avatarUrl} alt="" />
                    <span>{m.displayName}</span>
                  </span>
                ))}
            </div>
          </div>
          <div className="vs-separator">VS</div>
          <div className="vs-team vs-team-blue">
            <div className="vs-team-label">Équipe Bleue</div>
            <div className="vs-team-score">{versusScore.blue}</div>
            <div className="vs-team-roster">
              {members
                .filter((m) => state.teams[m.steamId] === "blue")
                .map((m) => (
                  <span
                    key={m.steamId}
                    className="vs-roster-chip"
                    title={isHost ? "Cliquer pour changer d'équipe" : `${m.displayName} — seul l'hôte peut changer les équipes`}
                    onClick={isHost ? () => onTogglePlayerTeam(m.steamId) : undefined}
                    role={isHost ? "button" : undefined}
                  >
                    <img src={m.avatarUrl} alt="" />
                    <span>{m.displayName}</span>
                  </span>
                ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
