import type { RoomMember } from "@/lib/types/room";
import { PlayerSlots } from "./PlayerSlots";

// Rendered while a run is in progress (the config panel is hidden). Mirrors
// the configuration panel's player-slot layout so positions stay recognisable.
export function PlayersPanel({
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
  return (
    <div className="panel">
      <h2>
        <span className="panel-title">Joueurs</span>
      </h2>
      <PlayerSlots
        members={members}
        ownerSteamId={ownerSteamId}
        runLocked={runLocked}
        slotCount={slotCount}
        onPromptAddBot={onPromptAddBot}
        onRemoveBot={onRemoveBot}
      />
    </div>
  );
}
