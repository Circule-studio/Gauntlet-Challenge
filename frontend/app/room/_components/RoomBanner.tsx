import type { RoomMember } from "@/lib/types/room";
import { Icon } from "./Icon";

export function RoomBanner({
  roomCode,
  members,
  ownerSteamId,
  connected,
  onCopyLink,
  onShowOverlays,
  onLeave,
}: {
  roomCode: string;
  members: RoomMember[];
  ownerSteamId: string | null;
  connected: boolean;
  onCopyLink: () => void;
  onShowOverlays: () => void;
  onLeave: () => void;
}) {
  const hostMember = ownerSteamId ? members.find((m) => m.steamId === ownerSteamId) : null;
  return (
    <div className="room-banner">
      <div className="room-banner-info">
        <span className="room-banner-label">Room</span>
        <span className="room-banner-code">{roomCode}</span>
        <span className="room-banner-members">{members.length} joueur{members.length > 1 ? "s" : ""}</span>
        {hostMember && (
          <span className="room-banner-host" title={`Hôte de la room : ${hostMember.displayName}`}>
            <span className="room-banner-host-crown" aria-hidden="true"><Icon name="crown" size={12} /></span>
            <img src={hostMember.avatarUrl} alt="" className="room-banner-host-avatar" />
            <span className="room-banner-host-name">{hostMember.displayName}</span>
          </span>
        )}
        <span
          className={`room-sync-status ${connected ? "ok" : "lost"}`}
          title={connected ? "Sync en temps réel active" : "Connexion perdue — les actions ne se synchronisent pas"}
        >
          <span className="room-sync-dot"></span>
          {connected ? "Sync" : "Hors-ligne"}
        </span>
      </div>
      <div className="room-banner-actions">
        <button className="room-banner-btn" onClick={onCopyLink} title="Copier le lien d'invitation">Inviter</button>
        <button className="room-banner-btn" onClick={onShowOverlays} title="Liens des overlays Twitch (OBS)">Overlays</button>
        <button className="room-banner-btn room-banner-leave" onClick={onLeave}>Quitter</button>
      </div>
    </div>
  );
}
