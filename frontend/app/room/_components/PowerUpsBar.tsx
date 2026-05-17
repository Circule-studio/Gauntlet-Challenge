import type { GauntletState } from "@/lib/types";
import type { RoomMember } from "@/lib/types/room";
import type { SteamSessionUser } from "@/lib/types/steam";
import { Icon } from "./Icon";

export function PowerUpsBar({
  state,
  members,
  me,
  onUseJoker,
  onUseShield,
  onUseReroll,
}: {
  state: GauntletState;
  members: RoomMember[];
  me: SteamSessionUser | null;
  onUseJoker: (steamId: string) => void;
  onUseShield: (steamId: string) => void;
  onUseReroll: (steamId: string) => void;
}) {
  const disabled = state.powerUpsEnabled === false;
  return (
    <aside className={`room-sidebar${disabled ? " disabled" : ""}`}>
      <div className={`powerups-panel${disabled ? " powerups-panel-disabled" : ""}`}>
        <div className="powerups-title">⚡ Atouts</div>
        {disabled ? (
          <div className="powerups-disabled-msg">
            <span className="powerups-disabled-icon"><Icon name="x" size={14} /></span>
            Désactivés pour cette run
          </div>
        ) : members.length === 0 ? (
          <div className="powerups-empty">En attente de joueurs…</div>
        ) : members.map((member) => {
          const pu = (state.powerUps ?? {})[member.steamId] ?? { joker: 0, shield: 0, reroll: 0 };
          const runActive = state.run.length > 0;
          const currentGameId = state.run[state.current];
          const canReroll = runActive && !!currentGameId && !!state.champions[currentGameId] && !state.done.includes(currentGameId);
          const isMe = me?.steamId === member.steamId;
          return (
            <div className="powerup-card" key={member.steamId}>
              <div className="powerup-player">
                <img src={member.avatarUrl} alt="" className="powerup-avatar" />
                <span className="powerup-name">{member.displayName}</span>
              </div>
              <div className="powerup-buttons">
                <button
                  className={`powerup-btn joker${pu.joker <= 0 ? " used" : ""}`}
                  disabled={!isMe || pu.joker <= 0 || !runActive}
                  onClick={() => onUseJoker(member.steamId)}
                  title={isMe ? "Joker : échange un jeu aléatoire non validé de la run" : "Ce bonus appartient à un autre joueur"}
                >
                  🃏 Joker <span className="powerup-count">×{pu.joker}</span>
                </button>
                <button
                  className={`powerup-btn shield${pu.shield <= 0 || state.shieldActive === true ? " used" : ""}`}
                  disabled={!isMe || pu.shield <= 0 || state.shieldActive === true}
                  onClick={() => onUseShield(member.steamId)}
                  title={isMe ? "Bouclier : annule la prochaine défaite" : "Ce bonus appartient à un autre joueur"}
                >
                  🛡️ Bouclier <span className="powerup-count">×{pu.shield}</span>
                </button>
                <button
                  className={`powerup-btn reroll${pu.reroll <= 0 || !canReroll ? " used" : ""}`}
                  disabled={!isMe || pu.reroll <= 0 || !canReroll}
                  onClick={() => onUseReroll(member.steamId)}
                  title={isMe ? "Relance : retire le champion au sort" : "Ce bonus appartient à un autre joueur"}
                >
                  🎲 Relance <span className="powerup-count">×{pu.reroll}</span>
                </button>
              </div>
            </div>
          );
        })}
        {state.shieldActive && !disabled && (
          <div className="shield-active-badge">🛡️ Bouclier actif !</div>
        )}
      </div>
    </aside>
  );
}
