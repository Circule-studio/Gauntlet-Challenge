// /api/games — read & write the pool of games. Editing is gated to a
// hardcoded Steam-ID allowlist; every other auth state can read.
//
// PUT writes back to the source-controlled `frontend/lib/games.ts`. The static
// frontend bundle still ships the version compiled at build time, so the
// running app only picks up edits after `next build` re-runs in frontend/.

import { promises as fs } from "fs";
import path from "path";
import { Router } from "express";
import { requireAuth } from "../middleware/auth";

const router = Router();

const GAMES_TS_PATH = path.resolve(process.cwd(), "../frontend/lib/games.ts");

// Steam IDs allowed to edit the pool. Add/remove ids here to grant or revoke.
const EDITORS: ReadonlySet<string> = new Set([
  "76561198285334414",
  "76561198300061591",
]);

const VALID_MODES = new Set<Game["mode"]>(["team", "solo", "duo"]);

interface Game {
  id: number;
  name: string;
  cat: string;
  mode: "team" | "solo" | "duo";
  normal: string;
  hardcore: string;
  soloHardcore?: boolean;
  appid?: number;
  cover?: string;
  timer?: boolean;
  achievement?: { apiname: string; label?: string };
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

async function readPool(): Promise<Game[]> {
  const text = await fs.readFile(GAMES_TS_PATH, "utf8");
  const match = text.match(/POOL\s*:\s*Game\[\]\s*=\s*\[([\s\S]*?)\n\];/);
  if (!match) throw new Error("could not locate POOL array in games.ts");
  const body = stripComments(match[1]);
  // The array body is a list of object literals — valid JS once comments and
  // the TS type annotation are stripped. Function() runs in a sandbox without
  // the surrounding closure, so this can't reach into our scope.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const fn = new Function(`return [${body}];`);
  return fn() as Game[];
}

function validateGames(input: unknown): Game[] {
  if (!Array.isArray(input)) throw new HttpError(400, "expected array");
  const seen = new Set<number>();
  const out: Game[] = [];
  for (let i = 0; i < input.length; i++) {
    const raw = input[i] as Record<string, unknown> | null;
    if (!raw || typeof raw !== "object") throw new HttpError(400, `item ${i}: not an object`);

    const id = raw.id;
    if (typeof id !== "number" || !Number.isInteger(id) || id < 1) {
      throw new HttpError(400, `item ${i}: id must be a positive integer`);
    }
    if (seen.has(id)) throw new HttpError(400, `duplicate id ${id}`);
    seen.add(id);

    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    if (!name) throw new HttpError(400, `id ${id}: name required`);

    const cat = typeof raw.cat === "string" ? raw.cat.trim() : "";
    if (!cat) throw new HttpError(400, `id ${id}: cat required`);

    const mode = raw.mode;
    if (typeof mode !== "string" || !VALID_MODES.has(mode as Game["mode"])) {
      throw new HttpError(400, `id ${id}: mode must be team|solo|duo`);
    }

    const normal = typeof raw.normal === "string" ? raw.normal.trim() : "";
    if (!normal) throw new HttpError(400, `id ${id}: normal required`);

    const hardcore = typeof raw.hardcore === "string" ? raw.hardcore.trim() : "";
    if (!hardcore) throw new HttpError(400, `id ${id}: hardcore required`);

    const g: Game = { id, name, cat, mode: mode as Game["mode"], normal, hardcore };
    if (raw.soloHardcore === true) g.soloHardcore = true;
    if (typeof raw.appid === "number" && Number.isInteger(raw.appid) && raw.appid > 0) {
      g.appid = raw.appid;
    }
    if (typeof raw.cover === "string" && raw.cover.trim()) g.cover = raw.cover.trim();
    if (raw.timer === true) g.timer = true;
    const ach = raw.achievement;
    if (ach && typeof ach === "object") {
      const apiname = (ach as Record<string, unknown>).apiname;
      const label = (ach as Record<string, unknown>).label;
      if (typeof apiname === "string" && apiname.trim()) {
        g.achievement = { apiname: apiname.trim() };
        if (typeof label === "string" && label.trim()) g.achievement.label = label.trim();
      }
    }
    out.push(g);
  }
  return out;
}

function serializeGames(games: Game[]): string {
  const sorted = [...games].sort((a, b) => a.id - b.id);
  const lines = sorted.map((g) => {
    const parts: string[] = [
      `id: ${g.id}`,
      `name: ${JSON.stringify(g.name)}`,
      `cat: ${JSON.stringify(g.cat)}`,
      `mode: ${JSON.stringify(g.mode)}`,
    ];
    if (g.soloHardcore) parts.push(`soloHardcore: true`);
    parts.push(`normal: ${JSON.stringify(g.normal)}`);
    parts.push(`hardcore: ${JSON.stringify(g.hardcore)}`);
    if (g.appid) parts.push(`appid: ${g.appid}`);
    if (g.cover) parts.push(`cover: ${JSON.stringify(g.cover)}`);
    if (g.timer) parts.push(`timer: true`);
    if (g.achievement) {
      const a = g.achievement;
      const ach = a.label
        ? `{ apiname: ${JSON.stringify(a.apiname)}, label: ${JSON.stringify(a.label)} }`
        : `{ apiname: ${JSON.stringify(a.apiname)} }`;
      parts.push(`achievement: ${ach}`);
    }
    return ` { ${parts.join(", ")} },`;
  });
  return [
    `import type { Game } from "./types";`,
    ``,
    `export const POOL: Game[] = [`,
    ...lines,
    `];`,
    ``,
    `export function getCategories(): string[] {`,
    ` const set = new Set<string>();`,
    ` POOL.forEach((g) => set.add(g.cat));`,
    ` return ["all", ...Array.from(set).sort()];`,
    `}`,
    ``,
    `export function effectiveMode(g: Game, difficulty: "normal" | "hardcore") {`,
    ` return g.soloHardcore && difficulty === "hardcore" ? "solo" : g.mode;`,
    `}`,
    ``,
  ].join("\n");
}

router.get("/", async (req, res) => {
  try {
    const pool = await readPool();
    const canEdit = !!req.user && EDITORS.has(req.user.steamId);
    res.json({ games: pool, canEdit });
  } catch (err) {
    console.error("[games:get]", err);
    res.status(500).json({ error: "failed to read games.ts" });
  }
});

router.put("/", requireAuth, async (req, res) => {
  if (!EDITORS.has(req.user!.steamId)) {
    res.status(403).json({ error: "Not authorized to edit games" });
    return;
  }
  try {
    const body = req.body as { games?: unknown };
    const games = validateGames(body?.games);
    const text = serializeGames(games);
    await fs.writeFile(GAMES_TS_PATH, text, "utf8");
    res.json({ ok: true, count: games.length });
  } catch (err) {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error("[games:put]", err);
    res.status(500).json({ error: "failed to write games.ts" });
  }
});

export default router;
