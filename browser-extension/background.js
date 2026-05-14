// Background service worker — maintains a long-running SSE connection so the
// toolbar badge can show the current timer even when the popup is closed.
//
// Note: Chrome MV3 service workers can be suspended after ~30s of inactivity.
// The `keepalive` alarm fires every minute and re-establishes the SSE if it
// dropped. Firefox's MV3 implementation keeps the worker alive longer but the
// same logic works there too.

const KEEPALIVE_ALARM = "keepalive";

let es = null;
let lastDeadline = null;

const storage = {
  get(keys) {
    return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
  },
};

function badge(text, color) {
  chrome.action.setBadgeText({ text }).catch(() => {});
  if (color) chrome.action.setBadgeBackgroundColor({ color }).catch(() => {});
}

function buildUrl(config) {
  const base = (config.serverUrl || "").replace(/\/+$/, "");
  if (!base) return null;
  if (config.overlayToken) return `${base}/api/overlay/me/${encodeURIComponent(config.overlayToken)}/events`;
  if (config.roomCode) return `${base}/api/overlay/${encodeURIComponent(config.roomCode.toUpperCase())}/events`;
  return null;
}

async function reconnect() {
  if (es) { try { es.close(); } catch {} es = null; }
  const cfg = await storage.get(["serverUrl", "roomCode", "overlayToken"]);
  const url = buildUrl(cfg);
  if (!url) { badge("", "#64748b"); return; }
  try {
    es = new EventSource(url);
  } catch {
    badge("ERR", "#ef4444");
    return;
  }
  es.onerror = () => badge("ERR", "#ef4444");
  es.onmessage = (evt) => {
    try {
      const data = JSON.parse(evt.data);
      if (!data || typeof data !== "object") {
        lastDeadline = null;
        badge("", "#64748b");
        return;
      }
      const deadline = data.timerDeadline;
      lastDeadline = (typeof deadline === "number") ? deadline : null;
      updateBadge();
    } catch {}
  };
}

function updateBadge() {
  if (lastDeadline === null) { badge("", "#64748b"); return; }
  const remaining = lastDeadline - Date.now();
  if (remaining <= 0) { badge("DONE", "#ef4444"); return; }
  const mins = Math.ceil(remaining / 60_000);
  badge(`${mins}m`, "#16a34a");
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 1 });
  void reconnect();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 1 });
  void reconnect();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEPALIVE_ALARM) {
    updateBadge();
    if (!es || es.readyState === 2 /* CLOSED */) {
      void reconnect();
    }
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if ("serverUrl" in changes || "roomCode" in changes || "overlayToken" in changes) {
    void reconnect();
  }
});
