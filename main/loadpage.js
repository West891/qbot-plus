// Утилитарные функции
const Utils = {
  /**
   * Ожидание появления элемента в DOM с таймаутом
   * @param {string} selector - CSS-селектор
   * @param {number} timeout - Таймаут в миллисекундах
   * @returns {Promise<Element>}
   */
  waitForElement(selector, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const existingElement = document.querySelector(selector);
      if (existingElement) {
        return resolve(existingElement);
      }

      const observer = new MutationObserver(() => {
        const element = document.querySelector(selector);
        if (element) {
          observer.disconnect();
          resolve(element);
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });

      const timeoutId = setTimeout(() => {
        observer.disconnect();
        reject(new Error(`Элемент ${selector} не найден за ${timeout}мс`));
      }, timeout);

      // Защита от утечки таймаута
      const originalDisconnect = observer.disconnect;
      observer.disconnect = function () {
        clearTimeout(timeoutId);
        originalDisconnect.call(this);
      };
    });
  },

  /**
   * Извлечение 6+ цифр из текста
   * @param {string|null|undefined} text
   * @returns {string|null}
   */
  extractNumbers(text) {
    const match = text?.match(/\d{6,}/);
    return match ? match[0] : null;
  },

  /**
   * Очистка строки баланса от символов валют и пробелов
   * @param {string|number|null|undefined} balance
   * @returns {number}
   */
  cleanBalance(balance) {
    if (!balance) return 0;
    const cleaned = String(balance).replace(/[,\$₸R€₽₹£\s]/g, "");
    const parsed = Number(cleaned);
    return isNaN(parsed) ? 0 : Math.round(parsed);
  },

  /**
   * Задержка в миллисекундах
   * @param {number} ms
   * @returns {Promise<void>}
   */
  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  },

  /**
   * Дебаунс функции
   * @param {Function} func
   * @param {number} delay
   * @returns {Function}
   */
  debounce(func, delay) {
    let timeoutId;
    return function (...args) {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => func.apply(this, args), delay);
    };
  },
};

// Константы (DOM — через QbotDom в main/dom-resolver.js)
const SLOGAN_HEADER_TEXT = QbotDom.SLOGAN_TEXT;
const QBOT_DOCK_ID = "qbot-header-dock";
let _qbotHeaderPatching = false;

function getHeaderDock() {
  return document.getElementById(QBOT_DOCK_ID);
}

function ensureHeaderDock() {
  let dock = getHeaderDock();
  if (!dock) {
    dock = document.createElement("div");
    dock.id = QBOT_DOCK_ID;
    dock.className = "qbot-header-dock qbot-header-bar";
    document.body.appendChild(dock);
  }
  return dock;
}

function isMenInDock(men) {
  const dock = getHeaderDock();
  return !!(men && dock && dock.contains(men));
}

function syncDockPosition() {
  const dock = ensureHeaderDock();
  const anchor = QbotDom.findHeaderAnchor();

  const applyPosition = () => {
    if (anchor) {
      const r = anchor.getBoundingClientRect();
      const dockH = dock.offsetHeight || 24;
      dock.style.top = `${Math.max(4, r.top + (r.height - dockH) / 2)}px`;
      dock.style.left = `${r.right + 8}px`;
    } else {
      dock.style.top = "10px";
      dock.style.left = `${Math.max(8, window.innerWidth * 0.08)}px`;
    }
  };

  applyPosition();
  if (dock.offsetHeight === 0) {
    requestAnimationFrame(applyPosition);
  }
}

function removeQuotexSloganBlock() {
  QbotDom.hideQuotexSlogan();
}

function isQbotOwnMutation(mutations) {
  const dock = getHeaderDock();
  return mutations.every((m) => {
    let node = m.target;
    if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
    if (!node) return true;
    if (node.id === QBOT_DOCK_ID || node.closest?.(`#${QBOT_DOCK_ID}`)) {
      return true;
    }
    if (dock && (node === dock || dock.contains(node))) return true;
    if (node.getAttribute?.("data-qbot-slogan-hidden") === "1") return true;
    return false;
  });
}

function waitForPageSettled() {
  return new Promise((resolve) => {
    const delay = () => setTimeout(resolve, 1200);
    if (document.readyState === "complete") delay();
    else window.addEventListener("load", delay, { once: true });
  });
}

