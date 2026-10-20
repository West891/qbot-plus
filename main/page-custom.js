/**
 * Редактор страницы брокера для отдельных аккаунтов: свой текст, цвет текста и фона, SVG-иконки.
 * Изменения хранятся в localStorage страницы брокера под ключом конкретного ID и применяются только для него.
 * Работает и внутри Shadow DOM (блок баланса Quotex — qx-usermenu-trigger).
 *
 * Что читает робот, менять нельзя: число баланса и любые суммы, поля ставки и времени, кнопки сделок,
 * вкладки пар и историю. В блоке баланса можно менять подписи и иконки; подписи там меняются только
 * визуально (через CSS), чтобы робот по-прежнему видел исходный текст («Demo account» и т.п.).
 */
(function initQbotCustom(global) {
  const ACCOUNTS = ["9488323"];
  const STORE_PREFIX = "qbot_page_custom:";
  const STYLE_ID = "qbot-custom-style";
  const SEP = " >>> ";
  const MAX_TEXT = 500;
  const MAX_SVG = 40000;
  const MONEY = /(?:[$€₽£]\s?[\d.,]*\d)|(?:\d[\d\s.,]*\s?[$€₽£])/;

  let rules = [];
  let enabled = true;
  let preview = null;
  let picking = null;
  let picked = null;
  let applyQueued = false;
  const observedRoots = new WeakSet();
  const styledRoots = new Set();
  // Original text, icon and marks of every element we changed, so a change can be undone without
  // a reload (a reload would also stop a running robot).
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

  // ——— DOM с учётом Shadow DOM ———

  function up(node) {
    const parent = node.parentNode;
    return parent && parent.nodeType === 11 && parent.host ? parent.host : parent;
  }

  function composedContains(outer, inner) {
    for (let n = inner; n; n = up(n)) if (n === outer) return true;
    return false;
  }

  function closestComposed(el, selector) {
    for (let n = el; n; n = up(n)) if (n.nodeType === 1 && n.matches(selector)) return n;
    return null;
  }

  // Deepest element under the cursor, through open shadow roots. A click on an icon picks the whole <svg>:
  // its inner shapes disappear once the icon is replaced.
  function deepFromPoint(x, y) {
    let el = document.elementFromPoint(x, y);
    while (el && el.shadowRoot) {
      const inner = el.shadowRoot.elementFromPoint(x, y);
      if (!inner || inner === el) break;
      el = inner;
    }
    return (el && el.closest && el.closest("svg")) || el;
  }

  function cssEscape(value) {
    return global.CSS && CSS.escape ? CSS.escape(value) : String(value).replace(/[^\w-]/g, "\\$&");
  }

  function stepFor(el) {
    if (el.id && !/\d{4,}/.test(el.id)) return "#" + cssEscape(el.id);
    let step = el.tagName.toLowerCase();
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

  // Unique selector for el inside its own root (document or a shadow root).
  function selectorIn(el, root) {
    const unique = (selector) => {
      try {
        const found = root.querySelectorAll(selector);
        return found.length === 1 && found[0] === el;
      } catch (e) {
        return false;
      }
    };
    const parts = [];
    let node = el;
    for (let depth = 0; node && node.nodeType === 1 && depth < 8; depth++, node = node.parentElement) {
      let step = stepFor(node);
      const parent = node.parentElement || (node.parentNode === root ? root : null);
      if (parent && !step.startsWith("#")) {
        const same = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
        if (same.length > 1) step += ":nth-of-type(" + (same.indexOf(node) + 1) + ")";
      }
      parts.unshift(step);
      const selector = parts.join(" > ");
      if (unique(selector)) return selector;
      if (step.startsWith("#")) break;
    }
    const selector = parts.join(" > ");
    return unique(selector) ? selector : null;
  }

  // "host selector >>> selector inside its shadow root >>> …"
  function buildPath(el) {
    const segments = [];
    let node = el;
    while (node) {
      const root = node.getRootNode();
      const segment = selectorIn(node, root);
      if (!segment) return null;
      segments.unshift(segment);
      if (root.nodeType === 11 && root.host) node = root.host;
      else break;
    }
    return segments.join(SEP);
  }

  function resolve(path) {
    const segments = String(path || "").split(SEP);
    let root = document;
    for (let i = 0; i < segments.length; i++) {
      let el = null;
      try {
        el = root.querySelector(segments[i]);
      } catch (e) {
        return null;
      }
      if (!el) return null;
      if (i === segments.length - 1) return { el, root, local: segments[i] };
      root = el.shadowRoot;
      if (!root) return null;
    }
    return null;
  }

  function query(path) {
    const found = resolve(path);
    return found ? found.el : null;
  }

  // ——— Что трогать нельзя ———

  function robotParts() {
    const dom = global.QbotDom || {};
    const hard = [];
    const soft = [];
    const add = (list, fn) => {
      try {
        const found = fn();
        (Array.isArray(found) ? found : [found]).forEach((el) => { if (el && el.nodeType === 1) list.push(el); });
      } catch (e) {
        /* элемента сейчас нет */
      }
    };
    add(hard, () => dom.raw && dom.raw.findBalance && dom.raw.findBalance());
    add(hard, () => dom.findTradeDirectionButton && dom.findTradeDirectionButton("UP"));
    add(hard, () => dom.findTradeDirectionButton && dom.findTradeDirectionButton("DOWN"));
    add(hard, () => dom.collectPairTabs && dom.collectPairTabs());
    add(hard, () => Array.from(document.querySelectorAll("div.lCITV")).map((row) => row.parentElement || row));
    add(soft, () => dom.raw && dom.raw.findUserMenu && dom.raw.findUserMenu());
    add(soft, () => document.querySelector("qx-usermenu-trigger"));
    return { hard, soft };
  }

  // { reason } when the element must not be changed, otherwise { visual } — true inside the balance block.
  function protection(el) {
    if (!el || closestComposed(el, "[data-qbot-heal], [data-qbot-custom-ui], #qbot-header-dock")) return { reason: "own" };
    if (el.matches("input, textarea, select") || el.querySelector("input, textarea, select")) return { reason: "input" };
    const text = el.textContent || "";
    if (MONEY.test(text)) return { reason: "money" };
    const { hard, soft } = robotParts();
    for (const part of hard) {
      if (part === el || composedContains(part, el) || composedContains(el, part)) return { reason: "robot" };
    }
    for (const block of soft) {
      if (block === el || composedContains(el, block)) return { reason: "block" };
      if (composedContains(block, el)) return /\d/.test(text) ? { reason: "money" } : { visual: true };
    }
    return { visual: false };
  }

  // ——— Применение изменений ———

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
    el.removeAttribute("data-qbot-vt");
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

  function cssString(text) {
    return '"' + String(text).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\A ") + '"';
  }

  function cssFor(rule, sel) {
    const out = [];
    if (rule.color) {
      out.push(`${sel}, ${sel} * { color: ${rule.color} !important; -webkit-text-fill-color: ${rule.color} !important; }`);
      out.push(`${sel} [fill]:not([fill="none"]), ${sel}[fill]:not([fill="none"]) { fill: ${rule.color} !important; }`);
      out.push(`${sel} [stroke]:not([stroke="none"]), ${sel}[stroke]:not([stroke="none"]) { stroke: ${rule.color} !important; }`);
    }
    if (rule.bg) out.push(`${sel} { background: ${rule.bg} !important; }`);
    // Text shown only on screen: the element keeps its DOM text for the robot.
    if (rule.visual && typeof rule.text === "string") {
      const mark = `[data-qbot-vt="${rule.at}"]`;
      out.push(`${mark} { font-size: 0 !important; line-height: ${rule.lineHeight || 18}px !important; }`);
      out.push(`${mark}::after { content: ${cssString(rule.text)}; font-size: ${rule.fontSize || 14}px; white-space: pre; }`);
    }
    return out.join("\n");
  }

  function styleFor(root) {
    const isDoc = root === document;
    let style = isDoc ? document.getElementById(STYLE_ID) : root.querySelector("#" + STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      style.setAttribute("data-qbot-custom-ui", "");
      (isDoc ? document.head || document.documentElement : root).appendChild(style);
    }
    styledRoots.add(root);
    return style;
  }

  function activeRules() {
    if (!allowed() || !enabled) return preview && allowed() ? [preview] : [];
    const list = rules.filter((r) => !preview || r.selector !== preview.selector);
    return preview ? list.concat(preview) : list;
  }

  function applyAll() {
    applyQueued = false;
    if (!allowed()) restoreAll();
    const cssByRoot = new Map();
    for (const rule of activeRules()) {
      const found = resolve(rule.selector);
      if (!found) continue;
      const { el, root, local } = found;
      watchRoot(root);
      const css = cssFor(rule, local);
      if (css) cssByRoot.set(root, (cssByRoot.get(root) || "") + css + "\n");
      if (protection(el).reason) continue;
      if (typeof rule.text !== "string" && !rule.svg) continue;
      remember(el);
      if (typeof rule.text === "string") {
        if (rule.visual) {
          if (el.getAttribute("data-qbot-vt") !== String(rule.at)) el.setAttribute("data-qbot-vt", String(rule.at));
        } else {
          setText(el, rule.text);
        }
      }
      if (rule.svg) applySvg(el, rule.svg, String(rule.at || 0));
    }
    for (const root of new Set([...styledRoots, ...cssByRoot.keys()])) {
      const css = cssByRoot.get(root) || "";
      if (!css && !styledRoots.has(root)) continue;
      const style = styleFor(root);
      if (style.textContent !== css) style.textContent = css;
    }
  }

  function queueApply() {
    if (applyQueued) return;
    applyQueued = true;
    setTimeout(() => requestAnimationFrame(applyAll), 120);
  }

  function watchRoot(root) {
    const target = root === document ? document.body : root;
    if (!target || observedRoots.has(target)) return;
    observedRoots.add(target);
    new MutationObserver(queueApply).observe(target, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["data-qbot-vt", "data-qbot-custom-svg"],
    });
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

  function describe(el, path) {
    const rule = rules.find((r) => r.selector === path) || null;
    const svg = targetSvg(el);
    const style = getComputedStyle(el);
    const visual = !!protection(el).visual;
    const leaf = !el.children.length;
    const text = leaf ? (el.textContent || "").trim() : ownTextNodes(el).map((n) => n.nodeValue.trim()).join(" ");
    return {
      tag: el.tagName.toLowerCase(),
      text: text.slice(0, MAX_TEXT),
      hasText: !!text && (!visual || leaf),
      hasSvg: !!svg,
      visual,
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
      const el = deepFromPoint(event.clientX, event.clientY);
      if (!el || own(el) || el === hover) return;
      hover = el;
      if (hoverBox) hoverBox.remove();
      const locked = protection(el).reason;
      hoverBox = boxFor(el, locked ? "🔒 нельзя менять" : el.tagName.toLowerCase(), locked ? "#fb7185" : "#a78bfa");
    };
    const onClick = (event) => {
      block(event);
      const el = deepFromPoint(event.clientX, event.clientY);
      if (!el || own(el)) return;
      finish();
      const { reason } = protection(el);
      if (reason) {
        picked = { ok: false, error: "protected", reason };
        return;
      }
      const selector = buildPath(el);
      if (!selector) {
        picked = { ok: false, error: "selector" };
        return;
      }
      picked = { ok: true, selector, ...describe(el, selector) };
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
    const selector = String(src.selector || "").slice(0, 900);
    const el = query(selector);
    if (!selector || !el) return { error: "missing" };
    const guard = protection(el);
    if (guard.reason) return { error: "protected", reason: guard.reason };
    const color = /^#[0-9a-f]{6}$/i.test(src.color || "") ? src.color : null;
    const bg = /^#[0-9a-f]{6}$/i.test(src.bg || "") ? src.bg : null;
    const text = typeof src.text === "string" ? src.text.slice(0, MAX_TEXT) : null;
    if (guard.visual && text !== null && el.children.length) return { error: "leaf" };
    const svg = src.svg ? sanitizeSvg(src.svg) : null;
    if (src.svg && !svg) return { error: "svg" };
    const style = getComputedStyle(el);
    const fontSize = parseFloat(style.fontSize) || 14;
    const lineHeight = parseFloat(style.lineHeight) || Math.round(fontSize * 1.25);
    return {
      rule: {
        selector,
        label: String(src.label || "").slice(0, 60),
        text,
        color,
        bg,
        svg,
        visual: !!guard.visual,
        fontSize: guard.visual ? fontSize : undefined,
        lineHeight: guard.visual ? lineHeight : undefined,
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
    watchRoot(document);
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
      picked = { ok: true, selector: rule.selector, ...describe(el, rule.selector), rule };
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
      watchRoot(document);
    } else {
      preview = null;
    }
    applyAll();
  }, 1000);

  global.QbotCustom = { api };
})(typeof window !== "undefined" ? window : globalThis);
