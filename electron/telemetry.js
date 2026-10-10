const { app, net } = require("electron");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

// Anonymous usage counter: a random install id, the app version and whether VIP is on.
// The server turns it into a daily Telegram digest (landing/app-stats.php).
const STATS_URL = process.env.QBOT_STATS_URL || "https://ai-tradebot.com/qbotplus/app-stats.php";
const RETRY_DELAYS = [30 * 1000, 2 * 60 * 1000, 10 * 60 * 1000];

function installIdPath() {
  return path.join(app.getPath("userData"), "install-id.json");
}

let cachedId = null;
function installId() {
  if (cachedId) return cachedId;
  try {
    const saved = JSON.parse(fs.readFileSync(installIdPath(), "utf8"));
    if (saved && /^[a-f0-9-]{16,64}$/i.test(saved.id)) return (cachedId = saved.id);
  } catch (e) {}
  cachedId = crypto.randomUUID();
  try {
    fs.mkdirSync(path.dirname(installIdPath()), { recursive: true });
    fs.writeFileSync(installIdPath(), JSON.stringify({ id: cachedId, createdAt: Date.now() }));
  } catch (e) {}
  return cachedId;
}

// Dev runs stay out of the statistics unless QBOT_STATS_DEV=1.
function enabled() {
  return app.isPackaged || process.env.QBOT_STATS_DEV === "1";
}

function report(type, extra) {
  if (!enabled()) return;
  const body = JSON.stringify({
    type,
    install: installId(),
    version: app.getVersion(),
    ...(extra || {}),
  });
  const attempt = (index) => {
    net
      .fetch(STATS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": "QbotPlus/" + app.getVersion() },
        body,
      })
      .then((response) => {
        if (response.status >= 500) throw new Error("http " + response.status);
      })
      .catch((error) => {
        if (index >= RETRY_DELAYS.length) {
          console.warn("[Q-bot] Статистика не отправлена:", error && error.message ? error.message : error);
          return;
        }
        setTimeout(() => attempt(index + 1), RETRY_DELAYS[index]).unref();
      });
  };
  attempt(0);
}

// Errors: the same message (numbers ignored) goes out once per 30 minutes, at most 20 per hour.
const ERROR_REPEAT_MS = 30 * 60 * 1000;
const ERRORS_PER_HOUR = 20;
const errorSentAt = new Map();
let errorWindow = { start: 0, count: 0 };

function clip(value, max) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, max);
}

function reportError(kind, message, details) {
  const text = clip(message, 300);
  if (!text) return;
  const key = kind + "|" + text.replace(/\d+([.,]\d+)?/g, "#");
  const now = Date.now();
  if (now - (errorSentAt.get(key) || 0) < ERROR_REPEAT_MS) return;
  if (now - errorWindow.start > 60 * 60 * 1000) errorWindow = { start: now, count: 0 };
  if (errorWindow.count >= ERRORS_PER_HOUR) return;
  errorWindow.count++;
  errorSentAt.set(key, now);
  report("error", {
    kind,
    message: text,
    source: clip(details && details.source, 80),
    page: clip(details && details.page, 80),
    vip: !!(details && details.vip),
  });
}

module.exports = { report, reportError };
