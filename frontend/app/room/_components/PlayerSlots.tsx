import type { RoomMember } from "@/lib/types/room";
import { isBotId, isSyntheticId } from "@/lib/types/steam";
import { Icon } from "./Icon";

// Player roster grid — used by both the configuration panel and the in-run
// "Joueurs" panel. The layout (slot count + placeholders + bot adder) is
// shared; the only behavioural difference between the two call sites is
// whether the run is locked, which gates the bot controls.
export function PlayerSlots({
  members,
  ownerSteamId,
  runLocked,
  slotCount,
  onPromptAddBot,
  onRemoveBot,
}: {
  members: RoomMember[];
  ownerSteamId: string | null;
  runLocked: boolean;
  slotCount: number;
  onPromptAddBot: () => void;
  onRemoveBot: (botSteamId: string) => void;
}) {
  const playerSlots = Array.from({ length: slotCount }, (_, i) => i);
  return (
    <div className="setup-grid">
      {playerSlots.map((i) => {
        const member = members[i];
        return (
          <div className="field" key={i}>
            <label>Joueur {i + 1}</label>
            {member ? (
              <div className={`steam-link linked${isBotId(member.steamId) ? " bot" : ""}`}>
                <img src={member.avatarUrl} alt="" className="steam-link-avatar" />
                {isSyntheticId(member.steamId) ? (
                  <span className="steam-link-name" title={isBotId(member.steamId) ? "Bot local" : "Joueur invité"}>{member.displayName}</span>
                ) : (
                  <a className="steam-link-name" href={member.profileUrl} target="_blank" rel="noreferrer">{member.displayName}</a>
                )}
                {!!ownerSteamId && member.steamId === ownerSteamId && (
                  <span className="steam-link-host" title="Hôte de la room" aria-label="Hôte de la room">
                    <Icon name="crown" size={14} />
                  </span>
                )}
                {isBotId(member.steamId) && (
                  <span className="steam-link-badge" title="Bot local">
                    <Icon name="bot" size={12} />
                    BOT
                  </span>
                )}
                {member.twitch && (
                  <span
                    className="steam-link-twitch"
                    title={`Twitch connecté : ${member.twitch.displayName}`}
                    aria-label={`Twitch connecté : ${member.twitch.displayName}`}
                  >
                    <Icon name="twitch" size={14} />
                  </span>
                )}
                {!isSyntheticId(member.steamId) && (
                  <a
                    className="steam-link-stats"
                    href={`/u?id=${member.steamId}`}
                    target="_blank"
                    rel="noreferrer"
                    title="Voir les stats du joueur"
                    aria-label="Voir les stats du joueur"
                  >
                    <Icon name="barChart" size={14} />
                  </a>
                )}
                {isBotId(member.steamId) && !runLocked && (
                  <button
                    type="button"
                    className="steam-link-stats"
                    onClick={() => onRemoveBot(member.steamId)}
                    title="Retirer ce bot"
                    aria-label="Retirer ce bot"
                  >
                    <Icon name="x" size={14} />
                  </button>
                )}
              </div>
            ) : (
              <div className="steam-link empty">
                <span className="steam-link-name">En attente…</span>
                {!runLocked && (
                  <button
                    type="button"
                    className="steam-link-add-bot"
                    onClick={onPromptAddBot}
                    title="Ajouter un bot pour ce slot"
                  >
                    <Icon name="plus" size={11} /> Bot
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
