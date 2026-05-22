![Header](./banner.png)

10 jeux à enchaîner sans une seule défaite. Multijoueur via Steam OAuth + rooms en temps réel + overlays Twitch.

## Architecture

Monorepo, frontend statique + backend Node.js déployés sur la **même origine** (option 1 — pas de CORS, cookies same-site, un seul process à gérer).

```
gauntlet-challenge/
  frontend/        # Next.js 14 — static export → frontend/out/
    app/           # /lobby, /login, /pair, /room (?code=) — / redirige vers /lobby
    lib/           # types, games, hooks client, socket.io-client
    public/        # covers/ + overlays/ Twitch
  backend/         # Express + Socket.io
    src/
      app.ts       # Express app — sert /api/* + frontend/out/
      socket.ts    # Socket.io — sync rooms en temps réel
      index.ts     # entry point
      lib/         # auth, room-store, ownership, openid, etc.
      routes/      # /api/auth, /api/me, /api/pair, /api/room, /api/steam, /api/overlay
      middleware/  # attachUser, requireAuth
```

## Setup local

```bash
# Installer les deps des deux workspaces
npm install --workspace frontend --workspace backend

# Backend env (Steam API key, JWT secret, etc.)
cp .env.example backend/.env
# édite backend/.env

# Build le frontend (génère frontend/out/)
npm --workspace frontend run build

# Lancer le backend (sert /api/* + frontend/out/ sur localhost:3000)
npm --workspace backend run start
```

## Déploiement Alwaysdata

Option 1 : un seul site Node.js qui sert tout (API + Socket.io + static frontend).

### 1. Cloner le code sur le serveur (SSH)

```bash
ssh USER@ssh-USER.alwaysdata.net
cd ~/
git clone <ton-repo> gauntlet-challenge
cd gauntlet-challenge
```

### 2. Build

```bash
npm install --workspace frontend --workspace backend
npm --workspace frontend run build  # → frontend/out/
```

### 3. Variables d'env

Soit dans `backend/.env`, soit dans **Environnement → Variables** côté admin Alwaysdata :

- `STEAM_API_KEY` — clé Steam Web API
- `JWT_SECRET` — string random long (>= 32 chars)
- `STEAM_REALM` — `https://gauntlet.USER.alwaysdata.net` (ou ton domaine)
- `STEAM_RETURN_URL` — `https://gauntlet.USER.alwaysdata.net/api/auth/steam/callback`
- `NODE_ENV=production`
- `FRONTEND_DIST=../frontend/out` (déjà le défaut)
- `PORT` — défini automatiquement par Alwaysdata, ne pas hardcoder

### 4. Configuration du site (admin Alwaysdata)

**Web → Sites → Ajouter un site :**

- Type : `Node.js`
- Working directory : `/home/USER/gauntlet-challenge/backend`
- Command : `npm start`
- Adresse / Hostname : ton domaine
- HTTPS : activer Let's Encrypt

### 5. Vérifier

```bash
curl https://gauntlet.USER.alwaysdata.net/api/me  # → null (pas authentifié)
```

### Redéploiement

```bash
git pull
npm install --workspace frontend --workspace backend  # si deps changent
npm --workspace frontend run build
# Restart le site depuis l'admin Alwaysdata
```

## Concept

10 jeux tirés aléatoirement, le but est de tous les enchaîner sans perdre. Pénalité au choix : reset complet ou recule d'un jeu. Difficulté Normal ou Hardcore. Sélection de 0-5 jeux épinglés, le reste tiré aléatoirement dans le pool de 80.

- `/` → redirige vers `/lobby`
- `/login` → OAuth Steam
- `/lobby` → créer / rejoindre une room
- `/room?code=XXXXXX` → page de jeu multijoueur (Socket.io sync)
- `/pair` → flow de pairing pour ajouter d'autres joueurs sur la même machine
- Overlays Twitch : `/overlays/widgets/<widget>.html?token=<jwt>` (token issu de `/api/me/overlay-token`)
