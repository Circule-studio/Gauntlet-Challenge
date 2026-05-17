export type OverlayState = { kind: "win" | "lose" | null; msg?: string };

export function WinLoseOverlay({
  overlay,
  onCloseWin,
  onCloseLose,
}: {
  overlay: OverlayState;
  onCloseWin: () => void;
  onCloseLose: () => void;
}) {
  if (overlay.kind === "win") {
    return (
      <div className="overlay win">
        <div className="overlay-content">
          <h2>GAUNTLET COMPLETED</h2>
          <p>Vous avez vaincu les 10 épreuves sans une seule défaite. Le panthéon vous attend.</p>
          <button
            className="btn btn-large btn-win"
            onClick={onCloseWin}
          >
            Recommencer une run
          </button>
        </div>
      </div>
    );
  }
  if (overlay.kind === "lose") {
    return (
      <div className="overlay lose">
        <div className="overlay-content">
          <h2>GAUNTLET FAILED</h2>
          <p>{overlay.msg}</p>
          <button className="btn btn-large btn-lose" onClick={onCloseLose}>
            Repartir au combat
          </button>
        </div>
      </div>
    );
  }
  return null;
}