function cleanupInlineQbotMounts() {
  const dock = getHeaderDock();
  const men = document.getElementById("men");

  if (men && dock && dock.contains(men)) {
    removeMisplacedQbotPanel();
    return;
  }

  if (men && (!dock || !dock.contains(men))) {
    const wrap = men.closest(".qbot-header-bar");
    if (wrap && wrap.id !== QBOT_DOCK_ID) {
      wrap.remove();
    } else {
      const hid = men.parentElement?.querySelector(".hid");
      if (hid && !dock?.contains(hid)) hid.remove();
      men.remove();
    }
  }

  document.querySelectorAll(".qbot-header-bar").forEach((el) => {
    if (el.id !== QBOT_DOCK_ID) el.remove();
  });

  removeMisplacedQbotPanel();
}

function removeMisplacedQbotPanel() {
  const men = document.getElementById("men");
  if (!men || !QbotDom.isAccountHeaderBlock(men)) return;

  const wrap = men.closest(".qbot-header-bar");
  if (wrap) {
    wrap.remove();
    return;
  }
  const hid = men.parentElement?.querySelector(".hid");
  hid?.remove();
  men.remove();
}

const SELECTORS = {
  /** Старая шапка + новая (PiLdZ / rymiA + icon-caret) */
  PANEL_BOT: "#men",
  STOP_BUTTON: ".stop-button",
};

const ENDPOINTS = {
  SYNC_USER: (userId) =>
    `https://ai-tradingbot.pro/user.php?broker=quotexNew&tradeid=${userId}`,
};

const TIMEOUTS = {
  INIT_DOM: 1000,
  GET_USER_ID: 1500,
  GET_BALANCE: 3500,
  RETRY_DELAY: 1000,
  MAX_RETRY_DELAY: 10000,
  SLOGAN_TIMEOUT: 8000,
  DROPDOWN_TIMEOUT: 5000,
  USER_MENU_TIMEOUT: 12000,
  BALANCE_TIMEOUT: 5000,
};

function queryBalanceElement() {
  return QbotDom.findBalance();
}

function waitForBalanceElement(timeout = TIMEOUTS.BALANCE_TIMEOUT) {
  return QbotDom.waitFor("balance", timeout);
}

function findSloganElement() {
  return QbotDom.findSlogan();
}

function findHeaderMountPoint() {
  return QbotDom.findHeaderMountPoint();
}

function waitForSloganElement(timeout = TIMEOUTS.SLOGAN_TIMEOUT) {
  return QbotDom.waitFor("slogan", timeout);
}

function waitForUserIdAfterMenuOpen(timeout = TIMEOUTS.DROPDOWN_TIMEOUT) {
  return new Promise((resolve, reject) => {
    let tid;
    const observer = new MutationObserver(tryResolve);
    function tryResolve() {
      const id = QbotDom.extractUserIdFromOpenMenu();
      if (id) {
        observer.disconnect();
        if (tid) clearTimeout(tid);
        resolve(id);
      }
    }

    tryResolve();
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    tid = setTimeout(() => {
      observer.disconnect();
      const id = QbotDom.extractUserIdFromOpenMenu();
      if (id) resolve(id);
      else reject(new Error("ID пользователя не найден в меню"));
    }, timeout);
  });
}

/** @deprecated use QbotDom.waitForUserMenu */
function waitForUserMenuTrigger(timeout = TIMEOUTS.USER_MENU_TIMEOUT) {
  return QbotDom.waitForUserMenu(timeout);
}

const AUTO_PICK_MAX_PAIRS = 5;
const AUTO_PICK_MIN_PAYOUT = 70;
const AUTO_PICK_CLICK_DELAY_MS = 300;

/** Кнопка «+» выбора актива: старая / #asset-select--button / svg.icon-plus */
function findAssetSelectPlusButton() {
  return (
    document.querySelector(
      "button.CAZSg.wupmB.BEz9j:has(svg.icon-plus)"
    ) ||
    document
      .querySelector("button.CAZSg.wupmB.BEz9j svg.icon-plus")
      ?.closest("button") ||
    document.querySelector(".asset-select__button") ||
    document.querySelector("#asset-select--button svg.icon-plus")?.closest("button") ||
    document.querySelector(".ZRFGh button:has(svg.icon-plus)") ||
    null
  );
}

