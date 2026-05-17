"use client";

import { useEffect, useRef, useState } from "react";

// Polls Steam every 30s while mounted. The "Vérifier" button forces an
// immediate refresh. When the achievement flips to unlocked, we fire
// onUnlocked() once (firedRef stops re-fires across re-renders).
export function AchievementCheck({
  gameId,
  appid,
  apiname,
  label,
  onUnlocked,
}: {
  gameId: number;
  appid: number;
  apiname: string;
  label?: string;
  onUnlocked: () => void;
}) {
  const [status, setStatus] = useState<"idle" | "checking" | "unlocked" | "locked" | "private">("idle");
  const firedRef = useRef(false);

  const check = async (silent = false) => {
    if (!silent) setStatus("checking");
    try {
      const r = await fetch(`/api/steam/achievement/${appid}/${encodeURIComponent(apiname)}`, { credentials: "include" });
      if (r.status === 403) { setStatus("private"); return; }
      if (!r.ok) { if (!silent) setStatus("idle"); return; }
      const data = await r.json() as { unlocked: boolean; known: boolean };
      if (data.unlocked) {
        setStatus("unlocked");
        if (!firedRef.current) {
          firedRef.current = true;
          onUnlocked();
        }
      } else {
        setStatus(data.known ? "locked" : "private");
      }
    } catch {
      if (!silent) setStatus("idle");
    }
  };

  useEffect(() => {
    void check(true);
    const id = setInterval(() => void check(true), 30_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, appid, apiname]);

  return (
    <div className={`achievement-check status-${status}`}>
      <span className="achievement-label">
        🏆 Succès Steam : <strong>{label ?? apiname}</strong>
      </span>
      <button
        type="button"
        className="btn btn-achievement"
        onClick={() => void check(false)}
        disabled={status === "checking"}
      >
        {status === "checking" ? "…" :
         status === "unlocked" ? "Débloqué ✓" :
         status === "private" ? "Profil privé" :
         status === "locked" ? "Vérifier à nouveau" :
         "Vérifier"}
      </button>
    </div>
  );
}
