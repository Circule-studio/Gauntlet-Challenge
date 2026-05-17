export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function fmtDuration(ms: number): string {
  if (!ms || ms < 0) return "—";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h${(m % 60).toString().padStart(2, "0")}`;
  if (m > 0) return `${m}m${(s % 60).toString().padStart(2, "0")}s`;
  return `${s}s`;
}

export function fmtDate(ts: number): string {
  const d = new Date(ts);
  return (
    d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }) +
    " " +
    d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
  );
}

export function formatChampion(picks: string[], pairSize: number): string {
  if (picks.length === 0) return "";
  if (pairSize <= 1) return picks.join(" & ");
  const pairs: string[] = [];
  for (let i = 0; i < picks.length; i += pairSize) {
    pairs.push(picks.slice(i, i + pairSize).join(" & "));
  }
  return pairs.join(" · ");
}

export const COUNTDOWN_MS = 3000;
export const MAX_MEMBERS = 8;

export function pinCap(rl: number): number {
  return Math.max(1, Math.floor(rl / 2));
}