/** Вкладка «Валюты» в модалке (чтобы не только крипта OTC) */
function trySelectCurrenciesTabInAssetPanel() {
  const root =
    document.querySelector("#asset-select--button .KGJWi") ||
    document.querySelector(".h9gji .KGJWi");
  if (!root) return;
  const tabs = root.querySelectorAll(".vahmF button, button.CNs9N");
  for (const btn of tabs) {
    const t = (btn.textContent || "").trim();
    const isCrypto = /крипт|crypto/i.test(t);
    const isCurrenciesTab =
      (t === "Валюты" || /^валюты$/i.test(t)) ||
      (/currenc/i.test(t) && !isCrypto) ||
      (/форекс|forex/i.test(t) && !isCrypto);
    if (isCurrenciesTab && !isCrypto) {
      btn.click();
      return;
    }
  }
}

function getAssetListRowsForAutoPick() {
  const legacy = document.querySelectorAll(".assets-table__item");
  if (legacy.length) {
    return { mode: "legacy", rows: Array.from(legacy) };
  }

  const listRoot =
    document.querySelector("div.yejPg") ||
    document.querySelector("#asset-select--button .yejPg") ||
    document.querySelector(".h9gji .yejPg");

  const r2Rows = listRoot
    ? Array.from(listRoot.querySelectorAll("div.R2Rgm")).filter(
        (row) =>
          row.querySelector("span.Z2fyK") &&
          row.querySelector("div.bQodW.mlvrU span")
      )
    : [];

  if (r2Rows.length) {
    return { mode: "r2rgm", rows: r2Rows };
  }

  const scope =
    document.querySelector("#asset-select--button .X0CLs") ||
    document.querySelector(".h9gji .X0CLs") ||
    document.querySelector(".X0CLs") ||
    document;
  const fzeRows = Array.from(scope.querySelectorAll("div.fZEV1")).filter(
    (row) =>
      row.querySelector(".iT3nV span") &&
      (row.querySelector(".dkV9n.U08B6 span") ||
        row.querySelector(".dkV9n span"))
  );
  return { mode: "fzev1", rows: fzeRows };
}

function assetRowPairName(row, mode) {
  if (mode === "legacy") {
    return row.querySelector(".assets-table__name span")?.textContent?.trim() || "";
  }
  if (mode === "r2rgm") {
    return row.querySelector("span.Z2fyK")?.textContent?.trim() || "";
  }
  return row.querySelector(".iT3nV span")?.textContent?.trim() || "";
}

function assetRowPayoutOneMin(row, mode) {
  let el;
  if (mode === "legacy") {
    el = row.querySelector(".payoutOne span");
  } else if (mode === "r2rgm") {
    el = row.querySelector("div.bQodW.mlvrU span");
  } else {
    el =
      row.querySelector(".dkV9n.U08B6 span") ||
      row.querySelectorAll(".dkV9n span")[0];
  }
  if (!el) return NaN;
  return parseInt(String(el.textContent).replace(/%/g, "").trim(), 10);
}

function clickAssetRowForSelect(row, mode) {
  if (mode === "legacy") {
    row.querySelector(".assets-table__name span")?.click();
    return;
  }
  if (mode === "r2rgm") {
    row.querySelector("div.teoXG")?.click() || row.click();
    return;
  }
  row.querySelector(".iT3nV")?.click() || row.click();
}

function isAssetSelectPanelOpen() {
  if (findAssetSelectCloseButton()) return true;
  return !!(
    document.querySelector("div.yejPg") ||
    document.querySelector("#asset-select--button .yejPg") ||
    document.querySelector(".h9gji .yejPg") ||
    document.querySelector("#asset-select--button .X0CLs") ||
    document.querySelector(".h9gji .X0CLs") ||
    document.querySelector("#asset-select--button .KGJWi") ||
    document.querySelector(".h9gji .KGJWi") ||
    document.querySelector(".h9gji") ||
    document.querySelector(".assets-table__item")
  );
}

function isVisibleClickable(el) {
  if (!el?.isConnected) return false;
  try {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const st = getComputedStyle(el);
    return st.display !== "none" && st.visibility !== "hidden";
  } catch (e) {
    return true;
  }
}

