# Gauntlet Timer — extension navigateur

Affiche le timer Gauntlet Challenge dans la barre du navigateur. Compatible **Chromium** (Chrome, Edge, Brave, Opera) et **Firefox** (109+).

## Installation

### Chromium

1. Ouvrir `chrome://extensions/`
2. Activer le **mode développeur** (toggle en haut à droite)
3. Cliquer **« Charger l'extension non empaquetée »**
4. Sélectionner le dossier `browser-extension/`

### Firefox

1. Ouvrir `about:debugging#/runtime/this-firefox`
2. Cliquer **« Charger un module complémentaire temporaire… »**
3. Sélectionner `browser-extension/manifest.json`

> Pour une installation permanente sur Firefox, l'extension doit être signée par Mozilla — utilise `web-ext build` puis soumets le `.xpi` via [addons.mozilla.org](https://addons.mozilla.org/).

## Configuration

Au premier lancement, clique sur l'icône Gauntlet dans la barre :

- **URL du serveur** : l'origine où tourne l'app (ex. `https://gauntlet.example.com`)
- **Code de room** : code à 6 caractères affiché en haut de la page room
  *— OU —*
- **Jeton overlay** : jeton personnel obtenu via le bouton « Overlays » dans la room (suit automatiquement les changements de room)

Clique **« Enregistrer & connecter »**. Le badge de l'icône affiche les minutes restantes ; le popup affiche le compte à rebours détaillé.

## Données consommées

L'extension se connecte au flux SSE public `/api/overlay/:code/events` ou `/api/overlay/me/:token/events`. Pas de transmission d'identifiants ni de cookies — uniquement le jeton overlay (qui est volontairement dégradé : aucun accès aux mutations).
