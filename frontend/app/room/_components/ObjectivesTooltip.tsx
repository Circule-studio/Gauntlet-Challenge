import type { CSSProperties } from "react";
import { POOL } from "@/lib/games";
import type { ObjTipState } from "./RoomPool";

export function ObjectivesTooltip({ objTip }: { objTip: ObjTipState }) {
  const game = POOL.find((x) => x.id === objTip.id);
  if (!game) return null;
  const style: CSSProperties = objTip.flipUp
    ? { bottom: objTip.bottom + 6, right: objTip.right }
    : { top: objTip.top + 6, right: objTip.right };
  return (
    <div className="floating-objectives-tooltip" style={style}>
      <div className="tt-row"><span className="tt-label tt-normal">Normal</span><span className="tt-text">{game.normal}</span></div>
      <div className="tt-row"><span className="tt-label tt-hardcore">Hardcore</span><span className="tt-text">{game.hardcore}</span></div>
    </div>
  );
}
