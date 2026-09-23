const {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  net,
  protocol,
  session,
  shell,
} = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { setupUpdater } = require("./updater");

const ROOT = path.join(__dirname, "..");
const WORLD_ID = 1001;
const START_URL = "https://youlink.biz/3S2M";
const BROKER_PARTITION = "persist:qbot";

const BROKER_HOSTS = [
  "quotex.com",
  "qxbroker.com",
  "market-qx.pro",
  "market.qx.trade",
  "broker-qx.pro",
  "market-qx.trade",
  "market-qx.info",
];

const CONTENT_SCRIPTS = [
  "css/jquery-3.6.0.min.js",
  "css/jquery-ui.js",
  "main/dom-resolver.js",
  "main/content.js",
  "main/loadpage.js",
  "main/deal.js",
  "main/buyvip.js",
  "main/aianalys.js",
];

protocol.registerSchemesAsPrivileged([
  {
    scheme: "qbot",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      bypassCSP: true,
    },
  },
]);

function canInjectUrl(rawUrl) {
  try {
    const protocolName = new URL(rawUrl).protocol;
    return protocolName === "http:" || protocolName === "https:";
  } catch (e) {
    return false;
  }
}

function readExtensionFile(relativePath) {
  const full = path.resolve(ROOT, relativePath);
  const relative = path.relative(ROOT, full);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Путь вне папки расширения");
  }
  return fs.readFileSync(full);
}

function buildChromeShim(cssText) {
  return `
    {
      globalThis.__QBOT_ELECTRON_INJECTED__ = true;

      const runtime = {
        id: "qbot-plus",
        lastError: undefined,
        getURL(resourcePath) {
          const clean = String(resourcePath || "").replace(/^\\/+/, "");
          return "qbot://bundle/" + clean;
        },
        sendMessage(message, callback) {
          const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
          const onResult = (event) => {
            if (!event.detail || event.detail.id !== id) return;
            document.removeEventListener("qbot-capture-result", onResult);
            runtime.lastError = event.detail.error
              ? { message: event.detail.error }
              : undefined;
            if (typeof callback === "function") callback(event.detail.response || {});
            runtime.lastError = undefined;
          };
          document.addEventListener("qbot-capture-result", onResult);
          document.dispatchEvent(new CustomEvent("qbot-capture-request", {
            detail: { id, message }
          }));
        }
      };

      globalThis.chrome = globalThis.chrome || {};
      globalThis.chrome.runtime = runtime;

      const style = document.createElement("style");
      style.id = "qbot-electron-style";
      style.textContent = ${JSON.stringify(cssText)} + \`
        #qbot-header-dock {
          position: fixed !important;
          left: 0 !important;
          top: 0 !important;
          width: 1px !important;
          height: 1px !important;
          overflow: hidden !important;
          opacity: 0 !important;
          pointer-events: none !important;
        }
      \`;
      (document.head || document.documentElement).appendChild(style);

      globalThis.__QBOT_SIDEBAR_API__ = {
        state() {
          const men = document.getElementById("men");
          const profit = document.getElementById("resbalance");
          const log = document.querySelector("#qbot-header-dock .log");
          const hid = document.querySelector("#qbot-header-dock .hid");
          const running = !!hid && getComputedStyle(hid).visibility !== "hidden";
          let settings = null;
          try {
            settings = JSON.parse(localStorage.getItem("qbot_settings") || "null");
          } catch (e) {
            settings = null;
          }
          return {
            title: men ? men.textContent.replace(/\\s+/g, " ").trim() : "Q-bot",
            profit: profit ? profit.textContent.trim() : "0",
            log: log ? log.textContent.replace(/\\s+/g, " ").trim() : "",
            running,
            vip: String((settings && settings.PD) || "0") === "1",
            ready: typeof start === "function"
          };
        },
        settings() {
          try {
            return JSON.parse(localStorage.getItem("qbot_settings") || "null");
          } catch (e) {
            return null;
          }
        },
        save(patch) {
          const current = JSON.parse(localStorage.getItem("qbot_settings") || "{}");
          const next = Object.assign({}, current, patch || {});
          localStorage.setItem("qbot_settings", JSON.stringify(next));
          if (typeof storage === "object" && storage) Object.assign(storage, next);
          return next;
        },
        start() {
          const hid = document.querySelector("#qbot-header-dock .hid");
          if (hid) hid.style.visibility = "visible";
          localStorage.setItem("statusbot", "work");
          if (typeof start !== "function") {
            return { ok: false, error: "Робот ещё загружается. Подождите пару секунд." };
          }
          start();
          return { ok: true };
        },
        stop() {
          localStorage.setItem("statusbot", "notwork");
          location.reload();
          return { ok: true };
        },
        ai() {
          if (typeof ai !== "function") {
            return { ok: false, error: "AI-анализ ещё не готов." };
          }
          ai();
          return { ok: true };
        }
      };
    }
  `;
}