function findAssetSelectCloseButton() {
  const candidates = [];

  for (const btn of document.querySelectorAll("button")) {
    if (!isVisibleClickable(btn)) continue;

    const label = (btn.getAttribute("aria-label") || "").trim().toLowerCase();
    const hasCross = !!btn.querySelector("svg.icon-cross");
    const hasCloseClass =
      btn.classList.contains("WEqlX") || btn.classList.contains("EoTnC");

    if (label !== "close" && !hasCross && !hasCloseClass) continue;

    let score = 0;
    if (label === "close") score += 10;
    if (hasCross) score += 8;
    if (hasCloseClass) score += 6;
    if (btn.closest(".h9gji, div.yejPg, #asset-select--button")) score += 20;

    candidates.push({ btn, score });
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.btn || null;
}

function forceClickElement(el) {
  if (!el) return false;

  try {
    el.focus({ preventScroll: true });
  } catch (e) {
    /* ignore */
  }

  const svg = el.querySelector("svg.icon-cross");
  const targets = [el, svg].filter(Boolean);

  for (const target of targets) {
    try {
      target.click();
    } catch (e) {
      /* ignore */
    }
  }

  try {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const opts = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: cx,
      clientY: cy,
    };

    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      el.dispatchEvent(new MouseEvent(type, opts));
      if (typeof PointerEvent !== "undefined") {
        el.dispatchEvent(
          new PointerEvent(type, {
            ...opts,
            pointerId: 1,
            pointerType: "mouse",
            isPrimary: true,
          })
        );
      }
    }
  } catch (e) {
    /* ignore */
  }

  QbotDom.simulateClick(el);
  return true;
}

function clickAssetSelectCloseButton() {
  const btn = findAssetSelectCloseButton();
  if (!btn) return false;
  return forceClickElement(btn);
}

function getAssetSelectPanelRoot() {
  const yejPg =
    document.querySelector("div.yejPg") ||
    document.querySelector("#asset-select--button .yejPg") ||
    document.querySelector(".h9gji .yejPg");
  if (yejPg) {
    return yejPg.closest(".h9gji") || yejPg.parentElement || yejPg;
  }
  return (
    document.querySelector(".h9gji") ||
    document.querySelector("#asset-select--button") ||
    null
  );
}

function isInsideAssetPanel(el, panel) {
  if (!el || !panel) return false;
  return panel === el || panel.contains(el);
}

function dispatchClickAt(el, clientX, clientY) {
  if (!el) return;
  const opts = {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX,
    clientY,
  };
  el.dispatchEvent(new MouseEvent("mousedown", opts));
  el.dispatchEvent(new MouseEvent("mouseup", opts));
  el.dispatchEvent(new MouseEvent("click", opts));
}

function clickOutsideAssetSelectPanel() {
  const panel = getAssetSelectPanelRoot();

  const tryClickElement = (el) => {
    if (!el || isInsideAssetPanel(el, panel)) return false;
    if (el.closest?.("#qbot-header-dock, #qbot-trading-modal-root")) return false;
    QbotDom.simulateClick(el);
    return true;
  };

  for (const sel of [
    "canvas",
    '[class*="ChartPanel"]',
    '[class*="chart"]',
    "main",
    "#root",
  ]) {
    if (tryClickElement(document.querySelector(sel))) return true;
  }

  const w = window.innerWidth;
  const h = window.innerHeight;
  const points = [
    [w * 0.5, h * 0.72],
    [w * 0.5, h * 0.58],
    [w * 0.35, h * 0.62],
    [w * 0.65, h * 0.62],
    [w * 0.5, h * 0.45],
  ];

  for (const [x, y] of points) {
    const px = Math.round(x);
    const py = Math.round(y);
    let target = document.elementFromPoint(px, py);
    if (!target || isInsideAssetPanel(target, panel)) continue;
    if (target.closest?.("#qbot-header-dock, #qbot-trading-modal-root")) continue;

    dispatchClickAt(target, px, py);
    return true;
  }

  dispatchClickAt(document.body, Math.round(w * 0.5), Math.round(h * 0.72));
  return true;
}

function closeAssetSelectPanel() {
  if (clickAssetSelectCloseButton()) return;
  clickOutsideAssetSelectPanel();
}

