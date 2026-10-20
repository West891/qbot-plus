/**
 * Редактор страницы брокера для отдельных аккаунтов: свой текст, цвет текста и фона, SVG-иконки.
 * Изменения хранятся в localStorage страницы брокера под ключом конкретного ID и применяются только для него.
 * Элементы, которые читает робот (баланс, суммы, поля ставки, кнопки сделок, пары, история), менять нельзя.
 */
(function initQbotCustom(global) {
  const ACCOUNTS = ["9488323"];
  const STORE_PREFIX = "qbot_page_custom:";
  const STYLE_ID = "qbot-custom-style";
  const MAX_TEXT = 500;
  const MAX_SVG = 40000;
  const MONEY = /(?:[$€₽£]\s?[\d.,]*\d)|(?:\d[\d\s.,]*\s?[$€₽£])/;

  let rules = [];
  let enabled = true;
  let preview = null;
  let picking = null;
  let picked = null;
  let observer = null;
  let applyQueued = false;
  // Original text and icon of every element we changed, so a change can be undone without a reload
  // (a reload would also stop a running robot).
  const originals = new Map();

  function accountId() {
    const id = global.__QBOT_ACCOUNT__ && global.__QBOT_ACCOUNT__.id;
    return id == null ? "" : String(id);
  }

  function allowed() {
    return ACCOUNTS.includes(accountId());
  }

  function storeKey() {
    return STORE_PREFIX + accountId();
  }

  function load() {
    try {
      const data = JSON.parse(localStorage.getItem(storeKey()) || "null");
      rules = data && Array.isArray(data.rules) ? data.rules : [];
      enabled = !data || data.enabled !== false;
    } catch (e) {
      rules = [];
      enabled = true;
    }
  }

  function save() {
    localStorage.setItem(storeKey(), JSON.stringify({ enabled, rules }));
  }

  // ——— Что трогать нельзя ———

  function criticalElements() {
    const dom = global.QbotDom || {};
    const list = [];
    const add = (fn) => {
      try {
        const found = fn();
        if (Array.isArray(found)) list.push(...found);
        else if (found) list.push(found);
      } catch (e) {
        /* элемента сейчас нет */
      }
    };
    add(() => dom.raw && dom.raw.findBalance && dom.raw.findBalance());
    add(() => dom.raw && dom.raw.findUserMenu && dom.raw.findUserMenu());
    add(() => document.querySelector("qx-usermenu-trigger"));
    add(() => dom.findTradeDirectionButton && dom.findTradeDirectionButton("UP"));
    add(() => dom.findTradeDirectionButton && dom.findTradeDirectionButton("DOWN"));
    add(() => dom.collectPairTabs && dom.collectPairTabs());
    add(() => Array.from(document.querySelectorAll("div.lCITV")).map((row) => row.parentElement || row));
    return list.filter((el) => el && el.nodeType === 1);
  }

  function protectedReason(el) {
    if (!el || el.closest("[data-qbot-heal], [data-qbot-custom-ui], #qbot-header-dock")) return "own";
    if (el.matches("input, textarea, select") || el.querySelector("input, textarea, select")) return "input";
    if (MONEY.test(el.textContent || "")) return "money";
    for (const crit of criticalElements()) {
      if (crit === el || crit.contains(el) || el.contains(crit)) return "robot";
    }
    return null;
  }

  // ——— Применение изменений ———

  function query(selector) {
    try {
      return document.querySelector(selector);
    } catch (e) {
      return null;
    }
  }

  function targetSvg(el) {
    if (!el) return null;
    if (el.tagName && el.tagName.toLowerCase() === "svg") return el;
    return el.closest("svg") || el.querySelector("svg");
  }

  function ownTextNodes(el) {
    return Array.from(el.childNodes).filter((n) => n.nodeType === 3 && n.nodeValue.trim());
  }

  function remember(el) {
    if (originals.has(el)) return originals.get(el);
    const svg = targetSvg(el);
    const orig = {
      leaf: el.children.length ? null : el.textContent,
      nodes: el.children.length ? Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => [n, n.nodeValue]) : [],
      svg: svg ? { el: svg, viewBox: svg.getAttribute("viewBox"), children: Array.from(svg.childNodes).map((n) => n.cloneNode(true)) } : null,
    };
    originals.set(el, orig);
    return orig;
  }

  function restore(el) {
    const orig = el && originals.get(el);
    if (!orig) return;
    originals.delete(el);
    if (orig.leaf !== null && el.textContent !== orig.leaf) el.textContent = orig.leaf;
    orig.nodes.forEach(([node, value]) => { if (node.nodeValue !== value) node.nodeValue = value; });
    if (orig.svg && orig.svg.el.hasAttribute("data-qbot-custom-svg")) {
      const svg = orig.svg.el;
      if (orig.svg.viewBox === null) svg.removeAttribute("viewBox");
      else svg.setAttribute("viewBox", orig.svg.viewBox);
      svg.replaceChildren(...orig.svg.children.map((n) => n.cloneNode(true)));
      svg.removeAttribute("data-qbot-custom-svg");
    }
  }

  function restoreAll() {
    Array.from(originals.keys()).forEach(restore);
  }

  function setText(el, text) {
    if (!el.children.length) {
      if (el.textContent !== text) el.textContent = text;
      return;
    }
    const nodes = ownTextNodes(el);
    if (!nodes.length) return;
    if (nodes[0].nodeValue !== text) nodes[0].nodeValue = text;
    nodes.slice(1).forEach((n) => { if (n.nodeValue) n.nodeValue = ""; });
  }

  // Without xmlns the parser puts the shapes in no namespace and the browser does not draw them.
  function withSvgNamespace(markup) {
    return markup.replace(/<svg\b(?![^>]*\sxmlns=)/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  }

  function sanitizeSvg(markup) {
    const raw = withSvgNamespace(String(markup || "").trim().slice(0, MAX_SVG));
    if (!raw) return null;
    const doc = new DOMParser().parseFromString(raw, "image/svg+xml");
    const svg = doc.documentElement;
    if (!svg || svg.tagName.toLowerCase() !== "svg" || doc.querySelector("parsererror")) return null;
    svg.querySelectorAll("script, foreignObject, iframe, object, embed").forEach((n) => n.remove());
    for (const node of [svg, ...svg.querySelectorAll("*")]) {
      for (const attr of Array.from(node.attributes)) {
        const name = attr.name.toLowerCase();
        const value = attr.value.trim().toLowerCase();
        if (name.startsWith("on") || ((name === "href" || name === "xlink:href") && !value.startsWith("#") && !value.startsWith("data:image/"))) {
          node.removeAttribute(attr.name);
        }
      }
    }
    return svg.outerHTML;
  }

  function applySvg(el, markup, mark) {
    const svg = targetSvg(el);
    if (!svg || svg.getAttribute("data-qbot-custom-svg") === mark) return;
    const parsed = new DOMParser().parseFromString(withSvgNamespace(markup), "image/svg+xml").documentElement;
    const viewBox = parsed.getAttribute("viewBox");
    if (viewBox) svg.setAttribute("viewBox", viewBox);
    else svg.removeAttribute("viewBox");
    svg.replaceChildren(...Array.from(parsed.childNodes).map((n) => document.importNode(n, true)));
    svg.setAttribute("data-qbot-custom-svg", mark);
  }

  function cssFor(rule) {
    const sel = rule.selector;
    const out = [];
    if (rule.color) {
      out.push(`${sel}, ${sel} * { color: ${rule.color} !important; -webkit-text-fill-color: ${rule.color} !important; }`);
      out.push(`${sel} [fill]:not([fill="none"]), ${sel}[fill]:not([fill="none"]) { fill: ${rule.color} !important; }`);
      out.push(`${sel} [stroke]:not([stroke="none"]), ${sel}[stroke]:not([stroke="none"]) { stroke: ${rule.color} !important; }`);
    }
    if (rule.bg) out.push(`${sel} { background: ${rule.bg} !important; }`);
    return out.join("\n");
  }

  function activeRules() {
    if (!allowed() || !enabled) return preview && allowed() ? [preview] : [];
    const list = rules.filter((r) => !preview || r.selector !== preview.selector);
    return preview ? list.concat(preview) : list;
  }

  function applyAll() {
    applyQueued = false;
    if (!allowed()) restoreAll();
    const list = activeRules();
    let style = document.getElementById(STYLE_ID);
    const css = list.map(cssFor).filter(Boolean).join("\n");
    if (css && !style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      style.setAttribute("data-qbot-custom-ui", "");
      (document.head || document.documentElement).appendChild(style);
    }
    if (style && style.textContent !== css) style.textContent = css;
    for (const rule of list) {
      const el = query(rule.selector);
      if (!el || protectedReason(el) === "robot") continue;
      if (typeof rule.text !== "string" && !rule.svg) continue;
      remember(el);
      if (typeof rule.text === "string") setText(el, rule.text);
      if (rule.svg) applySvg(el, rule.svg, String(rule.at || 0));
    }
  }

  function queueApply() {
    if (applyQueued) return;
    applyQueued = true;
    setTimeout(() => requestAnimationFrame(applyAll), 120);
  }

  function watch() {
    if (observer || !document.body) return;
    observer = new MutationObserver(queueApply);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  // ——— Выбор элемента на странице ———

  function boxFor(el, text, color) {
    const r = el.getBoundingClientRect();
    const box = document.createElement("div");
    box.setAttribute("data-qbot-custom-ui", "box");
    Object.assign(box.style, {
      position: "fixed", left: r.left - 3 + "px", top: r.top - 3 + "px", width: r.width + 6 + "px", height: r.height + 6 + "px",
      border: "2px solid " + color, borderRadius: "8px", boxShadow: "0 0 0 4000px rgba(0,0,0,0.2), 0 0 16px " + color,
      zIndex: 2147483646, pointerEvents: "none",
    });
    const tag = document.createElement("div");
    tag.textContent = text;
    Object.assign(tag.style, {
      position: "absolute", left: "0", top: r.top > 30 ? "-26px" : "calc(100% + 6px)", padding: "3px 8px", borderRadius: "6px",
      font: "600 12px/1.4 system-ui, sans-serif", color: "#0b1020", background: color, whiteSpace: "nowrap",
    });
    box.appendChild(tag);
    document.body.appendChild(box);
    return box;
  }

  function hex(color) {
    const m = String(color || "").match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/);
    if (!m || m[4] === "0") return "";
    return "#" + [m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, "0")).join("");
  }

  function describe(el) {
    const rule = rules.find((r) => query(r.selector) === el) || null;
    const svg = targetSvg(el);
    const style = getComputedStyle(el);
    const text = el.children.length ? ownTextNodes(el).map((n) => n.nodeValue.trim()).join(" ") : (el.textContent || "").trim();
    return {
      tag: el.tagName.toLowerCase(),
      text: text.slice(0, MAX_TEXT),
      hasText: !!text,
      hasSvg: !!svg,
      color: hex(style.color),
      bg: hex(style.backgroundColor),
      rule,
    };
  }

  function stopPick() {
    if (picking) picking();
    picking = null;
  }

  function startPick() {
    if (!allowed()) return { ok: false, error: "account" };
    stopPick();
    picked = null;
    const banner = document.createElement("div");
    banner.setAttribute("data-qbot-custom-ui", "banner");
    banner.textContent = "Нажмите на элемент, который хотите изменить  ·  Esc — отмена";
    Object.assign(banner.style, {
      position: "fixed", left: "50%", top: "10px", transform: "translateX(-50%)", padding: "8px 16px", borderRadius: "10px",
      font: "600 13px/1.4 system-ui, sans-serif", color: "#0b1020", background: "#a78bfa", boxShadow: "0 10px 30px rgba(0,0,0,0.4)",
      zIndex: 2147483647, pointerEvents: "none",
    });
    document.body.appendChild(banner);
    let hover = null;
    let hoverBox = null;
    const own = (node) => node && node.closest && node.closest("[data-qbot-custom-ui]");
    const block = (event) => {
      if (own(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };
    const onMove = (event) => {
      const el = document.elementFromPoint(event.clientX, event.clientY);
      if (!el || own(el) || el === hover) return;
      hover = el;
      if (hoverBox) hoverBox.remove();
      const locked = protectedReason(el);
      hoverBox = boxFor(el, locked ? "🔒 нельзя менять" : el.tagName.toLowerCase(), locked ? "#fb7185" : "#a78bfa");
    };
    const onClick = (event) => {
      block(event);
      const el = document.elementFromPoint(event.clientX, event.clientY);
      if (!el || own(el)) return;
      finish();
      const reason = protectedReason(el);
      if (reason) {
        picked = { ok: false, error: "protected", reason };
        return;
      }
      const selector = global.QbotHeal && global.QbotHeal.selectorFor(el);
      if (!selector) {
        picked = { ok: false, error: "selector" };
        return;
      }
      picked = { ok: true, selector, ...describe(el) };
      const box = boxFor(el, "✓ выбран", "#34d399");
      setTimeout(() => box.remove(), 1400);
    };
    const onKey = (event) => {
      if (event.key !== "Escape") return;
      block(event);
      finish();
      picked = { ok: false, error: "cancel" };
    };
    const types = ["pointerdown", "pointerup", "mousedown", "mouseup", "dblclick", "contextmenu"];
    function finish() {
      window.removeEventListener("mousemove", onMove, true);
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("keydown", onKey, true);
      types.forEach((type) => window.removeEventListener(type, block, true));
      if (hoverBox) hoverBox.remove();
      banner.remove();
      picking = null;
    }
    window.addEventListener("mousemove", onMove, true);
    window.addEventListener("click", onClick, true);
    window.addEventListener("keydown", onKey, true);
    types.forEach((type) => window.addEventListener(type, block, true));
    picking = finish;
    return { ok: true };
  }

  // ——— API для боковой панели ———

  function cleanRule(input) {
    const src = input && typeof input === "object" ? input : {};
    const selector = String(src.selector || "").slice(0, 600);
    const el = query(selector);
    if (!selector || !el) return { error: "missing" };
    const reason = protectedReason(el);
    if (reason) return { error: "protected", reason };
    const color = /^#[0-9a-f]{6}$/i.test(src.color || "") ? src.color : null;
    const bg = /^#[0-9a-f]{6}$/i.test(src.bg || "") ? src.bg : null;
    const text = typeof src.text === "string" ? src.text.slice(0, MAX_TEXT) : null;
    const svg = src.svg ? sanitizeSvg(src.svg) : null;
    if (src.svg && !svg) return { error: "svg" };
    return {
      rule: {
        selector,
        label: String(src.label || "").slice(0, 60),
        text,
        color,
        bg,
        svg,
        at: Date.now(),
      },
    };
  }

  function summaryRules() {
    return rules.map((r, index) => ({
      index,
      label: r.label,
      text: typeof r.text === "string",
      color: r.color,
      bg: r.bg,
      svg: !!r.svg,
      found: !!query(r.selector),
    }));
  }

  function api(action, payload) {
    if (!allowed()) return { ok: false, error: "account", allowed: false };
    load();
    watch();
    if (action === "state") {
      return { ok: true, allowed: true, enabled, picking: !!picking, picked, rules: summaryRules() };
    }
    if (action === "pick") return startPick();
    if (action === "cancel") {
      stopPick();
      if (preview) restore(query(preview.selector));
      preview = null;
      picked = null;
      applyAll();
      return { ok: true };
    }
    if (action === "preview") {
      const result = cleanRule(payload);
      if (result.error) return { ok: false, error: result.error };
      restore(query(result.rule.selector));
      preview = result.rule;
      applyAll();
      return { ok: true };
    }
    if (action === "save") {
      const result = cleanRule(payload);
      if (result.error) return { ok: false, error: result.error };
      const empty = result.rule.text === null && !result.rule.color && !result.rule.bg && !result.rule.svg;
      rules = rules.filter((r) => r.selector !== result.rule.selector);
      if (!empty) rules.push(result.rule);
      restore(query(result.rule.selector));
      preview = null;
      picked = null;
      save();
      applyAll();
      return { ok: true };
    }
    if (action === "edit") {
      const rule = rules[Number(payload)];
      const el = rule && query(rule.selector);
      if (!el) return { ok: false, error: "missing" };
      picked = { ok: true, selector: rule.selector, ...describe(el), rule };
      return { ok: true };
    }
    if (action === "show") {
      const rule = rules[Number(payload)];
      const el = rule && query(rule.selector);
      if (!el) return { ok: false, error: "missing" };
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
      const box = boxFor(el, rule.label || "элемент", "#a78bfa");
      setTimeout(() => box.remove(), 2200);
      return { ok: true };
    }
    if (action === "remove") {
      const [gone] = rules.splice(Number(payload), 1);
      if (gone) restore(query(gone.selector));
      save();
      applyAll();
      return { ok: true };
    }
    if (action === "toggle") {
      enabled = !!payload;
      if (!enabled) restoreAll();
      save();
      applyAll();
      return { ok: true };
    }
    if (action === "reset") {
      restoreAll();
      rules = [];
      save();
      applyAll();
      return { ok: true };
    }
    return { ok: false, error: "action" };
  }

  // The account id appears a few seconds after login and can change when another account signs in:
  // apply the changes for the allowed id and take them off the page for any other.
  let seenId = "";
  setInterval(() => {
    const id = accountId();
    if (id === seenId) return;
    seenId = id;
    if (allowed()) {
      load();
      watch();
    } else {
      preview = null;
    }
    applyAll();
  }, 1000);

  global.QbotCustom = { api };
})(typeof window !== "undefined" ? window : globalThis);
