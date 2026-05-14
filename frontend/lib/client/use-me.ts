"use client";

import { useEffect, useState } from "react";
import type { SteamSessionUser } from "@/lib/types/steam";

export function useMe(): SteamSessionUser | null {
  const { user } = useMeStatus();
  return user;
}

/**
 * Tri-state auth helper:
 *   loading=true              → /api/me hasn't responded yet
 *   loading=false, user=null  → not authenticated
 *   loading=false, user=set   → authenticated
 *
 * Use this when you need to distinguish "still loading" from "no session" —
 * e.g. to redirect anonymous visitors to /login without flickering for
 * authenticated users while the fetch is in flight.
 */
export function useMeStatus(): { user: SteamSessionUser | null; loading: boolean } {
  const [user, setUser] = useState<SteamSessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data && typeof data === "object" && "steamId" in data) {
          setUser(data as SteamSessionUser);
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);
  return { user, loading };
}
