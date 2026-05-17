"use client";

import { useState } from "react";

// Steam library art or a custom URL. Falls back to a two-letter chip when the
// CDN image is missing or fails to load. Tracks the failed URL so a later
// `src` change (e.g. an appid is added to the entry) auto-recovers without an
// extra useEffect.
export function GameCover({
  appid,
  cover,
  name,
  size = "md",
}: {
  appid?: number;
  cover?: string;
  name: string;
  size?: "sm" | "md" | "lg";
}) {
  const src = cover ?? (appid ? `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/library_600x900.jpg` : null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = src !== null && failedSrc === src;

  if (!src || failed) {
    return (
      <div className={`game-cover game-cover-${size} game-cover-fallback`}>
        <span>{name.slice(0, 2).toUpperCase()}</span>
      </div>
    );
  }
  return (
    <div className={`game-cover game-cover-${size}`}>
      <img
        src={src}
        alt={name}
        loading="lazy"
        onError={() => setFailedSrc(src)}
      />
    </div>
  );
}