function scheduleCloseAssetSelectPanel(afterMs) {
  const tryClose = () => {
    const btn = findAssetSelectCloseButton();
    if (btn) {
      forceClickElement(btn);
    } else {
      closeAssetSelectPanel();
    }
  };

  setTimeout(tryClose, afterMs);
  setTimeout(tryClose, afterMs + 600);
  setTimeout(() => {
    tryClose();
    console.log(
      isAssetSelectPanelOpen()
        ? "Окно выбора активов: не удалось закрыть автоматически."
        : "Окно выбора активов закрыто."
    );
  }, afterMs + 1400);
}

function pickTopPairsByPayout(rows, mode, limit = AUTO_PICK_MAX_PAIRS) {
  const seen = new Set();

  return rows
    .map((row) => ({
      row,
      pairName: assetRowPairName(row, mode),
      payout: assetRowPayoutOneMin(row, mode),
    }))
    .filter(({ pairName, payout }) => {
      if (!pairName || Number.isNaN(payout)) return false;
      if (/(\(OTC\)|\bOTC\b)/i.test(pairName)) return false;
      if (payout < AUTO_PICK_MIN_PAYOUT) return false;
      const key = pairName.replace(/\s+/g, " ").trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.payout - a.payout)
    .slice(0, limit);
}

function runAutoPickHighPayoutAssets(attempt = 0) {
  const addButton = findAssetSelectPlusButton();
  if (!addButton) {
    if (attempt < 20) {
      setTimeout(() => runAutoPickHighPayoutAssets(attempt + 1), 500);
      return;
    }
    console.error("Кнопка выбора актива (+) не найдена.");
    return;
  }
  console.log("Открываем список активов…");
  addButton.click();

  setTimeout(() => {
    trySelectCurrenciesTabInAssetPanel();
  }, 350);

  setTimeout(() => {
    const { mode, rows } = getAssetListRowsForAutoPick();
    if (!rows.length) {
      console.warn("Список активов пуст или ещё не загрузился.");
      scheduleCloseAssetSelectPanel(300);
      return;
    }

    const topPairs = pickTopPairsByPayout(rows, mode);
    if (!topPairs.length) {
      console.warn(
        `Нет пар с выплатой от ${AUTO_PICK_MIN_PAYOUT}% (UI: ${mode}, строк: ${rows.length}).`
      );
      scheduleCloseAssetSelectPanel(300);
      return;
    }

    console.log(
      `Топ-${topPairs.length} пар (${mode}):`,
      topPairs.map((p) => `${p.pairName} ${p.payout}%`).join(", ")
    );

    topPairs.forEach(({ row, pairName, payout }, index) => {
      setTimeout(() => {
        console.log(
          `✅ ${index + 1}/${topPairs.length}: ${pairName} — Profit 1+ min: ${payout}%`
        );
        clickAssetRowForSelect(row, mode);
      }, index * AUTO_PICK_CLICK_DELAY_MS);
    });

    scheduleCloseAssetSelectPanel(
      topPairs.length * AUTO_PICK_CLICK_DELAY_MS + 800
    );
  }, 2000);
}

/**
 * Баннер приветствия (старый Header-Banner или блок с welcome-banner-bg)
 */
function findWelcomeBannerElement() {
  const legacy = document.querySelector('[class*="Header-Banner"]');
  if (legacy) return legacy;

  const img = document.querySelector(
    'img[src*="welcome-banner-bg"], img[alt="welcome bonus"]'
  );
  if (img) {
    const pic = img.closest("picture");
    const root = pic?.parentElement;
    if (root?.querySelector("picture")) return root;
  }

  const source = document.querySelector('source[srcset*="welcome-banner-bg"]');
  if (source) {
    const pic = source.closest("picture");
    const root = pic?.parentElement;
    if (root) return root;
  }

  for (const el of document.querySelectorAll("div")) {
    if (!el.querySelector("picture")) continue;
    const t = el.textContent || "";
    if (
      t.includes("бонус") &&
      t.includes("депозит") &&
      /70\s*%/.test(t)
    ) {
      return el;
    }
  }
  return null;
}

// Основной класс бота
class TradingBot {
  constructor() {
    this.maxAttempts = 10;
    this.attempts = 0;
    this.isInitialized = false;
    /** React перерисовывает шапку — без этого слоган снова становится «Web Trading Platform» */
    this._sloganPersistenceStarted = false;
  }

  /** Наш блок Q-bot смонтирован в плавающий dock */
  _isQbotSloganMounted() {
    const men = document.getElementById("men");
    return isMenInDock(men) && document.body.contains(men);
  }

  updateSloganContent(menEl) {
    if (!menEl) return;
    const isVIP = storage["PD"] === "1";
    menEl.className = "hed";
    menEl.id = "men";
    if (isVIP) {
      menEl.innerHTML = "Q-bot <span id='vip'>VIP</span>";
    } else {
      menEl.textContent = "Q-bot FREE";
    }
  }

  mountQbotToDock() {
    cleanupInlineQbotMounts();
    removeQuotexSloganBlock();
    const dock = ensureHeaderDock();
    const men = dock.querySelector("#men");
    if (men) {
      this.updateSloganContent(men);
    } else {
      const isVIP = storage["PD"] === "1";
      dock.innerHTML = this.createSloganHTML(isVIP);
    }
    syncDockPosition();
    this.clearWelcomeBanner();
  }

  applySloganReplace() {
    this.mountQbotToDock();
  }

  clearWelcomeBanner() {
    const banner = findWelcomeBannerElement();
    if (banner && banner.innerHTML.trim()) banner.innerHTML = "";
  }

  _maintainHeaderPatches() {
    if (_qbotHeaderPatching) return;
    _qbotHeaderPatching = true;
    try {
      cleanupInlineQbotMounts();
      removeQuotexSloganBlock();

      const dock = getHeaderDock();
      const men = document.getElementById("men");
      if (!men || !dock || !dock.contains(men)) {
        this.mountQbotToDock();
        return;
      }

      this.updateSloganContent(men);
      syncDockPosition();
    } finally {
      _qbotHeaderPatching = false;
    }
  }

  ensureSloganPersistence() {
    if (this._sloganPersistenceStarted) return;
    this._sloganPersistenceStarted = true;

    const debounced = Utils.debounce(() => this._maintainHeaderPatches(), 500);

    const startMutationWatch = () => {
      const header =
        document.querySelector("header") ||
        document.querySelector('[class*="Header"]');
      if (!header || header.__QBOT_MO__) return;
      header.__QBOT_MO__ = true;

      const mo = new MutationObserver((mutations) => {
        if (isQbotOwnMutation(mutations)) return;
        debounced();
      });
      mo.observe(header, { childList: true, subtree: true });
    };

    setTimeout(startMutationWatch, 2500);

    window.addEventListener("resize", debounced, { passive: true });
    window.addEventListener("scroll", debounced, { passive: true });

    const attachResizeObserver = () => {
      const header =
        document.querySelector("header") ||
        document.querySelector('[class*="Header"]');
      if (!header || header.__QBOT_RO__) return;
      header.__QBOT_RO__ = true;
      try {
        new ResizeObserver(() => debounced()).observe(header);
      } catch (e) {
        /* ignore */
      }
    };
    setTimeout(attachResizeObserver, 2500);
    setTimeout(attachResizeObserver, 8000);

    setInterval(() => this._maintainHeaderPatches(), 8000);
  }

  /**
   * Инициализация DOM
   */
  async initializeDOM() {
    if (this.isInitialized) return;
    this.isInitialized = true;

    try {
      if (document.readyState === "loading") {
        await new Promise((resolve) =>
          document.addEventListener("DOMContentLoaded", resolve, { once: true })
        );
      }

      await waitForPageSettled();
      this.clearWelcomeBanner();
      await this.setupSlogan();
      this.ensureSloganPersistence();
      this.setupEventListeners();
    } catch (error) {
      console.error("Ошибка инициализации DOM:", error);
    }
  }

  /**
   * Обновление слогана
   */
  async setupSlogan() {
    try {
      cleanupInlineQbotMounts();
      this.mountQbotToDock();
    } catch (error) {
      console.warn("Q-bot dock не установлен:", error.message);
      this.mountQbotToDock();
    }
  }

  /**
   * Генерация HTML для слогана
   * @param {boolean} isVIP
   * @returns {string}
   */
  createSloganHTML(isVIP) {
    const version = isVIP
      ? "<b id='men' class='hed'>Q-bot <span id='vip'>VIP</span></b>"
      : "<b id='men' class='hed'>Q-bot FREE</b>";

    return `
      ${version}<span class='hid'>
      <span class=''>Started</span>
      <span class='blink '> | ◉ | </span>
      <span class=''>Profit:</span>
      <span class='' id='resbalance'>0</span> |
      <span class='log'></span>
      <button class='stop-button ' id='stop' style='font-size: 12px; padding: 5px;'>STOP ROBOT</button></span>
    `;
  }

  /**
   * Настройка обработчиков событий с делегированием
   */
  setupEventListeners() {
    if (typeof window !== "undefined" && window.__QBOT_PANEL_CLICK_SETUP__) {
      return;
    }
    if (typeof window !== "undefined") {
      window.__QBOT_PANEL_CLICK_SETUP__ = true;
    }

    let lastPanelOpen = 0;
    const handleOpenPanel = () => {
      const now = Date.now();
      if (now - lastPanelOpen < 450) return;
      lastPanelOpen = now;
      const panel = document.querySelector(SELECTORS.PANEL_BOT);
      if (panel) {
        createTradingBotModal();
        this.clearWelcomeBanner();
      }
    };

    document.addEventListener(
      "click",
      (e) => {
        let el = e.target;
        if (el && el.nodeType !== Node.ELEMENT_NODE) {
          el = el.parentElement;
        }
        if (!el || !el.closest) return;
        if (
          el.matches(SELECTORS.PANEL_BOT) ||
          el.closest(SELECTORS.PANEL_BOT)
        ) {
          handleOpenPanel();
        }
      },
      true
    );

    // --- 2. Обработчик кнопки "STOP" ---
    const handleStop = () => {
      localStorage.setItem("statusbot", "notwork");
      location.reload();
    };

    // Используем делегирование для кнопки (на случай, если она пересоздаётся)
    document.addEventListener("click", (e) => {
      if (e.target.matches(SELECTORS.STOP_BUTTON)) {
        handleStop();
      }
    });
  }

  /**
   * Получение ID пользователя
   * @returns {Promise<string|null>}
   */
  async getUserId() {
    if (this.attempts >= this.maxAttempts) {
      console.error("Превышено максимальное количество попыток получения ID.");
      return null;
    }

    this.attempts++;
    try {
      let userId = QbotDom.extractUserIdFromPage();
      let userMenu = null;

      if (!userId) {
        userMenu = await QbotDom.waitForUserMenu(TIMEOUTS.USER_MENU_TIMEOUT);
        const clickTarget =
          QbotDom.findUserMenu() ||
          QbotDom.pickClickable(userMenu) ||
          userMenu;
        QbotDom.simulateClick(clickTarget);
        await Utils.delay(350);

        userId = await waitForUserIdAfterMenuOpen(
          TIMEOUTS.DROPDOWN_TIMEOUT
        );
        if (!userId) {
          throw new Error("ID пользователя не найден в dropdown");
        }

        QbotDom.simulateClick(
          QbotDom.findUserMenu() ||
            QbotDom.pickClickable(userMenu) ||
            userMenu
        );
        await Utils.delay(150);
      }

      console.log("ID пользователя:", userId);
      localStorage.setItem("userID", userId);
      QbotDom.closeAllPairTabs();

      //------------------Автовыбор пар (старая таблица / новый UI fZEV1) --------------------
      runAutoPickHighPayoutAssets();

      //-----------------------------------------------------

      await this.syncUserData(userId);
      this.attempts = 0; // Сброс при успехе
      return userId;
    } catch (error) {
      console.warn(
        `Попытка ${this.attempts} получения ID не удалась:`,
        error.message
      );
      const delay = Math.min(
        TIMEOUTS.RETRY_DELAY * Math.pow(1.5, this.attempts),
        TIMEOUTS.MAX_RETRY_DELAY
      );
      await Utils.delay(delay);
      return this.getUserId();
    }
  }

  /**
   * Разбор ответа user.php.
   * NO = БД сервера временно недоступна (не менять PD).
   * @param {string} raw
   * @returns {{ dostup?: string } | null}
   */
  parseSyncUserResponse(raw) {
    const trimmed = String(raw ?? "").trim();
    if (!trimmed) return null;

    const tryParseJson = (text) => {
      try {
        return JSON.parse(text);
      } catch (e) {
        return null;
      }
    };

    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      return tryParseJson(trimmed);
    }

    const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = tryParseJson(jsonMatch[0]);
      if (parsed) return parsed;
    }

    const dostupMatch = trimmed.match(/"dostup"\s*:\s*"?([01])"?/i);
    if (dostupMatch) {
      return { dostup: dostupMatch[1] };
    }

    if (/^yes$|^vip$|^1$/i.test(trimmed)) {
      return { dostup: "1" };
    }

    // NO = БД сервера недоступна — статус VIP не обновляем
    if (/^no$/i.test(trimmed)) {
      return null;
    }

    return null;
  }

  restoreVipFromLocalStorage() {
    try {
      const stored = JSON.parse(localStorage.getItem("qbot_settings") || "{}");
      if (stored.PD != null && String(stored.PD) !== String(storage["PD"])) {
        storage["PD"] = String(stored.PD);
        return true;
      }
    } catch (e) {
      /* ignore */
    }
    return false;
  }

  /**
   * Синхронизация данных пользователя
   * @param {string} userId
   */
  async syncUserData(userId, retryCount = 0) {
    const MAX_RETRIES = 3;
    try {
      const response = await fetch(ENDPOINTS.SYNC_USER(userId));
      if (!response.ok) {
        throw new Error(`Ошибка сети: ${response.status}`);
      }

      const raw = await response.text();
      const data = this.parseSyncUserResponse(raw);

      if (!data) {
        if (/^no$/i.test(String(raw).trim())) {
          const restored = this.restoreVipFromLocalStorage();
          if (restored) {
            await this.setupSlogan();
          }

          if (retryCount < MAX_RETRIES) {
            console.warn(
              `Синхронизация: БД сервера недоступна (NO). Повтор через 5 c (${retryCount + 1}/${MAX_RETRIES})…`
            );
            await Utils.delay(5000);
            return this.syncUserData(userId, retryCount + 1);
          }

          console.warn(
            "Синхронизация: БД сервера недоступна (NO). Используем сохранённый PD=",
            storage["PD"]
          );
          return;
        }

        if (String(raw).trim()) {
          console.warn(
            "Синхронизация: не удалось разобрать ответ:",
            String(raw).trim().slice(0, 120)
          );
        }
        return;
      }

      if (data.dostup != null) {
        const oldDostup = storage["PD"];
        const newDostup = String(data.dostup);

        storage["PD"] = newDostup;
        if (typeof saveStorage === "function") {
          saveStorage(storage);
        }
        if (newDostup !== oldDostup) {
          await this.setupSlogan();
        }
        console.log("Синхронизация VIP:", newDostup === "1" ? "VIP" : "FREE");
      }
    } catch (error) {
      if (retryCount >= MAX_RETRIES) {
        console.warn(
          "Ошибка синхронизации данных (лимит попыток):",
          error.message
        );
        return;
      }
      console.warn("Ошибка синхронизации данных:", error.message);
      await Utils.delay(3000);
      return this.syncUserData(userId, retryCount + 1);
    }
  }

  /**
   * Получение и сохранение начального баланса
   * @returns {Promise<number>}
   */
  async getBalance() {
    try {
      const balanceElement = await waitForBalanceElement(
        TIMEOUTS.BALANCE_TIMEOUT
      );
      const balanceText = balanceElement.textContent;

      console.log("Исходный баланс:", balanceText);
      const cleanBalance = Utils.cleanBalance(balanceText);
      console.log("Очищенный баланс:", cleanBalance);

      localStorage.setItem("startBalance", cleanBalance.toString());
      return cleanBalance;
    } catch (error) {
      console.error("Ошибка получения баланса:", error.message);
      return 0;
    }
  }

  /**
   * Основной метод запуска бота
   */
  async start() {
    console.log("Запуск торгового бота...");

    try {
      await Utils.delay(TIMEOUTS.INIT_DOM);
      await this.initializeDOM();

      await Utils.delay(TIMEOUTS.GET_USER_ID - TIMEOUTS.INIT_DOM);
      await this.getUserId();

      await Utils.delay(TIMEOUTS.GET_BALANCE - TIMEOUTS.GET_USER_ID);
      await this.getBalance();
    } catch (error) {
      console.error("Критическая ошибка запуска бота:", error);
    }
  }
}

// Запуск бота
const bot = new TradingBot();
bot.start();
