"use client";

import { useEffect, useMemo, useState } from "react";
import type { Game, GameMode } from "@/lib/types";
import type { SteamSessionUser } from "@/lib/types/steam";

interface DraftGame {
  id: number | "";
  name: string;
  cat: string;
  mode: GameMode;
  normal: string;
  hardcore: string;
  soloHardcore: boolean;
  appid: number | "";
  cover: string;
  timer: boolean;
}

const EMPTY_DRAFT: DraftGame = {
  id: "",
  name: "",
  cat: "",
  mode: "team",
  normal: "",
  hardcore: "",
  soloHardcore: false,
  appid: "",
  cover: "",
  timer: false,
};

function gameToDraft(g: Game): DraftGame {
  return {
    id: g.id,
    name: g.name,
    cat: g.cat,
    mode: g.mode,
    normal: g.normal,
    hardcore: g.hardcore,
    soloHardcore: g.soloHardcore ?? false,
    appid: g.appid ?? "",
    cover: g.cover ?? "",
    timer: g.timer ?? false,
  };
}

function draftToGame(d: DraftGame): Game {
  const id = typeof d.id === "number" ? d.id : Number(d.id);
  const g: Game = {
    id,
    name: d.name.trim(),
    cat: d.cat.trim(),
    mode: d.mode,
    normal: d.normal.trim(),
    hardcore: d.hardcore.trim(),
  };
  if (d.soloHardcore) g.soloHardcore = true;
  if (d.appid !== "" && Number.isInteger(Number(d.appid))) g.appid = Number(d.appid);
  if (d.cover.trim()) g.cover = d.cover.trim();
  if (d.timer) g.timer = true;
  return g;
}

type Selection = number | "new" | null;

