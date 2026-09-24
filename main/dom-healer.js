/**
 * QbotHeal — запасной поиск элементов Quotex, если встроенные поисковики QbotDom их не нашли.
 * Порядок: встроенный поиск → элемент, который указал пользователь → автопоиск по признакам.
 * Для торговых элементов (critical) автопоиск только предлагает кандидата: бот не нажмёт его без подтверждения.
 * Указанные элементы хранятся в localStorage "qbot_dom_picks" = { key: { selector, confirmed, source, savedAt } }.
 */
(function initQbotHeal(global) {
  const PICKS_KEY = "qbot_dom_picks";
  const AUTO_THROTTLE_MS = 3000;

  const status = {};
  const autoCache = {};
  let picking = null;

  const isVisible = (el) => (global.QbotDom ? global.QbotDom.isVisible(el) : !!el);

  function textOf(el) {
    return (el?.textContent || "").replace(/\s+/g, " ").trim();
  }

  function svgRefs(el) {
    return Array.from(el.querySelectorAll("svg, use"))
      .map((node) =>
        [
          node.getAttribute("class") || "",
          node.getAttribute("href") || "",
          node.getAttribute("xlink:href") || "",
        ].join(" ")
      )
      .join(" ")
      .toLowerCase();
  }

  function colorTone(el) {
    try {
      const m = getComputedStyle(el).backgroundColor.match(/\d+(\.\d+)?/g);
      if (!m) return "";
      const [r, g, b] = m.map(Number);
      if (g > 120 && g > r * 1.4 && g > b * 1.2) return "green";
      if (r > 150 && r > g * 1.6 && r > b * 1.4) return "red";
    } catch (e) {
      /* ignore */
    }
    return "";
  }

  function tradeButtonRaw(direction) {
    return global.QbotDom?.raw?.findTradeDirectionButton
      ? global.QbotDom.raw.findTradeDirectionButton(direction)
      : null;
  }

  // ——— Автопоиск по признакам (текст, иконки, цвет, место на экране) ———

  const AUTO = {
    balance() {
      const money = /^[\$€₽₹£₸]\s?[\d\s,.]+$|^[\d\s,.]+\s?[\$€₽₹£₸]$/;
      const host = document.querySelector("qx-usermenu-trigger");
      if (host && isVisible(host) && global.QbotDom?.readSettingsBalance?.() != null) return host;
      if (host) {
        const inside = host.querySelector("div.balance, .balance");
        if (inside && money.test(textOf(inside))) return inside;
      }
      for (const el of document.querySelectorAll("div.balance, span.balance")) {
        if (isVisible(el) && money.test(textOf(el))) return el;
      }
      return null;
    },

    userMenu() {
      const host = document.querySelector("qx-usermenu-trigger");
      if (host && isVisible(host)) return host;
      for (const el of document.querySelectorAll("*")) {
        const tag = el.tagName.toLowerCase();
        if (tag.includes("-") && /user|profile|account/.test(tag) && isVisible(el)) return el;
      }
      for (const el of document.querySelectorAll("header *, [class*='header'] *")) {
        if (!isVisible(el)) continue;
        const t = textOf(el);
        if (t.length > 60) continue;
        if (/live\s*account|demo\s*account|реальный сч|демо[\s-]*сч/i.test(t)) {
          return el.closest("button, [role='button'], qx-usermenu-trigger") || el;
        }
        if (!el.querySelector("svg")) continue;
        if (!/caret|arrow-down|chevron|profile/.test(svgRefs(el))) continue;
        if (/account|аккаунт|сч[её]т|\$|€|₽/i.test(t)) return el;
      }
      return null;
    },

    assetAdd() {
      const plus = document.querySelector("svg.icon-plus, use[href*='icon-plus'], use[xlink\\:href*='icon-plus']");
      const fromIcon = plus && plus.closest("button, [role='button']");
      if (fromIcon && isVisible(fromIcon)) return fromIcon;
      for (const btn of document.querySelectorAll("button, [role='button']")) {
        if (!isVisible(btn)) continue;
        const r = btn.getBoundingClientRect();
        if (r.top > 180 || r.left > innerWidth * 0.55 || r.width > 90) continue;
        if (/plus|add/.test(svgRefs(btn)) || textOf(btn) === "+") return btn;
      }
      return null;
    },

    investInput() {
      const up = tradeButtonRaw("UP");
      const anchor = up ? up.getBoundingClientRect() : null;
      const candidates = Array.from(document.querySelectorAll("input"))
        .filter((inp) => !inp.disabled && inp.type !== "hidden" && isVisible(inp))
        .filter((inp) => !/^\s*\d{1,2}:\d{2}/.test(inp.value || ""))
        .filter((inp) => /[\d]/.test(inp.value || "") && /\$|€|₽|^\s*\d+([.,]\d+)?\s*$/.test(inp.value || ""));
      if (!candidates.length) return null;
      if (!anchor) return candidates[candidates.length - 1];
      candidates.sort((a, b) => {
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        return Math.abs(anchor.top - ra.top) - Math.abs(anchor.top - rb.top);
      });
      return candidates.find((inp) => inp.getBoundingClientRect().top < anchor.top) || candidates[0];
    },

    tradeUp() {
      return findDirectionByLook("UP");
    },

    tradeDown() {
      return findDirectionByLook("DOWN");
    },
  };

  function findDirectionByLook(direction) {
    const isUp = direction === "UP";
    const words = isUp
      ? /^(up|higher|call|buy|выше|вверх|купить|acima|arriba|comprar)$/i
      : /^(down|lower|put|sell|ниже|вниз|продать|abaixo|abajo|vender)$/i;
    const icon = isUp ? /arrow-up|up-circle|trend-up/ : /arrow-down|down-circle|trend-down/;
    const tone = isUp ? "green" : "red";
    let best = null;
    let bestScore = 0;
    for (const btn of document.querySelectorAll("button, [role='button']")) {
      if (!isVisible(btn)) continue;
      const r = btn.getBoundingClientRect();
      if (r.width < 60 || r.height < 24) continue;
      let score = 0;
      if (words.test(textOf(btn))) score += 3;
      if (icon.test(svgRefs(btn))) score += 2;
      if (colorTone(btn) === tone) score += 2;
      if (r.left > innerWidth * 0.5) score += 1;
      if (score > bestScore) {
        best = btn;
        bestScore = score;
      }
    }
    return bestScore >= 3 ? best : null;
  }

  // ——— Каталог элементов ———

  const CATALOG = {
    balance: { critical: false, find: () => global.QbotDom?.raw?.findBalance?.() || null },
    userMenu: { critical: false, find: () => global.QbotDom?.raw?.findUserMenu?.() || null },
    assetAdd: {
      critical: false,
      find: () => (typeof findAssetSelectPlusButtonRaw === "function" ? findAssetSelectPlusButtonRaw() : null),
    },
    investInput: {
      critical: true,
      find: () => (typeof findTradeInvestmentInputRaw === "function" ? findTradeInvestmentInputRaw() : null),
    },
    tradeUp: { critical: true, find: () => tradeButtonRaw("UP") },
    tradeDown: { critical: true, find: () => tradeButtonRaw("DOWN") },
  };

  // ——— Хранилище указанных элементов ———

  function readPicks() {
    try {
      const data = JSON.parse(localStorage.getItem(PICKS_KEY) || "{}");
      return data && typeof data === "object" ? data : {};
    } catch (e) {
      return {};
    }
  }

  function writePick(key, pick) {
    const picks = readPicks();
    if (pick) picks[key] = { ...pick, savedAt: Date.now() };
    else delete picks[key];
    localStorage.setItem(PICKS_KEY, JSON.stringify(picks));
  }

  function queryPick(pick) {
    if (!pick || !pick.selector) return null;
    try {
      const el = document.querySelector(pick.selector);
      return el && isVisible(el) ? el : null;
    } catch (e) {
      return null;
    }
  }

  // ——— Построение устойчивого CSS-селектора для элемента ———

  function cssEscape(value) {
    return global.CSS && CSS.escape ? CSS.escape(value) : String(value).replace(/[^\w-]/g, "\\$&");
  }

  function stepFor(el) {
    const tag = el.tagName.toLowerCase();
    if (el.id && !/\d{4,}/.test(el.id)) return "#" + cssEscape(el.id);
    let step = tag;
    for (const attr of ["data-test", "data-testid", "data-qa", "name", "aria-label", "type", "role"]) {
      const value = el.getAttribute(attr);
      if (value && value.length < 40) {
        step += "[" + attr + '="' + value.replace(/"/g, '\\"') + '"]';
        break;
      }
    }
    const classes = Array.from(el.classList || [])
      .filter((c) => c.length < 40 && !/^(active|hover|focus|open|selected|disabled)$/i.test(c))
      .slice(0, 3);
    if (classes.length) step += "." + classes.map(cssEscape).join(".");
    return step;
  }

  function isUnique(selector, el) {
    try {
      const found = document.querySelectorAll(selector);
      return found.length === 1 && found[0] === el;
    } catch (e) {
      return false;
    }
  }

  function selectorFor(el) {
    if (!el || el.nodeType !== 1) return null;
    const parts = [];
    let node = el;
    for (let depth = 0; node && node.nodeType === 1 && depth < 7; depth++, node = node.parentElement) {
      let step = stepFor(node);
      const parent = node.parentElement;
      if (parent && !step.startsWith("#")) {
        const same = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
        if (same.length > 1) step += ":nth-of-type(" + (same.indexOf(node) + 1) + ")";
      }
      parts.unshift(step);
      const selector = parts.join(" > ");
      if (isUnique(selector, el)) return selector;
      if (step.startsWith("#")) break;
    }
    const selector = parts.join(" > ");
    return isUnique(selector, el) ? selector : null;
  }

  // ——— Основная точка: встроенный результат → указанный → автопоиск ———

  function setStatus(key, state, extra) {
    status[key] = { state, at: Date.now(), ...(extra || {}) };
  }

  function settle(key, found) {
    const entry = CATALOG[key];
    if (!entry) return found;
    if (found) {
      setStatus(key, "ok");
      return found;
    }
    const stage = global.__QBOT_ACCOUNT__?.stage;
    if (!stage || stage === "login") return found;

    const pick = readPicks()[key];
    if (pick && pick.confirmed) {
      const el = queryPick(pick);
      if (el) {
        setStatus(key, pick.source === "auto" ? "auto" : "picked");
        return el;
      }
    }
    if (pick && !pick.confirmed && queryPick(pick)) {
      setStatus(key, "pending");
      return null;
    }

    const cached = autoCache[key];
    if (cached && Date.now() - cached.at < AUTO_THROTTLE_MS) {
      if (cached.el && cached.el.isConnected && !entry.critical) {
        setStatus(key, "auto");
        return cached.el;
      }
      setStatus(key, cached.el && entry.critical ? "pending" : "missing");
      return null;
    }

    let candidate = null;
    try {
      candidate = AUTO[key] ? AUTO[key]() : null;
    } catch (e) {
      candidate = null;
    }
    autoCache[key] = { el: candidate, at: Date.now() };

    if (!candidate) {
      setStatus(key, "missing");
      return null;
    }
    const selector = selectorFor(candidate);
    if (entry.critical) {
      if (selector) writePick(key, { selector, confirmed: false, source: "auto" });
      setStatus(key, "pending");
      console.warn("[Q-bot] Найден возможный элемент «" + key + "», ждём подтверждения в панели.");
      return null;
    }
    if (selector) writePick(key, { selector, confirmed: true, source: "auto" });
    setStatus(key, "auto");
    console.info("[Q-bot] Элемент «" + key + "» найден автопоиском.");
    return candidate;
  }

  function probe(key) {
    const entry = CATALOG[key];
    let raw = null;
    try {
      raw = entry.find();
    } catch (e) {
      raw = null;
    }
    delete autoCache[key];
    return settle(key, raw);
  }

  function report() {
    const picks = readPicks();
    return Object.keys(CATALOG).map((key) => {
      probe(key);
      return {
        key,
        state: status[key]?.state || "missing",
        critical: CATALOG[key].critical,
        saved: !!picks[key],
      };
    });
  }

  function summary() {
    const picks = readPicks();
    const issues = Object.keys(CATALOG)
      .filter((key) => status[key] && (status[key].state === "missing" || status[key].state === "pending"))
      .map((key) => ({ key, state: status[key].state, critical: CATALOG[key].critical }));
    return { issues, picking, saved: Object.keys(picks).length };
  }

  function confirm(key, accept) {
    const pick = readPicks()[key];
    if (!pick) return { ok: false };
    if (accept) {
      writePick(key, { ...pick, confirmed: true });
      setStatus(key, pick.source === "auto" ? "auto" : "picked");
    } else {
      writePick(key, null);
      autoCache[key] = { el: null, at: Date.now() + 60000 };
      setStatus(key, "missing");
    }
    return { ok: true };
  }

  function forget(key) {
    writePick(key, null);
    delete autoCache[key];
    delete status[key];
    return { ok: true };
  }

  // ——— Подсветка элемента на странице ———

  function drawBox(el, text, tone) {
    const r = el.getBoundingClientRect();
    const box = document.createElement("div");
    box.setAttribute("data-qbot-heal", "box");
    const color = tone === "ok" ? "#22c55e" : tone === "warn" ? "#f59e0b" : "#22d3ee";
    Object.assign(box.style, {
      position: "fixed",
      left: r.left - 4 + "px",
      top: r.top - 4 + "px",
      width: r.width + 8 + "px",
      height: r.height + 8 + "px",
      border: "2px solid " + color,
      borderRadius: "8px",
      boxShadow: "0 0 0 4000px rgba(0,0,0,0.25), 0 0 18px " + color,
      zIndex: 2147483646,
      pointerEvents: "none",
      transition: "all 0.12s ease",
    });
    if (text) {
      const tag = document.createElement("div");
      tag.textContent = text;
      Object.assign(tag.style, {
        position: "absolute",
        left: "0",
        top: r.top > 34 ? "-28px" : "calc(100% + 6px)",
        padding: "3px 8px",
        borderRadius: "6px",
        font: "600 12px/1.4 system-ui, sans-serif",
        color: "#0b1020",
        background: color,
        whiteSpace: "nowrap",
      });
      box.appendChild(tag);
    }
    document.body.appendChild(box);
    return box;
  }

  function highlight(key, label) {
    const pick = readPicks()[key];
    let builtin = null;
    try {
      builtin = CATALOG[key]?.find() || null;
    } catch (e) {
      builtin = null;
    }
    const el = builtin || queryPick(pick);
    if (!el) return { ok: false };
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
    const box = drawBox(el, label || key, !builtin && pick && !pick.confirmed ? "warn" : "ok");
    setTimeout(() => box.remove(), 2600);
    return { ok: true };
  }

  // ——— Режим «Указать элемент» ———

  function preferTarget(el, key) {
    if (key === "investInput") {
      return el.closest("label, div")?.querySelector("input") || el;
    }
    if (key === "balance") return el;
    return el.closest("button, a, [role='button']") || el;
  }

  function startPicker(key, label, hint) {
    if (!CATALOG[key]) return { ok: false };
    stopPicker();

    const banner = document.createElement("div");
    banner.setAttribute("data-qbot-heal", "banner");
    banner.textContent = hint || "Нажмите на элемент: " + (label || key) + "  ·  Esc — отмена";
    Object.assign(banner.style, {
      position: "fixed",
      left: "50%",
      top: "10px",
      transform: "translateX(-50%)",
      padding: "8px 16px",
      borderRadius: "10px",
      font: "600 13px/1.4 system-ui, sans-serif",
      color: "#0b1020",
      background: "#22d3ee",
      boxShadow: "0 10px 30px rgba(0,0,0,0.4)",
      zIndex: 2147483647,
      pointerEvents: "none",
    });
    document.body.appendChild(banner);

    let hover = null;
    let hoverBox = null;
    const isOwn = (node) => node && node.closest && node.closest("[data-qbot-heal]");

    const onMove = (event) => {
      const el = document.elementFromPoint(event.clientX, event.clientY);
      if (!el || isOwn(el)) return;
      const target = preferTarget(el, key);
      if (target === hover) return;
      hover = target;
      if (hoverBox) hoverBox.remove();
      hoverBox = drawBox(target, label || key, "info");
    };

    const block = (event) => {
      if (isOwn(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };

    const onClick = (event) => {
      block(event);
      const el = document.elementFromPoint(event.clientX, event.clientY);
      if (!el || isOwn(el)) return;
      const target = preferTarget(el, key);
      const selector = selectorFor(target);
      finish();
      if (!selector) {
        console.warn("[Q-bot] Не удалось запомнить элемент «" + key + "»: у него нет устойчивого адреса.");
        return;
      }
      writePick(key, { selector, confirmed: true, source: "pick" });
      delete autoCache[key];
      setStatus(key, "picked");
      const box = drawBox(target, "✓ " + (label || key), "ok");
      setTimeout(() => box.remove(), 1600);
      console.info("[Q-bot] Элемент «" + key + "» запомнен:", selector);
    };

    const onKey = (event) => {
      if (event.key === "Escape") {
        block(event);
        finish();
      }
    };

    const blockTypes = ["pointerdown", "pointerup", "mousedown", "mouseup", "dblclick", "contextmenu"];
    function finish() {
      window.removeEventListener("mousemove", onMove, true);
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("keydown", onKey, true);
      blockTypes.forEach((type) => window.removeEventListener(type, block, true));
      if (hoverBox) hoverBox.remove();
      banner.remove();
      picking = null;
    }

    window.addEventListener("mousemove", onMove, true);
    window.addEventListener("click", onClick, true);
    window.addEventListener("keydown", onKey, true);
    blockTypes.forEach((type) => window.addEventListener(type, block, true));
    picking = { key, stop: finish };
    return { ok: true };
  }

  function stopPicker() {
    if (picking && typeof picking.stop === "function") picking.stop();
    picking = null;
    return { ok: true };
  }

  global.QbotHeal = {
    CATALOG_KEYS: Object.keys(CATALOG),
    settle,
    probe,
    report,
    summary: () => ({ ...summary(), picking: picking ? picking.key : null }),
    confirm,
    forget,
    highlight,
    startPicker,
    stopPicker,
    selectorFor,
  };
})(typeof window !== "undefined" ? window : globalThis);
