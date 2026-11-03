const { ipcRenderer, webFrame } = require("electron");

// Quotex widgets (qx-*, e.g. the account/balance block qx-usermenu-trigger) use closed shadow roots.
// The preload runs in an isolated world, so the patch has to be installed in the page's own world,
// before its scripts create the components.
webFrame.executeJavaScript(`(() => {
  const original = Element.prototype.attachShadow;
  if (!original || original.__qbotOpen) return;
  function attachShadow(init) {
    const tag = String(this.localName || "").toLowerCase();
    const options = init && typeof init === "object" ? Object.assign({}, init) : {};
    if (tag.startsWith("qx-")) options.mode = "open";
    return original.call(this, options);
  }
  attachShadow.__qbotOpen = true;
  Element.prototype.attachShadow = attachShadow;
})()`);

document.addEventListener("qbot-header-balance-request", async (event) => {
  let detail = event.detail;
  if (typeof detail === "string") {
    try { detail = JSON.parse(detail); } catch (e) { return; }
  }
  const id = detail && detail.id;
  if (!id) return;
  let balance = null;
  try {
    balance = await ipcRenderer.invoke("qbot-header-balance");
  } catch (e) {
    balance = null;
  }
  document.dispatchEvent(
    new CustomEvent("qbot-header-balance-result", {
      detail: JSON.stringify({ id, balance })
    })
  );
});

document.addEventListener("qbot-page-settings-request", async (event) => {
  const id = event.detail && event.detail.id;
  if (!id) return;
  try {
    const settings = await ipcRenderer.invoke("qbot-page-settings");
    document.dispatchEvent(
      new CustomEvent("qbot-page-settings-result", { detail: { id, settings } })
    );
  } catch (e) {
    document.dispatchEvent(
      new CustomEvent("qbot-page-settings-result", { detail: { id, settings: null } })
    );
  }
});

document.addEventListener("qbot-trusted-click", (event) => {
  let detail = {};
  try {
    detail = typeof event.detail === "string" ? JSON.parse(event.detail) : event.detail || {};
  } catch (e) {
    return;
  }
  const x = Number(detail.x);
  const y = Number(detail.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  ipcRenderer.invoke("qbot-trusted-click", { x, y }).catch(() => {});
});

// Robot signals from Jev: deal.js asks with {id, pair, demo}, main.js captures the chart and calls ai.php.
document.addEventListener("qbot-jev-signal-request", async (event) => {
  let detail = {};
  try {
    detail = typeof event.detail === "string" ? JSON.parse(event.detail) : event.detail || {};
  } catch (e) {
    return;
  }
  if (!detail.id) return;
  let signal;
  try {
    signal = await ipcRenderer.invoke("qbot-jev-signal", { pair: detail.pair, demo: detail.demo === true });
  } catch (e) {
    signal = { ok: false, error: "ipc" };
  }
  document.dispatchEvent(
    new CustomEvent("qbot-jev-signal-result", { detail: JSON.stringify({ id: detail.id, signal }) })
  );
});

document.addEventListener("qbot-jev-outcome", (event) => {
  let detail = {};
  try {
    detail = typeof event.detail === "string" ? JSON.parse(event.detail) : event.detail || {};
  } catch (e) {
    return;
  }
  ipcRenderer.invoke("qbot-jev-outcome", { id: detail.id, result: detail.result }).catch(() => {});
});

document.addEventListener("qbot-capture-request", async (event) => {
  const id = event.detail && event.detail.id;
  if (!id) return;

  let response = {};
  let error = "";
  try {
    const screenshot = await ipcRenderer.invoke("qbot-capture");
    response = { screenshot };
  } catch (e) {
    error = e && e.message ? e.message : "Не удалось сделать скриншот";
  }

  document.dispatchEvent(
    new CustomEvent("qbot-capture-result", {
      detail: { id, response, error },
    })
  );
});