export default function AdminGamesPage() {
  const [me, setMe] = useState<SteamSessionUser | null | "loading">("loading");
  const [games, setGames] = useState<Game[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<Selection>(null);
  const [draft, setDraft] = useState<DraftGame>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [meRes, gamesRes] = await Promise.all([
          fetch("/api/me", { cache: "no-store" }),
          fetch("/api/games", { cache: "no-store" }),
        ]);
        if (cancelled) return;
        const meData = meRes.ok ? await meRes.json() : null;
        if (!gamesRes.ok) throw new Error(`http_${gamesRes.status}`);
        const gamesData = (await gamesRes.json()) as { games: Game[]; canEdit: boolean };
        setMe(meData && typeof meData === "object" && "steamId" in meData ? (meData as SteamSessionUser) : null);
        setGames(gamesData.games);
        setCanEdit(!!gamesData.canEdit);
      } catch (e) {
        if (cancelled) return;
        setError(`Chargement échoué : ${(e as Error).message}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const categories = useMemo(() => {
    const set = new Set<string>();
    games.forEach((g) => set.add(g.cat));
    return Array.from(set).sort();
  }, [games]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return games
      .filter((g) => filter === "all" || g.cat === filter)
      .filter((g) => !q || g.name.toLowerCase().includes(q) || String(g.id) === q)
      .sort((a, b) => a.id - b.id);
  }, [games, filter, search]);

  const select = (sel: Selection) => {
    setError(null);
    if (sel === null) {
      setSelectedId(null);
      setDraft(EMPTY_DRAFT);
      return;
    }
    if (sel === "new") {
      const nextId = games.length === 0 ? 1 : Math.max(...games.map((g) => g.id)) + 1;
      setDraft({ ...EMPTY_DRAFT, id: nextId });
      setSelectedId("new");
      return;
    }
    const g = games.find((x) => x.id === sel);
    if (!g) return;
    setDraft(gameToDraft(g));
    setSelectedId(sel);
  };

  const validateDraft = (): string | null => {
    const idNum = Number(draft.id);
    if (!Number.isInteger(idNum) || idNum < 1) return "ID doit être un entier positif";
    const collision = games.find((g) => g.id === idNum);
    const editing = typeof selectedId === "number" ? selectedId : null;
    if (collision && collision.id !== editing) return `ID ${idNum} déjà utilisé par « ${collision.name} »`;
    if (!draft.name.trim()) return "Nom requis";
    if (!draft.cat.trim()) return "Catégorie requise";
    if (!draft.normal.trim()) return "Objectif Normal requis";
    if (!draft.hardcore.trim()) return "Objectif Hardcore requis";
    if (draft.appid !== "" && !Number.isInteger(Number(draft.appid))) return "App ID doit être un entier";
    return null;
  };

  const applyDraft = () => {
    const err = validateDraft();
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    const next = draftToGame(draft);
    setGames((prev) => {
      if (selectedId === "new") return [...prev, next];
      const oldId = selectedId as number;
      const idx = prev.findIndex((g) => g.id === oldId);
      if (idx === -1) return [...prev, next];
      const copy = [...prev];
      copy[idx] = next;
      return copy;
    });
    setSelectedId(next.id);
    setDirty(true);
  };

  const deleteSelected = () => {
    if (typeof selectedId !== "number") return;
    const g = games.find((x) => x.id === selectedId);
    if (!g) return;
    if (!confirm(`Supprimer « ${g.name} » (id ${g.id}) ?`)) return;
    setGames((prev) => prev.filter((x) => x.id !== selectedId));
    setSelectedId(null);
    setDraft(EMPTY_DRAFT);
    setDirty(true);
  };

  const reload = async () => {
    if (dirty && !confirm("Recharger depuis le serveur ? Les modifications locales non enregistrées seront perdues.")) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/games", { cache: "no-store" });
      if (!res.ok) throw new Error(`http_${res.status}`);
      const data = (await res.json()) as { games: Game[]; canEdit: boolean };
      setGames(data.games);
      setCanEdit(!!data.canEdit);
      setSelectedId(null);
      setDraft(EMPTY_DRAFT);
      setDirty(false);
    } catch (e) {
      setError(`Rechargement échoué : ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  const persist = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/games", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ games }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setSavedAt(Date.now());
      setDirty(false);
    } catch (e) {
      setError(`Échec : ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  if (me === "loading" || loading) {
    return (
      <main className="auth-shell">
        <div className="auth-card">
          <p>Chargement…</p>
        </div>
      </main>
    );
  }

  if (!me) {
    return (
      <main className="auth-shell">
        <div className="auth-card">
          <h1 className="auth-title">Éditeur de jeux</h1>
          <p className="auth-subtitle">Connecte-toi avec Steam pour accéder à cette page.</p>
          <a className="auth-btn" href="/api/auth/steam">Se connecter avec Steam</a>
        </div>
      </main>
    );
  }

  if (!canEdit) {
    return (
      <main className="auth-shell">
        <div className="auth-card">
          <h1 className="auth-title">Accès refusé</h1>
          <p>
            Le compte <b>{me.displayName}</b> n&apos;est pas autorisé à éditer la liste des jeux.
          </p>
          <p className="auth-subtitle" style={{ marginTop: 8 }}>
            Steam ID : <code>{me.steamId}</code>
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="ge-shell">
      <header className="ge-header">
        <div>
          <h1>Éditeur de jeux</h1>
          <p className="ge-subtitle">
            Connecté comme <b>{me.displayName}</b> · {games.length} jeux{dirty ? " · modifications non enregistrées" : ""}
            {savedAt && !dirty ? ` · sauvegardé à ${new Date(savedAt).toLocaleTimeString()}` : ""}
          </p>
        </div>
        <div className="ge-header-actions">
          <button className="ge-btn" onClick={reload} disabled={saving}>Recharger</button>
          <button className="ge-btn ge-btn-primary" onClick={persist} disabled={saving || !dirty}>
            {saving ? "Enregistrement…" : "Enregistrer sur le serveur"}
          </button>
        </div>
      </header>

      {error && <div className="ge-error">{error}</div>}

      <div className="ge-body">
        <aside className="ge-list">
          <div className="ge-list-controls">
            <input
              type="search"
              placeholder="Rechercher (nom ou id)…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="ge-input"
            />
            <select value={filter} onChange={(e) => setFilter(e.target.value)} className="ge-input">
              <option value="all">Toutes catégories</option>
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <button className="ge-btn" onClick={() => select("new")}>+ Nouveau jeu</button>
          </div>
          <ul className="ge-list-items">
            {filtered.map((g) => (
              <li
                key={g.id}
                className={`ge-list-item ${selectedId === g.id ? "is-selected" : ""}`}
                onClick={() => select(g.id)}
              >
                <span className="ge-list-id">#{g.id}</span>
                <span className="ge-list-name">{g.name}</span>
                <span className="ge-list-cat">{g.cat}</span>
              </li>
            ))}
            {filtered.length === 0 && <li className="ge-empty-list">Aucun résultat</li>}
          </ul>
        </aside>

        <section className="ge-editor">
          {selectedId === null ? (
            <div className="ge-empty">Sélectionne un jeu dans la liste, ou clique « + Nouveau jeu ».</div>
          ) : (
            <>
              <h2>{selectedId === "new" ? "Nouveau jeu" : `Édition — id ${selectedId}`}</h2>

              <div className="ge-grid">
                <Field label="ID">
                  <input
                    type="number"
                    className="ge-input"
                    value={draft.id}
                    onChange={(e) => setDraft({ ...draft, id: e.target.value === "" ? "" : Number(e.target.value) })}
                  />
                </Field>
                <Field label="Nom">
                  <input
                    type="text"
                    className="ge-input"
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  />
                </Field>
                <Field label="Catégorie">
                  <input
                    type="text"
                    className="ge-input"
                    list="ge-categories"
                    value={draft.cat}
                    onChange={(e) => setDraft({ ...draft, cat: e.target.value })}
                  />
                  <datalist id="ge-categories">
                    {categories.map((c) => <option key={c} value={c} />)}
                  </datalist>
                </Field>
                <Field label="Mode">
                  <select
                    className="ge-input"
                    value={draft.mode}
                    onChange={(e) => setDraft({ ...draft, mode: e.target.value as GameMode })}
                  >
                    <option value="team">team</option>
                    <option value="solo">solo</option>
                    <option value="duo">duo</option>
                  </select>
                </Field>
                <Field label="Steam App ID (optionnel)">
                  <input
                    type="number"
                    className="ge-input"
                    value={draft.appid}
                    onChange={(e) => setDraft({ ...draft, appid: e.target.value === "" ? "" : Number(e.target.value) })}
                    placeholder="ex. 730"
                  />
                </Field>
                <Field label="Cover URL (optionnel)">
                  <input
                    type="text"
                    className="ge-input"
                    value={draft.cover}
                    onChange={(e) => setDraft({ ...draft, cover: e.target.value })}
                    placeholder="/covers/example.jpg"
                  />
                </Field>
              </div>

              <Field label="Objectif Normal">
                <textarea
                  className="ge-input"
                  rows={2}
                  value={draft.normal}
                  onChange={(e) => setDraft({ ...draft, normal: e.target.value })}
                />
              </Field>
              <Field label="Objectif Hardcore">
                <textarea
                  className="ge-input"
                  rows={2}
                  value={draft.hardcore}
                  onChange={(e) => setDraft({ ...draft, hardcore: e.target.value })}
                />
              </Field>

              <div className="ge-checkboxes">
                <label>
                  <input
                    type="checkbox"
                    checked={draft.soloHardcore}
                    onChange={(e) => setDraft({ ...draft, soloHardcore: e.target.checked })}
                  />
                  Devient solo en hardcore
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={draft.timer}
                    onChange={(e) => setDraft({ ...draft, timer: e.target.checked })}
                  />
                  A un compte à rebours
                </label>
              </div>

              <div className="ge-editor-actions">
                <button className="ge-btn ge-btn-primary" onClick={applyDraft}>
                  {selectedId === "new" ? "Ajouter" : "Appliquer"}
                </button>
                <button className="ge-btn" onClick={() => select(null)}>Annuler</button>
                {typeof selectedId === "number" && (
                  <button className="ge-btn ge-btn-danger" onClick={deleteSelected}>Supprimer</button>
                )}
              </div>
              <p className="ge-help">
                « Appliquer » met à jour la liste localement. Les changements sont écrits dans <code>frontend/lib/games.ts</code> quand tu cliques « Enregistrer sur le serveur » en haut. Pense à <code>npm run build</code> et redéployer le front pour que les modifs apparaissent dans l&apos;app.
              </p>
            </>
          )}
        </section>
      </div>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="ge-field">
      <span className="ge-field-label">{label}</span>
      {children}
    </label>
  );
}
