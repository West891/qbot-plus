const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

function readRepo() {
  try {
    const data = JSON.parse(
      fs.readFileSync(path.join(__dirname, "github-update.json"), "utf8")
    );
    const owner = String(data.owner || "").trim();
    const repo = String(data.repo || "").trim();
    if (!owner || owner === "REPLACE_OWNER" || !repo) return null;
    return { owner, repo };
  } catch (e) {
    return null;
  }
}

function notesText(notes) {
  if (!notes) return "";
  if (typeof notes === "string") return notes.slice(0, 500);
  if (Array.isArray(notes)) {
    return notes
      .map((item) => (typeof item === "string" ? item : item && item.note) || "")
      .join("\n")
      .slice(0, 500);
  }
  return "";
}

function setupUpdater() {
  const version = app.getVersion();
  let lastStatus = { state: "idle", version };
  let pending = null;

  const push = (status) => {
    lastStatus = status;
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send("qbot-update", status);
    }
    return status;
  };

  const repo = readRepo();
  if (!repo) {
    return {
      state: () => lastStatus,
      check: () => Promise.resolve(push({ state: "noconfig", version })),
      install() {},
    };
  }

  const { autoUpdater } = require("electron-updater");
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = {
    info: (...args) => console.log("[update]", ...args),
    warn: (...args) => console.warn("[update]", ...args),
    error: (...args) => console.error("[update]", ...args),
    debug() {},
  };

  if (!app.isPackaged) {
    autoUpdater.forceDevUpdateConfig = true;
    const yml = [
      "provider: github",
      "owner: " + repo.owner,
      "repo: " + repo.repo,
      "updaterCacheDirName: qbot-plus-updater",
      "",
    ].join("\n");
    fs.writeFileSync(path.join(app.getAppPath(), "dev-app-update.yml"), yml);
  }

  autoUpdater.on("checking-for-update", () => {
    push({ state: "checking", version });
  });
  autoUpdater.on("update-available", (info) => {
    push({ state: "available", version, next: info.version, notes: notesText(info.releaseNotes) });
  });
  autoUpdater.on("update-not-available", () => {
    push({ state: "current", version });
  });
  autoUpdater.on("download-progress", (progress) => {
    push({
      state: "downloading",
      version,
      percent: Math.round(progress.percent || 0),
    });
  });
  autoUpdater.on("update-downloaded", (info) => {
    push({ state: "ready", version, next: info.version });
  });
  autoUpdater.on("error", (error) => {
    push({ state: "error", version, message: error && error.message ? error.message : String(error) });
  });

  return {
    state: () => lastStatus,
    check() {
      if (pending) return pending;
      push({ state: "checking", version });
      pending = autoUpdater
        .checkForUpdates()
        .then(() => lastStatus)
        .catch((error) => push({
          state: "error",
          version,
          message: error && error.message ? error.message : String(error),
        }))
        .finally(() => {
          pending = null;
        });
      return pending;
    },
    install() {
      autoUpdater.quitAndInstall(false, true);
    },
  };
}

module.exports = { setupUpdater };