let cachedScripts = null;

function getInjectionScripts() {
  if (cachedScripts) return cachedScripts;
  const css = readExtensionFile("css/style.css").toString("utf8");
  cachedScripts = [
    { name: "shim", code: buildChromeShim(css) + "\n;void 0;" },
    ...CONTENT_SCRIPTS.map((file) => ({
      name: file,
      code:
        readExtensionFile(file).toString("utf8") +
        "\n;void 0;\n//# sourceURL=qbot://bundle/" + file,
    })),
  ];
  return cachedScripts;
}

function isTradeUrl(rawUrl) {
  try {
    return /\/trade|\/demo-trade/i.test(new URL(rawUrl).pathname);
  } catch (e) {
    return false;
  }
}

// Каждый файл запускается отдельным классическим скриптом в одном мире:
// top-level let/const (storage, Utils, QbotDom...) общие, как у content scripts Chrome.
async function injectBot(contents) {
  const url = contents.getURL();
  if (!canInjectUrl(url)) return;
  try {
    const already = await contents.executeJavaScriptInIsolatedWorld(
      WORLD_ID,
      [{ code: "!!globalThis.__QBOT_ELECTRON_INJECTED__" }],
      false
    );
    if (already) return;
    contents.__qbotInjectedUrl = url;
    contents.emit("qbot-injecting");
    for (const script of getInjectionScripts()) {
      await contents
        .executeJavaScriptInIsolatedWorld(WORLD_ID, [{ code: script.code }], false)
        .catch((error) => console.error("[Q-bot] Ошибка скрипта " + script.name + ":", error));
    }
  } catch (error) {
    console.error("[Q-bot] Не удалось внедрить скрипты:", error);
  }
  contents.emit("qbot-injected");
}

function wireContents(contents) {
  if (contents.__qbotWired) return;
  contents.__qbotWired = true;
  contents.on("did-finish-load", () => {
    injectBot(contents);
  });
  contents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
    if (!isMainFrame) return;
    const injectedUrl = contents.__qbotInjectedUrl;
    if (injectedUrl && !isTradeUrl(injectedUrl) && isTradeUrl(url)) {
      contents.__qbotInjectedUrl = null;
      contents.reload();
    }
  });
}

const SIDEBAR_WIDTH = 400;
const TOPBAR_HEIGHT = 44;
const siteViews = new Map();
const splashes = new Map();

function brokerSession() {
  return session.fromPartition(BROKER_PARTITION);
}

function sessionStatePath() {
  return path.join(app.getPath("userData"), "session-state.json");
}

function readSessionState() {
  try {
    const data = JSON.parse(fs.readFileSync(sessionStatePath(), "utf8"));
    if (data && canInjectUrl(data.lastUrl)) return data;
  } catch (e) {
    return null;
  }
  return null;
}

function writeSessionState(url) {
  if (!canInjectUrl(url)) return;
  try {
    fs.mkdirSync(path.dirname(sessionStatePath()), { recursive: true });
    fs.writeFileSync(
      sessionStatePath(),
      JSON.stringify({ lastUrl: url, savedAt: Date.now() })
    );
  } catch (error) {
    console.error("[Q-bot] Не удалось сохранить сессию:", error);
  }
}

