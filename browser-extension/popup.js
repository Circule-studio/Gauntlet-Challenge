// Gauntlet Timer popup — connects to the server's SSE overlay stream and
// renders the per-game timer plus the current game's name. Stores config in
// chrome.storage.local so the popup remembers settings across re-opens.
//
// Works on both Chromium (chrome.* namespace) and Firefox (browser.* with the
// chrome alias). Manifest V3.

const $ = (id) => document.getElementById(id);

// Wrap chrome.storage in promises so we can `await` it. Both Chrome MV3 and
// Firefox 109+ support promise-returning storage methods natively, but we keep
// the shim for older Firefox.
const storage = {
  get(keys) {
    return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
  },
  set(items) {
    return new Promise((resolve) => chrome.storage.local.set(items, resolve));
  },
};

let es = null;
let latestState = null;
let tickInterval = null;
let serverNowOffset = 0; // serverNow - clientNow at last message

function setStatus(state) {
  $("status").dataset.state = state;
}

function fmtClock(ms) {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const mm = String(Math.floor(totalSec / 60)).padStart(2, "0");
  const ss = String(totalSec % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function render() {
  const section = $("timer-section");
  const label = $("timer-label");
  const clock = $("timer-clock");
  const gameName = $("game-name");

  if (!latestState) {
    section.classList.remove("running", "expired");
    label.textContent = "En attente…";
    clock.textContent = "--:--";
    gameName.textContent = "";
    chrome.action.setBadgeText({ text: "" });
    return;
  }

  const deadline = latestState.timerDeadline;
  const currentGame = (latestState.games || []).find((g) => g.id === latestState.currentGameId);
  gameName.textContent = currentGame ? currentGame.name : "";

  if (deadline === null || deadline === undefined) {
    section.classList.remove("running", "expired");
    label.textContent = "Aucun timer";
    clock.textContent = "--:--";
    chrome.action.setBadgeText({ text: "" });
    return;
  }

  // Estimated server "now" — corrects for clock skew between this machine and
  // the server. The deadline was stamped by the server's clock.
  const serverNow = Date.now() + serverNowOffset;
  const remaining = deadline - serverNow;

  if (remaining <= 0) {
    section.classList.add("expired");
    section.classList.remove("running");
    label.textContent = "Temps écoulé";
    clock.textContent = "00:00";
    chrome.action.setBadgeBackgroundColor({ color: "#ef4444" });
    chrome.action.setBadgeText({ text: "DONE" });
    return;
  }
  section.classList.add("running");
  section.classList.remove("expired");
  label.textContent = "Temps restant";
  clock.textContent = fmtClock(remaining);
  chrome.action.setBadgeBackgroundColor({ color: "#16a34a" });
  const totalSec = Math.floor(remaining / 1000);
  chrome.action.setBadgeText({ text: `${Math.ceil(totalSec / 60)}m` });
}

function disconnect() {
  if (es) { try { es.close(); } catch {} es = null; }
  if (tickInterval) { clearInterval(tickInterval); tickInterval = null; }
  setStatus("idle");
  latestState = null;
  render();
}

function buildUrl(config) {
  const base = (config.serverUrl || "").replace(/\/+$/, "");
  if (!base) return null;
  if (config.overlayToken) {
    return `${base}/api/overlay/me/${encodeURIComponent(config.overlayToken)}/events`;
  }
  if (config.roomCode) {
    return `${base}/api/overlay/${encodeURIComponent(config.roomCode.toUpperCase())}/events`;
  }
  return null;
}

function connect(config) {
  disconnect();
  const url = buildUrl(config);
  if (!url) {
    setStatus("error");
    return;
  }
  setStatus("connecting");
  try {
    es = new EventSource(url);
  } catch (e) {
    console.error("[gauntlet-timer] EventSource construct failed", e);
    setStatus("error");
    return;
  }
  es.onopen = () => setStatus("connected");
  es.onerror = () => setStatus("error");
  es.onmessage = (evt) => {
    try {
      const data = JSON.parse(evt.data);
      // Per-user stream emits `null` when the user isn't in any room — clear UI.
      if (data === null) {
        latestState = null;
        render();
        return;
      }
      latestState = data;
      // Estimate clock skew: if the server stamped any timestamps, we don't
      // have a dedicated "server-time" field, but the deadline is the only
      // server-stamped value we care about. So we just trust the deadline and
      // compute remaining = deadline - Date.now() — accurate within ~1s for
      // any reasonable clock skew. (The previous skew adjustment is a no-op
      // unless we add a server-time ping; left in for future hardening.)
      serverNowOffset = 0;
      render();
    } catch (e) {
      console.warn("[gauntlet-timer] bad SSE payload", e);
    }
  };
  // Tick the clock every 500ms while the popup is open so the countdown is
  // smooth without waiting for the next SSE push.
  tickInterval = setInterval(render, 500);
}

async function loadAndApply() {
  const cfg = await storage.get(["serverUrl", "roomCode", "overlayToken"]);
  $("server-url").value = cfg.serverUrl || "";
  $("room-code").value = cfg.roomCode || "";
  $("overlay-token").value = cfg.overlayToken || "";
  if (cfg.serverUrl && (cfg.roomCode || cfg.overlayToken)) {
    $("config-details").open = false;
    connect(cfg);
  } else {
    $("config-details").open = true;
    setStatus("idle");
    render();
  }
}

document.addEventListener("DOMContentLoaded", () => {
  $("save-btn").addEventListener("click", async () => {
    const cfg = {
      serverUrl: $("server-url").value.trim(),
      roomCode: $("room-code").value.trim().toUpperCase(),
      overlayToken: $("overlay-token").value.trim(),
    };
    if (!cfg.serverUrl) {
      alert("Renseigne l'URL du serveur.");
      return;
    }
    if (!cfg.roomCode && !cfg.overlayToken) {
      alert("Renseigne un code de room ou un jeton overlay.");
      return;
    }
    await storage.set(cfg);
    $("config-details").open = false;
    connect(cfg);
  });
  $("disconnect-btn").addEventListener("click", async () => {
    await storage.set({ roomCode: "", overlayToken: "" });
    $("room-code").value = "";
    $("overlay-token").value = "";
    disconnect();
  });
  loadAndApply();
});
