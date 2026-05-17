export function CountdownOverlay({ countdown }: { countdown: number }) {
  return (
    <div className="overlay show countdown-overlay">
      <div className="countdown-display">
        {countdown > 0 ? countdown : "GO"}
      </div>
    </div>
  );
}