let flushTimer = null;
function scheduleFlushCookies() {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    brokerSession().cookies.flushStore().catch(() => {});
  }, 800);
}

function rememberSession(url) {
  writeSessionState(url);
  scheduleFlushCookies();
}

function initialUrl() {
  const saved = readSessionState();
  return saved ? saved.lastUrl : START_URL;
}

function siteWebPreferences() {
  return {
    partition: BROKER_PARTITION,
    preload: path.join(__dirname, "preload.js"),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  };
}

function shellWebPreferences() {
  return {
    preload: path.join(__dirname, "shell-preload.js"),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  };
}

function layoutSiteView(win) {
  const view = siteViews.get(win.id);
  if (!view) return;
  const [width, height] = win.getContentSize();
  view.setBounds({
    x: 0,
    y: TOPBAR_HEIGHT,
    width: Math.max(480, width - SIDEBAR_WIDTH),
    height: Math.max(200, height - TOPBAR_HEIGHT),
  });
}

function navState(contents) {
  const history = contents.navigationHistory;
  return {
    url: contents.getURL(),
    title: contents.getTitle(),
    canGoBack: history.canGoBack(),
    canGoForward: history.canGoForward(),
    loading: contents.isLoadingMainFrame(),
    zoom: Math.round(contents.getZoomFactor() * 100),
  };
}

function browserAction(win, action) {
  const view = siteViews.get(win.id);
  if (!view) return null;
  const contents = view.webContents;
  const history = contents.navigationHistory;
  const zoomBy = (delta) => {
    const next = Math.min(3, Math.max(0.3, contents.getZoomFactor() + delta));
    contents.setZoomFactor(Math.round(next * 10) / 10);
  };

  if (action === "back" && history.canGoBack()) history.goBack();
  else if (action === "forward" && history.canGoForward()) history.goForward();
  else if (action === "reload") contents.reload();
  else if (action === "hardReload") contents.reloadIgnoringCache();
  else if (action === "stop") contents.stop();
  else if (action === "home") contents.loadURL(START_URL);
  else if (action === "zoomIn") zoomBy(0.1);
  else if (action === "zoomOut") zoomBy(-0.1);
  else if (action === "zoomReset") contents.setZoomFactor(1);
  else if (action === "devtools") contents.toggleDevTools();
  else if (action === "fullscreen") win.setFullScreen(!win.isFullScreen());
  else if (action === "quit") app.quit();
  else if (action.startsWith("open:") && BROKER_HOSTS.includes(action.slice(5))) {
    contents.loadURL(`https://${action.slice(5)}/`);
  }

  return navState(contents);
}

function handleShortcut(win, input) {
  if (input.type !== "keyDown") return null;
  const key = input.key;
  const ctrl = input.control || input.meta;
  if (key === "F5" || (ctrl && !input.shift && key.toLowerCase() === "r")) return "reload";
  if (ctrl && input.shift && key.toLowerCase() === "r") return "hardReload";
  if (key === "F12" || (ctrl && input.shift && key.toLowerCase() === "i")) return "devtools";
  if (key === "F11") return "fullscreen";
  if (input.alt && key === "ArrowLeft") return "back";
  if (input.alt && key === "ArrowRight") return "forward";
  if (ctrl && (key === "=" || key === "+")) return "zoomIn";
  if (ctrl && key === "-") return "zoomOut";
  if (ctrl && key === "0") return "zoomReset";
  if (ctrl && key.toLowerCase() === "l") return "focusAddress";
  return null;
}

function bindShortcuts(win, contents) {
  contents.on("before-input-event", (event, input) => {
    const action = handleShortcut(win, input);
    if (!action) return;
    event.preventDefault();
    if (action === "focusAddress") {
      win.webContents.focus();
      win.webContents.send("qbot-focus-address");
    } else {
      const state = browserAction(win, action);
      if (state && !win.isDestroyed()) win.webContents.send("qbot-nav-state", state);
    }
  });
}

