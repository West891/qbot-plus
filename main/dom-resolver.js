/**
 * QbotDom — устойчивый поиск элементов Quotex.
 * Стратегии: семантика → текст/структура → зона экрана → CSS (fallback).
 * Опциональный override: localStorage "qbot_dom_config" = { profiles: { balance: { selectors: [...] } } }
 */
(function initQbotDom(global) {
  const CONFIG_KEY = "qbot_dom_config";
  const SLOGAN_TEXT = "Web Trading Platform";

  const DEFAULT_SELECTORS = {
    balance: [
      "div.Zt1hG",
      ".Zt1hG",
      "div.qKWSR .Zt1hG",
      ".rymiA .Zt1hG",
      '[class*="infoBalance"]',
      ".rymiA .pVBHU",
      "div.PiLdZ .pVBHU",
      ".PiLdZ .pVBHU",
    ],
    pairTab: [
      "div.OK1xf div.Q02Z1 > div.dJ15T",
      "div.Q02Z1 > div.dJ15T",
      "div.dJ15T.vXMlv",
      ".ifu_i .qIU4o div.pPomf",
      ".qIU4o > div.pPomf",
      "div.ifu_i div.qIU4o > div.pPomf",
    ],
    pairName: [".WRocw", ".l5ftG"],
    pairClick: [".ZyIJD", ".H4wMV", ".WRocw", ".rKkq0", ".TinoG", ".ApFHy"],
    tradesCount: ["div.XWEvH", ".XWEvH", "div.fs593", ".TU4aa"],
    userMenu: [
      "div.qKWSR",
      "div.rymiA div.PiLdZ",
      "div.PiLdZ",
      '[class*="Usermenu-styles-module__infoCaret"]',
    ],
    pairTabClose: ["div.dJ15T .LtauB", "svg.icon-close-tiny"],
  };

  function getExternalProfile(name) {
    try {
      const cfg = JSON.parse(localStorage.getItem(CONFIG_KEY) || "null");
      return cfg?.profiles?.[name] || null;
    } catch (e) {
      return null;
    }
  }

  function selectorsFor(name) {
    const ext = getExternalProfile(name)?.selectors;
    if (Array.isArray(ext) && ext.length) {
      return [...ext, ...(DEFAULT_SELECTORS[name] || [])];
    }
    return DEFAULT_SELECTORS[name] || [];
  }

  function normalizeText(text) {
    return String(text ?? "")
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    try {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return false;
      const st = getComputedStyle(el);
      return (
        st.visibility !== "hidden" &&
        st.display !== "none" &&
        Number(st.opacity) > 0
      );
    } catch (e) {
      return true;
    }
  }

  function inZone(el, zone) {
    try {
      const r = el.getBoundingClientRect();
      const w = window.innerWidth;
      if (zone === "headerRight") return r.top < 140 && r.left > w * 0.52;
      if (zone === "sidebar") return r.left > w * 0.45;
      if (zone === "headerLeft") return r.top < 120 && r.left < w * 0.45;
      return true;
    } catch (e) {
      return true;
    }
  }

  function looksLikeBalance(text) {
    const t = String(text ?? "").trim();
    if (t.length < 2 || t.length > 28 || /^ID:/i.test(t)) return false;
    return (
      /^[\$€₽₹£₸]?\s*[\d\s,.]+\s*[\$€₽₹£₸]?$/.test(t) && /\d/.test(t)
    );
  }

  function isSloganText(text) {
    return normalizeText(text) === normalizeText(SLOGAN_TEXT);
  }

  function parseCount(text) {
    const n = parseInt(String(text ?? "").replace(/\D/g, ""), 10);
    return Number.isFinite(n) ? n : null;
  }

  function parseUserId(text) {
    const m = String(text ?? "").match(/ID:\s*(\d{4,})/i);
    return m ? m[1] : null;
  }

  function extractNumbers6Plus(text) {
    const m = text?.match(/\d{6,}/);
    return m ? m[0] : null;
  }

  function getPairTabName(tabEl) {
    if (!tabEl) return "";
    for (const sel of selectorsFor("pairName")) {
      const t = tabEl.querySelector(sel)?.textContent?.trim();
      if (t && t.includes("/")) return t.replace(/\s+/g, " ");
    }
    for (const el of tabEl.querySelectorAll("div, span")) {
      if (el.childElementCount > 0) continue;
      const t = el.textContent?.trim() || "";
      if (/\//.test(t) && t.length >= 3 && t.length < 40) {
        return t.replace(/\s+/g, " ");
      }
    }
    if (tabEl.id && tabEl.id !== "tab-active" && tabEl.id.includes("/")) {
      return tabEl.id.trim().replace(/\s+/g, " ");
    }
    return "";
  }

  function isValidPairTab(el) {
    const name = getPairTabName(el);
    if (!name || name.length < 3 || !/\//.test(name)) return false;
    try {
      const r = el.getBoundingClientRect();
      return r.width > 8 && r.height > 8;
    } catch (e) {
      return true;
    }
  }

  function isPairTabActive(tab) {
    if (tab.id === "tab-active") return true;
    if (tab.classList.contains("AmO6b")) return true;
    if (tab.getAttribute("aria-selected") === "true") return true;
    if (tab.classList.contains("active")) return true;
    return !!tab.matches?.("[data-state='active']");
  }

  function getPairTabClickTarget(tabEl) {
    for (const sel of selectorsFor("pairClick")) {
      const el = tabEl.querySelector(sel);
      if (el) return el;
    }
    return tabEl;
  }

  function normalizePairSymbol(raw, otcMode) {
    let t = String(raw ?? "")
      .replace(/\s*\(OTC\)\s*/gi, "")
      .replace(/\//g, "")
      .replace(/\s+/g, "")
      .toUpperCase();
    if (otcMode === "ON" && t.length > 6) t = t.slice(0, 6);
    return t;
  }

  function isAccountHeaderBlock(el) {
    if (!el) return false;
    const bal = findBalance();
    if (bal && (el === bal || el.contains(bal) || bal.contains(el))) return true;
    if (el.closest("div.qKWSR, [class*='Usermenu']")) return true;
    const txt = el.textContent || "";
    if (/demo\s*account|live\s*account|демо|реал/i.test(txt)) return true;
    return inZone(el, "headerRight");
  }

  function pickClickable(container) {
    if (!container) return null;
    for (const sel of [
      "button",
      "[role='button']",
      "a[href]",
      "svg.icon-caret",
      ".icon-caret",
    ]) {
      const el = container.querySelector(sel);
      if (!el) continue;
      const target = el.closest("button, a, [role='button']") || el;
      if (isVisible(target)) return target;
    }
    if (isVisible(container)) return container;
    const parent = container.parentElement;
    if (parent && isVisible(parent) && parent.querySelector("svg, .icon-caret, img")) {
      return parent;
    }
    return container;
  }

  function simulateClick(el) {
    if (!el) return;
    try {
      el.click();
    } catch (e) {
      /* ignore */
    }
    const opts = { bubbles: true, cancelable: true, view: global };
    el.dispatchEvent(new MouseEvent("mousedown", opts));
    el.dispatchEvent(new MouseEvent("mouseup", opts));
    el.dispatchEvent(new MouseEvent("click", opts));
  }

  // ——— Strategies ———

  function strategySelectors(list, validate) {
    for (const sel of list) {
      const el = document.querySelector(sel);
      if (el && (!validate || validate(el))) return el;
    }
    return null;
  }

  function strategySelectorsAll(list, validate) {
    const seen = new Set();
    const out = [];
    for (const sel of list) {
      for (const el of document.querySelectorAll(sel)) {
        if (seen.has(el)) continue;
        if (validate && !validate(el)) continue;
        seen.add(el);
        out.push(el);
      }
    }
    return out;
  }

  function findBalance() {
    for (const sel of selectorsFor("balance")) {
      const el = document.querySelector(sel);
      if (el && looksLikeBalance(el.textContent) && isVisible(el)) return el;
      if (el && /\d/.test(el.textContent || "") && isVisible(el)) return el;
    }
    for (const el of document.querySelectorAll("div, span")) {
      if (!isVisible(el) || el.childElementCount > 0) continue;
      if (!inZone(el, "headerRight") && !inZone(el, "sidebar")) continue;
      if (looksLikeBalance(el.textContent)) return el;
    }
    return null;
  }

  function findSlogan() {
    const legacy = document.querySelector('[class*="Header-styles-module__slogan"]');
    if (legacy && !isAccountHeaderBlock(legacy)) return legacy;

    const candidates = [];
    for (const el of document.querySelectorAll("div, span, p")) {
      if (!isVisible(el) || el.childElementCount > 0) continue;
      if (!isSloganText(el.textContent)) continue;
      if (isAccountHeaderBlock(el)) continue;
      candidates.push(el);
    }
    if (!candidates.length) return null;
    candidates.sort(
      (a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left
    );
    return candidates[0];
  }

  function isQuotexSloganTarget(el) {
    const dock = document.getElementById("qbot-header-dock");
    if (!el || !el.isConnected || dock?.contains(el)) return false;
    if (el.closest?.("#qbot-header-dock") || el.id === "men") return false;
    if (isAccountHeaderBlock(el)) return false;
    if (el.getAttribute?.("data-qbot-slogan-hidden") === "1") return false;

    const hasLegacyClass = !!el.matches?.(
      '[class*="Header-styles-module__slogan"]'
    );
    if (!hasLegacyClass && !inZone(el, "headerLeft")) return false;
    if (!isSloganText(el.textContent)) return false;
    if (el.childElementCount > 1) return false;

    try {
      const r = el.getBoundingClientRect();
      if (r.height > 48 || r.width > 320) return false;
    } catch (e) {
      return false;
    }

    return true;
  }

  function collectSloganElements() {
    const found = new Set();
    for (const el of document.querySelectorAll(
      '[class*="Header-styles-module__slogan"], div, span, p'
    )) {
      if (isQuotexSloganTarget(el)) found.add(el);
    }
    return Array.from(found);
  }

  /** Скрывает слоган Quotex без удаления из DOM (безопасно для React) */
  function hideQuotexSlogan() {
    for (const el of collectSloganElements()) {
      el.setAttribute("data-qbot-slogan-hidden", "1");
      el.style.setProperty("display", "none", "important");
      el.style.setProperty("visibility", "hidden", "important");
      el.style.setProperty("width", "0", "important");
      el.style.setProperty("height", "0", "important");
      el.style.setProperty("overflow", "hidden", "important");
      el.style.setProperty("pointer-events", "none", "important");
    }
  }

  function removeQuotexSlogan() {
    hideQuotexSlogan();
  }

  /** Точка монтирования Q-BOT: слоган → header → левый блок шапки */
  function findHeaderMountPoint() {
    const slogan = findSlogan();
    if (slogan) return slogan;

    const selectors = [
      "header",
      '[class*="Header-styles-module"]',
      '[class*="Header"]',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && isVisible(el) && !isAccountHeaderBlock(el)) {
        try {
          const r = el.getBoundingClientRect();
          if (r.top < 180 && r.left < global.innerWidth * 0.65) return el;
        } catch (e) {
          return el;
        }
      }
    }

    for (const el of document.querySelectorAll("div, nav")) {
      if (!isVisible(el)) continue;
      try {
        const r = el.getBoundingClientRect();
        if (r.top > 140 || r.left > global.innerWidth * 0.55) continue;
        if (r.height < 24 || r.height > 120 || r.width < 80) continue;
        if (el.querySelector("img, svg, picture") && !isAccountHeaderBlock(el)) {
          return el;
        }
      } catch (e) {
        /* ignore */
      }
    }

    return null;
  }

  /** Якорь для позиционирования плавающего dock (логотип / левая часть шапки) */
  function findHeaderAnchor() {
    const logoSelectors = [
      "header img",
      "header svg",
      "header picture",
      '[class*="Header"] img',
      '[class*="Header"] svg',
      '[class*="logo"] img',
      '[class*="logo"] svg',
    ];
    for (const sel of logoSelectors) {
      for (const el of document.querySelectorAll(sel)) {
        if (!isVisible(el) || isAccountHeaderBlock(el)) continue;
        try {
          const r = el.getBoundingClientRect();
          if (r.top < 180 && r.left < global.innerWidth * 0.55 && r.width > 8) {
            return el.closest("a, button, div, header") || el;
          }
        } catch (e) {
          return el;
        }
      }
    }

    for (const el of document.querySelectorAll("div, nav, header")) {
      if (!isVisible(el) || isAccountHeaderBlock(el)) continue;
      try {
        const r = el.getBoundingClientRect();
        if (r.top > 140 || r.left > global.innerWidth * 0.55) continue;
        if (r.height < 24 || r.height > 120 || r.width < 40) continue;
        if (el.querySelector("img, svg, picture")) return el;
      } catch (e) {
        /* ignore */
      }
    }

    const selectors = [
      "header",
      '[class*="Header-styles-module"]',
      '[class*="Header"]',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && isVisible(el) && !isAccountHeaderBlock(el)) {
        try {
          const r = el.getBoundingClientRect();
          if (r.top < 180 && r.left < global.innerWidth * 0.65) return el;
        } catch (e) {
          return el;
        }
      }
    }

    return null;
  }

  function isSafeSloganLeaf(container) {
    if (!container || isAccountHeaderBlock(container)) return false;
    if (isSloganText(container.textContent)) return true;
    if (container.childElementCount === 0) {
      return !!container.matches?.('[class*="Header-styles-module__slogan"]');
    }
    return container.childElementCount <= 1 && isSloganText(container.textContent);
  }

  function findUserMenuFromQKWSR() {
    for (const el of document.querySelectorAll("div.qKWSR")) {
      const inner = pickClickable(el);
      if (inner && isVisible(inner)) return inner;
      let node = el.parentElement;
      for (let d = 0; node && d < 6; d++, node = node.parentElement) {
        if (!isVisible(node)) continue;
        const clickable = pickClickable(node);
        if (clickable && isVisible(clickable)) return clickable;
        if (
          node.querySelector("svg.icon-caret, svg, img") ||
          /demo|live|account|аккаунт|демо|id:/i.test(node.textContent || "")
        ) {
          return node;
        }
      }
    }
    return document.querySelector("div.qKWSR")?.parentElement || null;
  }

  function findUserMenu() {
    const legacy = document.querySelector(
      '[class*="Usermenu-styles-module__infoCaret"]:not([class*="Dropdown"])'
    );
    if (legacy && isVisible(legacy)) return legacy;

    const qk = findUserMenuFromQKWSR();
    if (qk) return qk;

    const row =
      document.querySelector("div.rymiA div.PiLdZ") ||
      document.querySelector("div.PiLdZ");
    if (row && row.querySelector("svg.icon-caret, .icon-caret") && isVisible(row)) {
      return row;
    }

    for (const caret of document.querySelectorAll("svg.icon-caret, .icon-caret")) {
      const block = caret.closest(
        "div.rymiA, div.PiLdZ, div.qKWSR, [class*='Usermenu']"
      );
      if (!block || !isVisible(block)) continue;
      const rect = block.getBoundingClientRect();
      if (rect.top < 140 && rect.left > global.innerWidth * 0.4) {
        return pickClickable(block) || block;
      }
    }
    return strategySelectors(selectorsFor("userMenu"), (el) => isVisible(el));
  }

  function extractUserIdFromPage() {
    const scopes = [
      document.querySelector('[class*="Usermenu"]'),
      document.querySelector("div.qKWSR")?.closest("div"),
      document.querySelector("div.rymiA"),
      document.querySelector("header"),
    ].filter(Boolean);

    for (const scope of scopes) {
      for (const el of scope.querySelectorAll("span, div, p, li")) {
        const t = el.textContent?.trim() || "";
        if (t.length > 50) continue;
        const id = parseUserId(t);
        if (id && isVisible(el)) return id;
      }
    }
    return null;
  }

  function extractUserIdFromOpenMenu() {
    const legacy = document.querySelector('[class*="Usermenu-Dropdown"]');
    if (legacy) {
      const id = parseUserId(legacy.textContent) || extractNumbers6Plus(legacy.textContent);
      if (id) return id;
    }

    for (const menu of document.querySelectorAll(
      '[class*="Dropdown"], [class*="dropdown"], [role="menu"], .AishB'
    )) {
      if (!isVisible(menu)) continue;
      const id = parseUserId(menu.textContent);
      if (id) return id;
    }

    for (const span of document.querySelectorAll("span.X0cBl, .AishB span, .O_1r7")) {
      const id = parseUserId(span.textContent);
      if (id && isVisible(span)) return id;
    }

    for (const el of document.querySelectorAll("span, div, p, li")) {
      if (!isVisible(el)) continue;
      const t = el.textContent?.trim() || "";
      if (t.length > 60) continue;
      const id = parseUserId(t);
      if (id) return id;
    }
    return null;
  }

  function isTradesCounterContext(el) {
    let node = el;
    for (let d = 0; node && d < 10; d++, node = node.parentElement) {
      const t = (node.textContent || "").trim();
      if (t.length > 0 && t.length < 180 && /trades|сделк/i.test(t)) return true;
    }
    return inZone(el, "sidebar");
  }

  function getOpenTradesCount() {
    for (const sel of selectorsFor("tradesCount")) {
      for (const badge of document.querySelectorAll(sel)) {
        const count = parseCount(badge.textContent);
        if (count === null) continue;
        if (isTradesCounterContext(badge)) return count;
      }
    }

    const sidebarBadges = Array.from(
      document.querySelectorAll("div, span")
    ).filter((badge) => {
      const t = (badge.textContent || "").trim();
      if (!/^\d+$/.test(t)) return false;
      try {
        const r = badge.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.left > global.innerWidth * 0.45;
      } catch (e) {
        return false;
      }
    });
    if (sidebarBadges.length) {
      sidebarBadges.sort(
        (a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top
      );
      const c = parseCount(sidebarBadges[0].textContent);
      if (c !== null) return c;
    }

    for (const block of document.querySelectorAll("div.Ih8nc.xpiuY, div.xpiuY.Ih8nc")) {
      const head = block.querySelector(":scope > div:not(.fs593)");
      if (!/^(trades|сделк)/i.test((head?.textContent || "").trim())) continue;
      const badge = block.querySelector(":scope > div.fs593");
      const c = parseCount(badge?.textContent);
      if (c !== null) return c;
    }

    for (const row of document.querySelectorAll("div.xdogH")) {
      for (const d of row.querySelectorAll(":scope > div")) {
        if (d.classList.contains("TU4aa")) continue;
        if (!/^(сделк|trades)/i.test((d.textContent || "").trim())) continue;
        const c = parseCount(row.querySelector(".TU4aa")?.textContent);
        if (c !== null) return c;
      }
    }
    return null;
  }

  function strategyStructuralPairTabs() {
    const seen = new Set();
    const tabs = [];
    for (const close of document.querySelectorAll("svg.icon-close-tiny")) {
      const tab = close.closest("div[id], div[class]");
      if (!tab || seen.has(tab) || !isValidPairTab(tab)) continue;
      seen.add(tab);
      tabs.push(tab);
    }
    return tabs;
  }

  function collectPairTabs() {
    let tabs = strategySelectorsAll(selectorsFor("pairTab"), isValidPairTab);
    if (!tabs.length) tabs = strategyStructuralPairTabs();

    const byKey = new Map();
    for (const el of tabs) {
      const key = getPairTabName(el);
      if (key && !byKey.has(key)) byKey.set(key, el);
    }
    const uniq = Array.from(byKey.values());
    if (uniq.length) return uniq;

    return Array.from(document.querySelectorAll('[class*="__label--"]')).filter(
      (el) => {
        const t = el.textContent.trim();
        return t.length >= 2 && /\//.test(t) && isVisible(el);
      }
    );
  }

  function findTradeDirectionButton(direction) {
    const isUp = direction === "UP";
    const legacy = document.querySelector(isUp ? ".call-btn" : ".put-btn");
    if (legacy) return legacy;

    const root =
      document.getElementById("trade-button") ||
      document.querySelector("div#trade-button.VVihH");
    if (!root) return null;

    if (isUp) {
      return (
        root.querySelector(".button--success") ||
        root.querySelector(".icon-arrow-up-circle")?.closest("button") ||
        Array.from(root.querySelectorAll("button")).find((btn) =>
          /выше|higher|вверх|up\b/i.test((btn.textContent || "").trim())
        ) ||
        root.querySelector("button")
      );
    }
    return (
      root.querySelector(".button--danger") ||
      root.querySelector(".icon-arrow-down-circle")?.closest("button") ||
      Array.from(root.querySelectorAll("button")).find((btn) =>
        /ниже|lower|вниз|down\b/i.test((btn.textContent || "").trim())
      ) ||
      root.querySelectorAll("button")[1] ||
      null
    );
  }

  function isDemoAccount() {
    if (document.querySelectorAll('[class*="Usermenu-styles-module__demo"]').length) {
      return true;
    }
    if (
      document.querySelector(
        'a.qaCEm.active[href*="demo"], a[aria-current="page"][href*="demo"]'
      )
    ) {
      return true;
    }
    const lbl = document.querySelector(".PiLdZ .SfrTV, ._58LeE .SfrTV");
    if (lbl && /демо/i.test(lbl.textContent || "")) return true;
    const header = document.querySelector("header") || document.body;
    return /demo\s*account/i.test(header.textContent || "");
  }

  function queryPairTabsForSymbol(symbol) {
    const want = normalizePairSymbol(symbol, getQbotSettingsOtc());
    return collectPairTabs().filter(
      (tab) => normalizePairSymbol(getPairTabName(tab), getQbotSettingsOtc()) === want
    );
  }

  function getQbotSettingsOtc() {
    try {
      const raw = localStorage.getItem("qbot_settings");
      if (raw) return JSON.parse(raw)["deal-otc"] === "ON" ? "ON" : "OFF";
    } catch (e) {
      /* ignore */
    }
    return "OFF";
  }

  function isActivePairTabMatchingSymbol(symbol) {
    const want = normalizePairSymbol(symbol, getQbotSettingsOtc());
    if (!want || want.length < 2) return true;

    const matching = queryPairTabsForSymbol(symbol);
    if (!matching.length) return true;
    if (matching.some(isPairTabActive)) return true;
    if (matching.length === 1) return true;
    return false;
  }

  function hasFloatingProfitLossOpenIndicator() {
    for (const el of document.querySelectorAll(
      "div.Pdqth.sdC5F, div.sdC5F.Pdqth"
    )) {
      const t = (el.textContent || "").trim().replace(/\s+/g, " ");
      if (/^[+-]\s*[\d.,]+(\s*[$€₽₹£₸])?$/i.test(t)) return true;
    }
    return false;
  }

  function hasOpenTradesPreventingNewDeal() {
    const c = getOpenTradesCount();
    if (c !== null && c > 0) return true;
    if (hasFloatingProfitLossOpenIndicator()) return true;
    return false;
  }

  function closeAllPairTabs() {
    for (const sel of [
      ...selectorsFor("pairTabClose"),
      ".---react-pages-TradePage-components-ChartPanel-TopCorner-Tabs-Tab-styles-module__close--Whknt",
    ]) {
      document.querySelectorAll(sel).forEach((btn) => {
        try {
          (btn.closest("button") || btn).click();
        } catch (e) {
          /* ignore */
        }
      });
    }
  }

  const RESOLVERS = {
    balance: findBalance,
    slogan: findHeaderMountPoint,
    userMenu: findUserMenu,
    openTradesCount: getOpenTradesCount,
    pairTabs: collectPairTabs,
    tradeButtonUp: () => findTradeDirectionButton("UP"),
    tradeButtonDown: () => findTradeDirectionButton("DOWN"),
  };

  function resolve(profileName) {
    const fn = RESOLVERS[profileName];
    if (!fn) {
      console.warn("[QbotDom] Неизвестный профиль:", profileName);
      return null;
    }
    const result = fn();
    if (result == null && profileName !== "openTradesCount") {
      console.debug("[QbotDom] Не найден:", profileName);
    }
    return result;
  }

  function resolveAll(profileName) {
    if (profileName === "pairTabs") return collectPairTabs();
    const one = resolve(profileName);
    return one ? [one] : [];
  }

  function waitFor(profileName, timeout = 8000) {
    return new Promise((resolve, reject) => {
      const tryFind = () => {
        if (profileName === "openTradesCount") {
          const c = getOpenTradesCount();
          return c !== null ? c : null;
        }
        if (profileName === "pairTabs") {
          const tabs = collectPairTabs();
          return tabs.length ? tabs : null;
        }
        return RESOLVERS[profileName]?.() ?? null;
      };

      const existing = tryFind();
      if (existing != null) return resolve(existing);

      const observer = new MutationObserver(() => {
        const el = tryFind();
        if (el != null) {
          observer.disconnect();
          clearTimeout(tid);
          resolve(el);
        }
      });

      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true,
      });

      const tid = setTimeout(() => {
        observer.disconnect();
        const el = tryFind();
        if (el != null) resolve(el);
        else reject(new Error(`[QbotDom] ${profileName} не найден за ${timeout}мс`));
      }, timeout);
    });
  }

  function waitForUserMenu(timeout = 12000) {
    return new Promise((resolve, reject) => {
      const tryFind = () => findUserMenu() || document.querySelector("div.qKWSR");
      const existing = tryFind();
      if (existing) return resolve(existing);

      const observer = new MutationObserver(() => {
        const el = tryFind();
        if (el) {
          observer.disconnect();
          clearTimeout(tid);
          resolve(el);
        }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
      const tid = setTimeout(() => {
        observer.disconnect();
        const el = tryFind();
        if (el) resolve(el);
        else reject(new Error("Меню пользователя не найдено"));
      }, timeout);
    });
  }

  function applyRemoteConfig(config) {
    if (config && typeof config === "object") {
      localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    }
  }

  global.QbotDom = {
    resolve,
    resolveAll,
    waitFor,
    waitForUserMenu,
    applyRemoteConfig,
    isVisible,
    looksLikeBalance,
    isSloganText,
    isSafeSloganLeaf,
    isAccountHeaderBlock,
    parseUserId,
    extractUserIdFromPage,
    extractUserIdFromOpenMenu,
    extractNumbers6Plus,
    getPairTabName,
    getPairTabClickTarget,
    isValidPairTab,
    isPairTabActive,
    normalizePairSymbol,
    isActivePairTabMatchingSymbol,
    collectPairTabs,
    getOpenTradesCount,
    hasOpenTradesPreventingNewDeal,
    hasFloatingProfitLossOpenIndicator,
    findTradeDirectionButton,
    isDemoAccount,
    findBalance,
    findSlogan,
    collectSloganElements,
    hideQuotexSlogan,
    removeQuotexSlogan,
    findHeaderMountPoint,
    findHeaderAnchor,
    findUserMenu,
    pickClickable,
    simulateClick,
    closeAllPairTabs,
    SLOGAN_TEXT,
  };
})(typeof window !== "undefined" ? window : globalThis);
