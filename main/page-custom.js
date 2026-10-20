/**
 * Редактор страницы брокера для отдельных аккаунтов: свой текст, цвет текста и фона, SVG-иконки.
 * Изменения хранятся в localStorage страницы брокера под ключом конкретного ID и применяются только для него.
 *
 * Всё меняется только через CSS (текст — через ::after, иконка — фоновой картинкой), сама страница не
 * трогается: робот по-прежнему читает исходные названия пар, кнопки сделок, «Demo Account» и т.д.
 * Нельзя менять только текст с цифрами (баланс, суммы, счётчики). Работает и внутри Shadow DOM.
 */
(function initQbotCustom(global) {
  const ACCOUNTS = ["9488323"];
  const STORE_PREFIX = "qbot_page_custom:";
  const STYLE_ID = "qbot-custom-style";
  const SEP = " >>> ";
  const MAX_TEXT = 500;
  const MAX_SVG = 40000;
  const DIGITS = /\d/;

  let rules = [];
  let enabled = true;
  let preview = null;
  let picking = null;
  let picked = null;
  let applyQueued = false;
  const observedRoots = new WeakSet();
  const styledRoots = new Set();
  const spriteUses = new Set();

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

  function closestComposed(el, selector) {
    for (let n = el; n; n = up(n)) if (n.nodeType === 1 && n.matches(selector)) return n;
    return null;
  }

  // Deepest element under the cursor, through open shadow roots. A click on an icon picks the whole <svg>.
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

  // ——— Что можно менять ———

  function isOwn(el) {
    return !el || !!closestComposed(el, "[data-qbot-heal], [data-qbot-custom-ui], #qbot-header-dock, #qbot-trading-modal-root");
  }

  function isSvg(el) {
    return !!el && el.tagName && el.tagName.toLowerCase() === "svg";
  }

  function visibleText(el) {
    if (isSvg(el) || el.matches("input, textarea, select")) return "";
    return (el.textContent || "").replace(/\s+/g, " ").trim();
  }

  // ——— Применение: только CSS ———

  // Without xmlns the parser puts the shapes in no namespace and the browser does not draw them.
  // xlink:href without an xmlns:xlink declaration is an XML error, so it is added too.
  function withSvgNamespace(markup) {
    let out = markup.replace(/<svg\b(?![^>]*\sxmlns=)/i, '<svg xmlns="http://www.w3.org/2000/svg"');
    if (/xlink:/i.test(out) && !/xmlns:xlink=/i.test(out)) out = out.replace(/<svg\b/i, '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');
    return out;
  }

  // <use xlink:href="/profile/images/spritemap.svg#icon"> — an icon from the site's own sprite.
  // Only the same site is allowed; returns the href or null.
  function spriteHref(markup) {
    const m = String(markup || "").match(/<use\b[^>]*?\s(?:xlink:)?href\s*=\s*["']([^"'#][^"']*#[\w-]+)["']/i);
    if (!m) return null;
    try {
      const url = new URL(m[1], location.href);
      return /^https?:$/.test(url.protocol) && url.origin === location.origin ? m[1] : "";
    } catch (e) {
      return "";
    }
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

  function cssString(text) {
    return '"' + String(text).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\A ") + '"';
  }

  function cssFor(rule, sel) {
    const out = [];
    if (rule.color) {
      out.push(`${sel}, ${sel} *, ${sel}::after { color: ${rule.color} !important; -webkit-text-fill-color: ${rule.color} !important; }`);
      out.push(`${sel} [fill]:not([fill="none"]), ${sel}[fill]:not([fill="none"]) { fill: ${rule.color} !important; }`);
      out.push(`${sel} [stroke]:not([stroke="none"]), ${sel}[stroke]:not([stroke="none"]) { stroke: ${rule.color} !important; }`);
      out.push(`${sel} { fill: ${rule.color} !important; }`);
    }
    if (rule.bg) out.push(`${sel} { background-color: ${rule.bg} !important; }`);
    // The page keeps its own text (the robot reads it); the new text is only drawn on top.
    if (typeof rule.text === "string") {
      const size = rule.fontSize || 14;
      out.push(`${sel} { font-size: 0 !important; line-height: ${rule.lineHeight || Math.round(size * 1.25)}px !important; }`);
      out.push(`${sel} > * { font-size: ${size}px !important; }`);
      out.push(`${sel}::after { content: ${cssString(rule.text)}; font-size: ${size}px !important; white-space: pre-wrap; }`);
    }
    // The icon is drawn as a background over the original shapes, which are hidden.
    // A sprite icon is our own <use> inside the svg; the original shapes are only hidden.
    if (rule.sprite) out.push(`${sel} > :not([data-qbot-icon]) { visibility: hidden !important; }`);
    if (rule.svg) {
      const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(withSvgNamespace(rule.svg));
      out.push(`${sel} > * { visibility: hidden !important; }`);
      out.push(`${sel} { background-image: url("${url}") !important; background-position: center !important; background-size: contain !important; background-repeat: no-repeat !important; }`);
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
    if (!allowed()) return [];
    if (!enabled) return preview ? [preview] : [];
    const list = rules.filter((r) => !preview || r.selector !== preview.selector);
    return preview ? list.concat(preview) : list;
  }

  function setSpriteIcon(svg, href) {
    let use = Array.from(svg.children).find((c) => c.hasAttribute("data-qbot-icon"));
    if (!use) {
      use = document.createElementNS("http://www.w3.org/2000/svg", "use");
      use.setAttribute("data-qbot-icon", "");
      use.setAttribute("x", "0");
      use.setAttribute("y", "0");
      use.setAttribute("width", "100%");
      use.setAttribute("height", "100%");
      svg.appendChild(use);
      spriteUses.add(use);
    }
    if (use.getAttribute("href") !== href) {
      use.setAttribute("href", href);
      use.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", href);
    }
    return use;
  }

  function applyAll() {
    applyQueued = false;
    const cssByRoot = new Map();
    const keepUses = new Set();
    for (const rule of activeRules()) {
      const found = resolve(rule.selector);
      if (!found) continue;
      watchRoot(found.root);
      const css = cssFor(rule, found.local);
      if (css) cssByRoot.set(found.root, (cssByRoot.get(found.root) || "") + css + "\n");
      if (rule.sprite && isSvg(found.el)) keepUses.add(setSpriteIcon(found.el, rule.sprite));
    }
    for (const use of Array.from(spriteUses)) {
      if (keepUses.has(use)) continue;
      use.remove();
      spriteUses.delete(use);
    }
    for (const root of new Set([...styledRoots, ...cssByRoot.keys()])) {
      const css = cssByRoot.get(root) || "";
      const style = styleFor(root);
      if (style.textContent !== css) style.textContent = css;
    }
  }

  function queueApply() {
    if (applyQueued) return;
    applyQueued = true;
    // A plain timer: requestAnimationFrame pauses while the window is in the background.
    setTimeout(applyAll, 150);
  }

  // Shadow roots appear later and components may rebuild their content (dropping our <style>).
  function watchRoot(root) {
    const target = root === document ? document.body : root;
    if (!target || observedRoots.has(target)) return;
    observedRoots.add(target);
    new MutationObserver(queueApply).observe(target, { childList: true, subtree: true });
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
    const style = getComputedStyle(el);
    const text = visibleText(el);
    const digits = DIGITS.test(text);
    return {
      tag: el.tagName.toLowerCase(),
      text: text.slice(0, MAX_TEXT),
      hasText: !!text && !digits,
      digits,
      hasSvg: isSvg(el),
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
      const label = isOwn(el) ? "🔒 Q-bot" : DIGITS.test(visibleText(el)) ? el.tagName.toLowerCase() + " · цифры — только цвет" : el.tagName.toLowerCase();
      hoverBox = boxFor(el, label, isOwn(el) ? "#fb7185" : "#a78bfa");
    };
    const onClick = (event) => {
      block(event);
      const el = deepFromPoint(event.clientX, event.clientY);
      if (!el || own(el)) return;
      finish();
      if (isOwn(el)) {
        picked = { ok: false, error: "protected", reason: "own" };
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
    if (isOwn(el)) return { error: "protected", reason: "own" };
    const color = /^#[0-9a-f]{6}$/i.test(src.color || "") ? src.color : null;
    const bg = /^#[0-9a-f]{6}$/i.test(src.bg || "") ? src.bg : null;
    const text = typeof src.text === "string" ? src.text.slice(0, MAX_TEXT) : null;
    if (text !== null && DIGITS.test(visibleText(el))) return { error: "digits" };
    const sprite = src.svg ? spriteHref(src.svg) : null;
    if (sprite === "") return { error: "sprite_origin" };
    const svg = src.svg && !sprite ? sanitizeSvg(src.svg) : null;
    if (src.svg && !sprite && !svg) return { error: "svg" };
    if ((svg || sprite) && !isSvg(el)) return { error: "svg_target" };
    // Measure the original size before our own font-size: 0 is in place.
    const old = (preview && preview.selector === selector ? preview : null) || rules.find((r) => r.selector === selector);
    let fontSize = old && old.fontSize;
    let lineHeight = old && old.lineHeight;
    if (!fontSize) {
      const style = getComputedStyle(el);
      fontSize = parseFloat(style.fontSize) || 14;
      lineHeight = parseFloat(style.lineHeight) || Math.round(fontSize * 1.25);
    }
    return {
      rule: {
        selector,
        label: String(src.label || "").slice(0, 60),
        text,
        color,
        bg,
        svg,
        sprite: sprite || null,
        svgSource: sprite ? String(src.svg).trim().slice(0, 2000) : null,
        fontSize,
        lineHeight,
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
      svg: !!(r.svg || r.sprite),
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
      preview = null;
      picked = null;
      applyAll();
      return { ok: true };
    }
    if (action === "preview") {
      const result = cleanRule(payload);
      if (result.error) return { ok: false, error: result.error };
      preview = result.rule;
      applyAll();
      return { ok: true };
    }
    if (action === "save") {
      const result = cleanRule(payload);
      if (result.error) return { ok: false, error: result.error };
      const empty = result.rule.text === null && !result.rule.color && !result.rule.bg && !result.rule.svg && !result.rule.sprite;
      rules = rules.filter((r) => r.selector !== result.rule.selector);
      if (!empty) rules.push(result.rule);
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
      rules.splice(Number(payload), 1);
      save();
      applyAll();
      return { ok: true };
    }
    if (action === "toggle") {
      enabled = !!payload;
      save();
      applyAll();
      return { ok: true };
    }
    if (action === "reset") {
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