function createWindow(targetUrl) {
  const { WebContentsView } = require("electron");
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 680,
    title: "Q-bot PLUS",
    icon: path.join(ROOT, "logo", "logo-128.png"),
    backgroundColor: "#0a0f1c",
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#0a0f1c",
      symbolColor: "#cbd5e1",
      height: TOPBAR_HEIGHT,
    },
    webPreferences: shellWebPreferences(),
  });

  const view = new WebContentsView({
    webPreferences: siteWebPreferences(),
  });
  siteViews.set(win.id, view);
  win.contentView.addChildView(view);
  layoutSiteView(win);
  view.setVisible(false);

  const splash = { shown: false, stage: { stage: "connect" } };
  splashes.set(win.id, splash);
  const sendStage = (stage) => {
    if (splash.shown || win.isDestroyed()) return;
    splash.stage = stage;
    win.webContents.send("qbot-load-stage", stage);
  };
  const splashFallback = setTimeout(() => sendStage({ stage: "ready" }), 25000);
  view.webContents.on("did-start-loading", () => sendStage({ stage: "connect" }));
  view.webContents.on("dom-ready", () => sendStage({ stage: "page" }));
  view.webContents.on("qbot-injecting", () => sendStage({ stage: "robot" }));
  view.webContents.on("qbot-injected", () => {
    clearTimeout(splashFallback);
    sendStage({ stage: "ready" });
  });
  view.webContents.on("did-fail-load", (_event, code, description, _url, isMainFrame) => {
    if (!isMainFrame || code === -3) return;
    sendStage({ stage: "error", code, description });
  });
  view.webContents.setUserAgent(brokerSession().getUserAgent());
  view.webContents.loadURL(targetUrl || initialUrl());

  const sendUrl = (url) => {
    if (!win.isDestroyed()) win.webContents.send("qbot-navigated", url);
  };
  const sendNavState = () => {
    if (win.isDestroyed() || view.webContents.isDestroyed()) return;
    win.webContents.send("qbot-nav-state", navState(view.webContents));
  };
  view.webContents.on("did-navigate", (_event, url) => {
    rememberSession(url);
    sendUrl(url);
    sendNavState();
  });
  view.webContents.on("did-navigate-in-page", (_event, url) => {
    rememberSession(url);
    sendUrl(url);
    sendNavState();
  });
  ["did-start-loading", "did-stop-loading", "page-title-updated", "zoom-changed"].forEach(
    (name) => view.webContents.on(name, sendNavState)
  );
  bindShortcuts(win, view.webContents);
  bindShortcuts(win, win.webContents);

  win.on("resize", () => layoutSiteView(win));
  win.on("closed", () => {
    clearTimeout(splashFallback);
    siteViews.delete(win.id);
    splashes.delete(win.id);
  });
  win.loadFile(path.join(__dirname, "shell.html"));
  win.webContents.once("did-finish-load", () => layoutSiteView(win));
  return win;
}

function siteContentsFrom(sender) {
  const win = BrowserWindow.fromWebContents(sender);
  return win ? siteViews.get(win.id)?.webContents : null;
}

function runInBot(contents, code) {
  if (!contents || contents.isDestroyed() || contents.isLoadingMainFrame()) {
    return Promise.resolve(null);
  }
  return contents.executeJavaScriptInIsolatedWorld(WORLD_ID, [{ code }], false);
}

function buildMenu() {
  Menu.setApplicationMenu(null);
}

