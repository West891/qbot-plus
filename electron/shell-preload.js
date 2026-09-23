const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("qbot", {
  navigate(url) {
    return ipcRenderer.invoke("qbot-navigate", url);
  },
  state() {
    return ipcRenderer.invoke("qbot-bot-state");
  },
  settings() {
    return ipcRenderer.invoke("qbot-settings-get");
  },
  save(patch) {
    return ipcRenderer.invoke("qbot-settings-save", patch);
  },
  start() {
    return ipcRenderer.invoke("qbot-start");
  },
  stop() {
    return ipcRenderer.invoke("qbot-stop");
  },
  ai() {
    return ipcRenderer.invoke("qbot-ai");
  },
  openExternal(url) {
    return ipcRenderer.invoke("qbot-open-external", url);
  },
  onNavigated(callback) {
    ipcRenderer.on("qbot-navigated", (_event, url) => callback(url));
  },
  browser(action) {
    return ipcRenderer.invoke("qbot-browser", action);
  },
  navState() {
    return ipcRenderer.invoke("qbot-nav-state");
  },
  onNavState(callback) {
    ipcRenderer.on("qbot-nav-state", (_event, state) => callback(state));
  },
  loadStage() {
    return ipcRenderer.invoke("qbot-load-stage");
  },
  showSite() {
    return ipcRenderer.invoke("qbot-show-site");
  },
  onLoadStage(callback) {
    ipcRenderer.on("qbot-load-stage", (_event, stage) => callback(stage));
  },
  onFocusAddress(callback) {
    ipcRenderer.on("qbot-focus-address", () => callback());
  },
  updateState() {
    return ipcRenderer.invoke("qbot-update-state");
  },
  checkUpdate() {
    return ipcRenderer.invoke("qbot-update-check");
  },
  installUpdate() {
    return ipcRenderer.invoke("qbot-update-install");
  },
  onUpdate(callback) {
    ipcRenderer.on("qbot-update", (_event, status) => callback(status));
  },
});