app.whenReady().then(() => {
  const chromeVersion = process.versions.chrome;
  const userAgent = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
  session.defaultSession.setUserAgent(userAgent);
  brokerSession().setUserAgent(userAgent);

  protocol.handle("qbot", (request) => {
    let pathname = "/";
    try {
      pathname = new URL(request.url).pathname;
    } catch (e) {
      return new Response("bad url", { status: 400 });
    }

    const relativePath = decodeURIComponent(pathname).replace(/^\/+/, "");
    let fullPath;
    try {
      fullPath = path.resolve(ROOT, relativePath);
      const relative = path.relative(ROOT, fullPath);
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        return new Response("forbidden", { status: 403 });
      }
    } catch (e) {
      return new Response("bad path", { status: 400 });
    }

    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
      return new Response("not found", { status: 404 });
    }

    return net.fetch(pathToFileURL(fullPath).toString());
  });

  ipcMain.handle("qbot-capture", async (event) => {
    const image = await event.sender.capturePage();
    return image.toDataURL();
  });

  ipcMain.handle("qbot-navigate", (event, rawUrl) => {
    let url = String(rawUrl || "").trim();
    if (!url) return "";
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    const contents = siteContentsFrom(event.sender);
    if (contents) contents.loadURL(url);
    return url;
  });

  ipcMain.handle("qbot-browser", (event, action) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return win ? browserAction(win, String(action || "")) : null;
  });

  ipcMain.handle("qbot-load-stage", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const splash = win ? splashes.get(win.id) : null;
    return splash ? { ...splash.stage, shown: splash.shown } : null;
  });

  ipcMain.handle("qbot-show-site", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const view = win ? siteViews.get(win.id) : null;
    const splash = win ? splashes.get(win.id) : null;
    if (splash) splash.shown = true;
    if (view) {
      view.setVisible(true);
      view.webContents.focus();
    }
  });

  ipcMain.handle("qbot-nav-state", (event) => {
    const contents = siteContentsFrom(event.sender);
    return contents && !contents.isDestroyed() ? navState(contents) : null;
  });

  ipcMain.handle("qbot-bot-state", (event) => {
    return runInBot(
      siteContentsFrom(event.sender),
      "globalThis.__QBOT_SIDEBAR_API__ ? globalThis.__QBOT_SIDEBAR_API__.state() : null"
    );
  });

  ipcMain.handle("qbot-settings-get", (event) => {
    return runInBot(
      siteContentsFrom(event.sender),
      "globalThis.__QBOT_SIDEBAR_API__ ? globalThis.__QBOT_SIDEBAR_API__.settings() : null"
    );
  });

  ipcMain.handle("qbot-settings-save", (event, patch) => {
    const payload = JSON.stringify(patch && typeof patch === "object" ? patch : {});
    return runInBot(
      siteContentsFrom(event.sender),
      "globalThis.__QBOT_SIDEBAR_API__ ? globalThis.__QBOT_SIDEBAR_API__.save(" +
        payload +
        ") : null"
    );
  });

  ipcMain.handle("qbot-start", (event) => {
    return runInBot(
      siteContentsFrom(event.sender),
      "globalThis.__QBOT_SIDEBAR_API__ ? globalThis.__QBOT_SIDEBAR_API__.start() : { ok: false, error: 'Страница ещё не готова' }"
    );
  });

  ipcMain.handle("qbot-stop", (event) => {
    return runInBot(
      siteContentsFrom(event.sender),
      "globalThis.__QBOT_SIDEBAR_API__ ? globalThis.__QBOT_SIDEBAR_API__.stop() : null"
    );
  });

  ipcMain.handle("qbot-ai", (event) => {
    return runInBot(
      siteContentsFrom(event.sender),
      "globalThis.__QBOT_SIDEBAR_API__ ? globalThis.__QBOT_SIDEBAR_API__.ai() : { ok: false }"
    );
  });

  ipcMain.handle("qbot-open-external", (_event, url) => {
    const target = String(url || "");
    if (target.startsWith("https://ai-tradingbot.pro/")) {
      shell.openExternal(target);
    }
  });

  const updater = setupUpdater();
  ipcMain.handle("qbot-update-state", () => updater.state());
  ipcMain.handle("qbot-update-check", () => updater.check());
  ipcMain.handle("qbot-update-install", () => {
    updater.install();
  });
  setTimeout(() => updater.check(), 12000);
  setInterval(() => updater.check(), 4 * 60 * 60 * 1000);

  app.on("web-contents-created", (_event, contents) => {
    wireContents(contents);
  });

  buildMenu();
  createWindow(initialUrl());

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(initialUrl());
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

let flushingOnQuit = false;
app.on("before-quit", (event) => {
  if (flushingOnQuit) return;
  event.preventDefault();
  flushingOnQuit = true;
  clearTimeout(flushTimer);
  brokerSession()
    .cookies.flushStore()
    .catch(() => {})
    .finally(() => app.quit());
});
