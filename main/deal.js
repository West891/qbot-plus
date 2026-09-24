const QBOT_STORAGE_KEY = "qbot_settings";

/** Настройки из localStorage (в deal.js нельзя полагаться на `storage` из content.js — разные скоупы) */
function getQbotSettings() {
  try {
    const raw = localStorage.getItem(QBOT_STORAGE_KEY);
    if (raw) {
      const o = JSON.parse(raw);
      if (o && typeof o === "object") return o;
    }
  } catch (e) {
    /* ignore */
  }
  return {
    "trading-straregia": "MARTIN",
    "martin-steps": 6,
    "martin-step": 3,
    "start-invest": 70,
    "deal-otc": "OFF",
  };
}

function getTradingStrategy() {
  const v = String(getQbotSettings()["trading-straregia"] || "MARTIN")
    .trim()
    .toUpperCase();
  if (v === "AI") return "AI";
  if (v === "MARTIN") return "MARTIN";
  return "BASIC";
}

const QBOT_LAST_DEAL_AMOUNT_KEY = "qbot_last_deal_amount";
const QBOT_HISTORY_BEFORE_KEY = "qbot_history_before";

/** Сумма инвестиции всегда целое число (не меньше 1). */
function roundInvestmentAmount(n) {
  const x = Math.round(Number(n));
  return Number.isFinite(x) && x >= 1 ? x : 1;
}

function investmentFieldMatchesAmount(targetInt, got) {
  if (got == null || Number.isNaN(Number(got))) return false;
  return Math.round(Number(got)) === targetInt;
}

function investmentInputLabelText(inp) {
  const block = inp?.closest?.(".input-control");
  return (
    (block?.querySelector(".input-control__label")?.textContent || "") +
    (inp?.getAttribute?.("aria-label") || "") +
    (inp?.placeholder || "")
  ).toLowerCase();
}

/** Поле времени экспирации — не путать с суммой (в UI оно обычно выше) */
function isTimeFieldQuotex(inp) {
  if (/^\s*\d{1,2}:\d{2}/.test(String(inp?.value || ""))) return true;
  const lab = investmentInputLabelText(inp);
  if (
    /\btime\b|время|врем\.|expir|duration|таймфрейм|тайм\b|интервал|expire\b|\bминут|\bсекунд|\bmin(?:ute|utes)?\b|\bsec(?:ond|onds)?\b/i.test(
      lab
    )
  ) {
    return true;
  }
  if (/\bсрок\b.*\bсделк/i.test(lab)) return false;
  if (/\bсрок\b/i.test(lab) && !/инвест|сумм|amount/i.test(lab)) return true;
  return false;
}

function isInvestFieldQuotex(inp) {
  return /сумм|инвест|amount|sum|stake|ставк|сделк|deal|размер|volume|invest|влож/i.test(
    investmentInputLabelText(inp)
  );
}

/** Ниже на экране = больше rect.top */
function pickLowerInput(a, b) {
  try {
    return a.getBoundingClientRect().top >= b.getBoundingClientRect().top
      ? a
      : b;
  } catch (e) {
    return b;
  }
}

function investmentInputsNearTradeButton(tb, arr) {
  if (!tb || !arr.length) return arr;
  const br = tb.getBoundingClientRect();
  const filtered = arr.filter((inp) => {
    try {
      const r = inp.getBoundingClientRect();
      return (
        Math.abs(r.left - br.left) < 480 &&
        r.top < br.top + 100 &&
        r.top > br.top - 420
      );
    } catch (e) {
      return true;
    }
  });
  return filtered.length ? filtered : arr;
}

function findTradeInvestmentInput() {
  const found = findTradeInvestmentInputRaw();
  return globalThis.QbotHeal ? QbotHeal.settle("investInput", found) : found;
}

/** Поле суммы: на Quotex два степпера ._hHHo — сверху время, ниже инвестиции */
function findTradeInvestmentInputRaw() {
  const tb = document.getElementById("trade-button");

  const steppers = Array.from(
    document.querySelectorAll(
      "._hHHo input.input-control__input, div._hHHo > input.input-control__input"
    )
  ).filter((i) => !i.disabled && i.type !== "hidden");

  if (steppers.length) {
    const pool = investmentInputsNearTradeButton(tb, steppers);

    const byInvest = pool.filter((i) => isInvestFieldQuotex(i) && !isTimeFieldQuotex(i));
    if (byInvest.length === 1) return byInvest[0];
    if (byInvest.length > 1) return byInvest.reduce(pickLowerInput);

    const noTime = pool.filter((i) => !isTimeFieldQuotex(i));
    if (noTime.length === 1) return noTime[0];
    if (noTime.length > 1) return noTime.reduce(pickLowerInput);

    if (pool.length >= 2) return pool.reduce(pickLowerInput);

    return pool[0];
  }

  const afterMinusAll = Array.from(
    document.querySelectorAll("button.YqVwL + input.input-control__input")
  ).filter(
    (inp) =>
      !inp.disabled &&
      inp.type !== "hidden" &&
      inp.nextElementSibling?.matches?.("button.YqVwL")
  );
  if (afterMinusAll.length === 1) return afterMinusAll[0];
  if (afterMinusAll.length > 1) {
    const inv = afterMinusAll.filter(
      (i) => isInvestFieldQuotex(i) && !isTimeFieldQuotex(i)
    );
    if (inv.length === 1) return inv[0];
    const nt = afterMinusAll.filter((i) => !isTimeFieldQuotex(i));
    if (nt.length >= 1) return nt.reduce(pickLowerInput);
    return afterMinusAll.reduce(pickLowerInput);
  }

  const seen = new Set();
  const add = (inp) => {
    if (!inp || inp.disabled || inp.type === "hidden") return;
    seen.add(inp);
  };

  if (tb) {
    for (let el = tb.parentElement, d = 0; el && d < 12; el = el.parentElement, d++) {
      el.querySelectorAll("input.input-control__input, input[type='number']").forEach(add);
    }
  }
  if (seen.size === 0 && tb) {
    const br = tb.getBoundingClientRect();
    document.querySelectorAll("input.input-control__input").forEach((inp) => {
      if (inp.disabled || inp.type === "hidden") return;
      const r = inp.getBoundingClientRect();
      if (
        Math.abs(r.top - br.top) < 420 &&
        Math.abs(r.left - br.left) < 520
      ) {
        add(inp);
      }
    });
  }

  const list = Array.from(seen);
  const score = (inp) => {
    const lab = investmentInputLabelText(inp);
    let s = 0;
    if (isTimeFieldQuotex(inp)) s -= 200;
    if (isInvestFieldQuotex(inp)) s += 80;
    if (/сумм|инвест|amount|sum|stake|ставк|сделк|deal|размер|volume/.test(lab))
      s += 40;
    if (tb) {
      try {
        const ib = inp.getBoundingClientRect();
        const bb = tb.getBoundingClientRect();
        const dy = ib.top - bb.top;
        if (dy < 0 && dy > -280) s += 25;
        if (Math.abs(ib.left - bb.left) < 400) s += 8;
        if (dy > -120 && dy < 40) s += 15;
      } catch (e) {
        /* ignore */
      }
    }
    return s;
  };

  list.sort((a, b) => {
    const ds = score(b) - score(a);
    if (ds !== 0) return ds;
    return b.getBoundingClientRect().top - a.getBoundingClientRect().top;
  });
  if (list.length && score(list[0]) > score(list[list.length - 1])) return list[0];
  if (list.length >= 2) {
    const notTime = list.filter((i) => !isTimeFieldQuotex(i));
    if (notTime.length) return notTime.reduce(pickLowerInput);
  }
  if (list.length && score(list[0]) > 0) return list[0];

  const all = Array.from(
    document.querySelectorAll("input.input-control__input:not([type='hidden'])")
  ).filter((i) => !i.disabled);
  const allNear = investmentInputsNearTradeButton(
    tb,
    all.filter((i) => {
      if (!tb) return true;
      try {
        const r = i.getBoundingClientRect();
        const br = tb.getBoundingClientRect();
        return Math.abs(r.left - br.left) < 500 && r.top < br.top + 50;
      } catch (e) {
        return true;
      }
    })
  );
  const cand = allNear.length ? allNear : all;
  const scored = cand
    .map((inp) => ({ inp, s: score(inp) }))
    .sort((x, y) => y.s - x.s || y.inp.getBoundingClientRect().top - x.inp.getBoundingClientRect().top);
  if (scored.length && scored[0].s > -100) return scored[0].inp;
  if (cand.length >= 2) {
    const nt = cand.filter((i) => !isTimeFieldQuotex(i));
    if (nt.length) return nt.reduce(pickLowerInput);
  }
  if (all.length >= 3) return all[2];
  if (all.length >= 1) return all[0];
  return list[0] || null;
}

/**
 * Запись в controlled input React: после native setter — tracker = старое значение,
 * иначе React считает, что поле не менялось и не обновляет state (остаётся 12).
 */
function setNativeInputValue(input, value) {
  const str = String(value);
  const prev = String(input.value ?? "");
  try {
    const set = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )?.set;
    if (set) set.call(input, str);
    else input.value = str;
  } catch (e) {
    input.value = str;
  }
  try {
    const tr = input._valueTracker;
    if (tr && typeof tr.setValue === "function") {
      tr.setValue(prev);
    }
  } catch (e) {
    /* ignore */
  }
  input.dispatchEvent(new Event("input", { bubbles: true }));
  try {
    input.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        inputType: "insertReplacementText",
        data: str,
      })
    );
  } catch (e) {
    /* ignore */
  }
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function readNumericFromInvestmentField(input) {
  return parseFloat(
    String(input?.value ?? "").replace(/[^0-9.]/g, ""),
    10
  );
}

/** Форматы суммы: префикс $, суффикс " $" (как у Quotex: «12 $»), только целое число */
function investmentValueVariants(num) {
  const n = roundInvestmentAmount(num);
  const plain = String(n);
  const variants = [
    `${plain} $`,
    `${plain}$`,
    `${String(n)} $`,
    `${n}$`,
    `$${plain}`,
    `$ ${plain}`,
    plain,
    `$${n}`,
    `$ ${n}`,
    String(n),
  ];
  if (n >= 1000) {
    const withComma = n.toLocaleString("en-US", { maximumFractionDigits: 0 });
    variants.push(`${withComma} $`, `${withComma}$`, `$${withComma}`, `$ ${withComma}`);
  }
  return [...new Set(variants)];
}

/** Поле только с цифрами (как value="12") — замена через setRangeText */
function trySetInvestmentPlainRangeText(input, plain) {
  try {
    input.focus({ preventScroll: true });
  } catch (e) {
    try {
      input.focus();
    } catch (e2) {
      /* ignore */
    }
  }
  try {
    const len = String(input.value || "").length;
    input.setSelectionRange(0, Math.max(len, 1));
    input.setRangeText(plain, 0, len || 1, "end");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    const got = readNumericFromInvestmentField(input);
    return investmentFieldMatchesAmount(Number(plain), got);
  } catch (e) {
    return false;
  }
}

/** Кнопки ± рядом с полем суммы */
function findInvestmentStepperButtons(input) {
  if (!input?.parentElement) return { minus: null, plus: null };
  const p = input.parentElement;
  const prev = input.previousElementSibling;
  const next = input.nextElementSibling;
  const minus =
    prev?.matches?.("button") ? prev : p.querySelector("button:first-of-type");
  const plus =
    next?.matches?.("button") ? next : p.querySelector("button:last-of-type");
  if (minus === plus) return { minus: null, plus: null };
  return { minus, plus };
}

function setInvestmentFieldValue(input, num) {
  if (!input) return false;
  const target = roundInvestmentAmount(num);
  const plain = String(target);

  if (trySetInvestmentPlainRangeText(input, plain)) {
    console.log("[Q-bot] Сумма (setRangeText):", input.value);
    return true;
  }
  const label = (
    input.closest(".input-control")?.querySelector(".input-control__label")
      ?.textContent || ""
  ).toLowerCase();
  const sample = String(input.value || input.placeholder || "").trim();
  const inStepper = !!input.closest("._hHHo");
  /** «12 $» — доллар после числа (типично для Quotex) */
  const suffixDollar =
    inStepper ||
    /\d\s+\$/.test(sample) ||
    /\d\$/.test(sample) ||
    (sample.endsWith("$") && /^\d/.test(sample));

  let list = investmentValueVariants(target);
  if (suffixDollar) {
    const first = [
      `${plain} $`,
      `${plain}$`,
      `${target} $`,
      `${target}$`,
    ];
    list = [...new Set([...first, ...list])];
  } else if (
    sample.includes("$") ||
    label.includes("$") ||
    /usd|\$|долл/i.test(label + sample)
  ) {
    list = list.filter((s) => s.includes("$")).concat(list.filter((s) => !s.includes("$")));
  }

  for (const str of list) {
    try {
      input.focus();
    } catch (e) {
      /* ignore */
    }
    setNativeInputValue(input, str);
    const got = readNumericFromInvestmentField(input);
    if (investmentFieldMatchesAmount(target, got)) {
      console.log("[Q-bot] Сумма в поле:", input.value);
      return true;
    }
  }

  const insertTry = suffixDollar
    ? [`${plain} $`, `${plain}$`, String(target)]
    : [`$${target}`, `$ ${target}`, String(target), `${plain} $`];
  for (const str of insertTry) {
    try {
      input.focus();
      input.select();
      if (document.execCommand?.("insertText", false, str)) {
        const got = readNumericFromInvestmentField(input);
        if (investmentFieldMatchesAmount(target, got)) {
          console.log("[Q-bot] Сумма (insertText):", input.value);
          return true;
        }
      }
    } catch (e) {
      /* ignore */
    }
  }

  console.warn("[Q-bot] Не удалось выставить сумму, в поле:", input.value, "цель:", target);
  return false;
}

const QBOT_MARTIN_KEY = "qbot_martin";
let qbotCycleBusy = false;
let qbotStartTimer = null;
let qbotDealTimer = null;

function robotStopped() {
  return localStorage.getItem("statusbot") === "notwork";
}

function scheduleStart(delay) {
  clearTimeout(qbotStartTimer);
  if (robotStopped()) {
    qbotCycleBusy = false;
    return;
  }
  qbotStartTimer = setTimeout(() => {
    qbotStartTimer = null;
    qbotCycleBusy = false;
    if (!robotStopped()) start();
  }, delay);
}

function stopRobot() {
  localStorage.setItem("statusbot", "notwork");
  qbotCycleBusy = false;
  clearTimeout(qbotStartTimer);
  qbotStartTimer = null;
  if (qbotDealTimer) {
    clearInterval(qbotDealTimer);
    qbotDealTimer = null;
  }
  if (typeof window !== "undefined") window.__QBOT_DEAL_OPENING__ = false;
  const hid = document.querySelector("#qbot-header-dock .hid");
  if (hid) hid.style.visibility = "hidden";
  console.log("[Q-bot] Робот остановлен");
  return { ok: true };
}

function normalizeSignalDirection(raw) {
  const value = String(raw ?? "").trim().toUpperCase();
  if (["UP", "CALL", "BUY", "HIGH", "HIGHER", "ВВЕРХ", "ВЫШЕ"].includes(value)) return "UP";
  if (["DOWN", "PUT", "SELL", "LOW", "LOWER", "ВНИЗ", "НИЖЕ"].includes(value)) return "DOWN";
  if (value === "NONE" || value === "NULL" || value === "") return "none";
  return null;
}

function martinLimit() {
  const settings = getQbotSettings();
  const parsed = parseInt(settings["martin-steps"] ?? settings["martin-step"] ?? 6, 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : 6;
}

function readMartinState() {
  try {
    const state = JSON.parse(localStorage.getItem(QBOT_MARTIN_KEY) || "null");
    if (state && Number(state.base) > 0) {
      return {
        base: roundInvestmentAmount(state.base),
        step: Math.max(0, parseInt(state.step, 10) || 0),
      };
    }
  } catch (e) {
    /* ignore */
  }
  return null;
}

function beginMartinCycle(base) {
  const amount = roundInvestmentAmount(base);
  localStorage.setItem(QBOT_MARTIN_KEY, JSON.stringify({ base: amount, step: 0 }));
  localStorage.setItem("MartinSteps", "0");
  localStorage.setItem(QBOT_LAST_DEAL_AMOUNT_KEY, String(amount));
  return amount;
}

function peekNextMartinAmount(coef) {
  const state = readMartinState();
  if (!state || state.step >= martinLimit()) return null;
  return roundInvestmentAmount(state.base * Math.pow(coef, state.step + 1));
}

function commitMartinStep() {
  const state = readMartinState();
  if (!state) return;
  const step = state.step + 1;
  localStorage.setItem(QBOT_MARTIN_KEY, JSON.stringify({ base: state.base, step }));
  localStorage.setItem("MartinSteps", String(step));
}

function readExpiryMs() {
  for (const input of document.querySelectorAll("input")) {
    const match = String(input.value || "").match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (!match) continue;
    const hours = match[3] ? Number(match[1]) : 0;
    const minutes = match[3] ? Number(match[2]) : Number(match[1]);
    const seconds = match[3] ? Number(match[3]) : Number(match[2]);
    const ms = ((hours * 60 + minutes) * 60 + seconds) * 1000;
    if (ms >= 5000 && ms <= 60 * 60 * 1000) return ms;
  }
  return 60000;
}

function readLatestHistoryRow() {
  const row = document.querySelector("div.lCITV");
  if (!row) return null;
  const text = (row.textContent || "").replace(/\s+/g, " ").trim();
  const match = text.match(/^([+-])?\s*([\d\s,.]+)\s*\$/);
  if (!match) return null;
  const amount = QbotDom.parseBalanceText((match[1] || "") + match[2]);
  if (!Number.isFinite(amount)) return null;
  const parentText = (row.parentElement?.textContent || "").replace(/\s+/g, " ").trim();
  const stakeMatch = parentText.match(/([\d\s,.]+)\s*\$/);
  const stake = stakeMatch ? QbotDom.parseBalanceText(stakeMatch[1]) : null;
  return {
    text,
    amount,
    stake: Number.isFinite(stake) && stake > 0 ? stake : null,
  };
}

function settleDeal(history, stake, balanceDelta) {
  const invest = history && history.stake > 0 ? history.stake : stake;
  if (history && Math.abs(history.amount) < 0.01 && invest > 0) {
    return { kind: "loss", delta: -invest };
  }
  if (history && history.amount > 0.009 && invest > 0) {
    const profit = Math.round((history.amount - invest) * 100) / 100;
    if (Math.abs(profit) < 0.02) return { kind: "refund", delta: 0 };
    if (profit > 0) return { kind: "win", delta: profit };
    return { kind: "loss", delta: profit };
  }
  if (!Number.isFinite(balanceDelta) || Math.abs(balanceDelta) < 0.01) {
    return { kind: "refund", delta: 0 };
  }
  if (balanceDelta < -0.009) {
    return { kind: "loss", delta: Math.round(balanceDelta * 100) / 100 };
  }
  return { kind: "win", delta: Math.round(balanceDelta * 100) / 100 };
}

async function readFreshBalance() {
  if (typeof QbotDom.readHeaderBalance !== "function") return NaN;
  for (let attempt = 0; attempt < 4; attempt++) {
    const header = await QbotDom.readHeaderBalance();
    if (Number.isFinite(header) && header > 0) return header;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return NaN;
}

// Обновление профита
async function updateProfit() {
  try {
    const currentBalance = Number(localStorage.getItem("sesionBalance"));
    if (!Number.isFinite(currentBalance) || currentBalance <= 0) {
      console.error("Invalid current balance value");
      return;
    }

    const summed = Number(localStorage.getItem("qbot_session_profit"));
    const profit = Number.isFinite(summed)
      ? Math.round(summed * 100) / 100
      : Math.round((currentBalance - (Number(localStorage.getItem("startBalance")) || currentBalance)) * 100) / 100;

    const profitElement = document.getElementById("resbalance");
    if (profitElement) {
      profitElement.textContent = profit.toLocaleString();

      if (profit >= 0) {
        profitElement.style.color = "#2ecc71";
        profitElement.style.borderColor = "rgba(46, 204, 113, 0.3)";
        profitElement.style.background = "rgba(46, 204, 113, 0.1)";
      } else {
        profitElement.style.color = "#e74c3c";
        profitElement.style.borderColor = "rgba(231, 76, 60, 0.3)";
        profitElement.style.background = "rgba(231, 76, 60, 0.1)";
      }
    }

    console.log("Текущий профит:", profit);
  } catch (error) {
    console.error("Error in updateProfit:", error);
  }
}

const collectPairTabElements = () => QbotDom.collectPairTabs();
const getPairTabName = (tab) => QbotDom.getPairTabName(tab);
const getPairTabClickTarget = (tab) => QbotDom.getPairTabClickTarget(tab);

// Запуск новой сделки
async function start() {
  if (localStorage.getItem("statusbot") === "notwork") return;
  if (qbotCycleBusy) return;
  qbotCycleBusy = true;

  if (hasOpenTradesPreventingNewDeal()) {
    console.warn("[Q-bot] Есть открытые сделки — ждём закрытия перед новым циклом.");
    scheduleStart(1500);
    return;
  }

  const baseInv = beginMartinCycle(getQbotSettings()["start-invest"] ?? 1);

  const labelElements = collectPairTabElements();

  if (labelElements.length === 0) {
    console.warn("Нет доступных валютных пар.");
    scheduleStart(2000);
    return;
  }

  const previousPairIndex = parseInt(localStorage.getItem("numpara"), 10);
  const prevIdx = Number.isNaN(previousPairIndex) ? -1 : previousPairIndex;

  let randomIndex;
  do {
    randomIndex = Math.floor(Math.random() * labelElements.length);
  } while (labelElements.length > 1 && randomIndex === prevIdx);

  const selectedTab = labelElements[randomIndex];
  const pairText = getPairTabName(selectedTab) || selectedTab.textContent.trim();

  let symbol = pairText
    .replace(/\s*\(OTC\)\s*/gi, "")
    .replace(/\//g, "")
    .trim();
  if (getQbotSettings()["deal-otc"] === "ON") {
    console.log("OTC mode ON");
    symbol = symbol.slice(0, 6);
    console.log(symbol);
  }

  localStorage.setItem("numpara", String(randomIndex));

  const clickTarget = getPairTabClickTarget(selectedTab) || selectedTab;
  try {
    clickTarget.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
  } catch (e) {
    /* ignore */
  }

  await new Promise((resolve) => {
    setTimeout(() => {
      clickTarget.click();
      if (clickTarget !== selectedTab) selectedTab.click();
      console.log(`✅ Переключение на пару: ${pairText}`);
      setTimeout(resolve, 950);
    }, 500);
  });

  // Проверяем демо или реал
  let chekuid = QbotDom.isDemoAccount();
  let Urls;
  if (chekuid) {
    Urls = "https://ai-tradebot.com/newsignal/signal.php?para=";
    console.log("Demo account");
  } else {
    Urls = "https://ai-tradingbot.pro/module/signalsTW/signals.php?para=";
    console.log("Real account");
  }
  // Задержка перед запросом сигнала (чтобы UI успел обновиться)
  await new Promise((resolve) => setTimeout(resolve, 1000));
  //Новая ссылка https://ai-tradebot.com/newsignal/signal.php?para=  старая https://ai-tradingbot.pro/module/signalsTW/signals.php?para
  try {
    console.log("Получение сигнала для:", symbol);
    const response = await fetch(Urls + encodeURIComponent(symbol));
    const data = await response.json();

    console.log("Сигнал получен:", data);

    const signal = normalizeSignalDirection(Array.isArray(data) ? data[0] : data);
    const logElement = document.querySelector(".log");
    if (logElement) {
      logElement.textContent = `${symbol} - ${signal || "нет"}`;
    }

    if (signal === "none" || !signal) {
      console.log("Сигнал не найден. Повтор через 1.5 сек.");
      scheduleStart(1500);
      return;
    }

    if (hasOpenTradesPreventingNewDeal()) {
      console.warn("[Q-bot] Перед открытием появились открытые сделки — откладываем.");
      scheduleStart(1500);
      return;
    }

    openDeal(signal, baseInv, symbol);
  } catch (error) {
    console.error("Ошибка при получении сигнала:", error);
    scheduleStart(2000);
  }
}

const findTradeDirectionButton = (direction) =>
  QbotDom.findTradeDirectionButton(direction);

const normalizePairSymbolKey = (raw) =>
  QbotDom.normalizePairSymbol(
    raw,
    getQbotSettings()["deal-otc"] === "ON" ? "ON" : "OFF"
  );

const hasFloatingProfitLossOpenIndicator = () =>
  QbotDom.hasFloatingProfitLossOpenIndicator();

const isActivePairTabMatchingSymbol = (symbol) =>
  QbotDom.isActivePairTabMatchingSymbol(symbol);

const getOpenTradesCountNewUi = () => QbotDom.getOpenTradesCount();

const hasOpenTradesPreventingNewDeal = () =>
  QbotDom.hasOpenTradesPreventingNewDeal();

function hasLegacyMoneyTabOpen() {
  return (
    document.querySelectorAll('[class*="Tabs-Tab-styles-module__money"]')
      .length > 0
  );
}

/** Если ввод в поле не сработал — добираем кнопками ± с задержкой (React успевает обновить DOM) */
function adjustInvestmentByStepperThen(input, target, onDone) {
  const { minus, plus } = findInvestmentStepperButtons(input);
  if (!plus && !minus) {
    onDone();
    return;
  }
  const maxSteps = 350;
  const pause = 26;
  let n = 0;
  const step = () => {
    if (robotStopped()) return;
    const cur = readNumericFromInvestmentField(input);
    if (investmentFieldMatchesAmount(target, cur) || n >= maxSteps) {
      if (n >= maxSteps && !investmentFieldMatchesAmount(target, cur)) {
        console.warn("[Q-bot] Степпер: не достигнута сумма", target, "сейчас", cur);
      }
      onDone();
      return;
    }
    if (cur < target && plus) plus.click();
    else if (cur > target && minus) minus.click();
    else {
      onDone();
      return;
    }
    n++;
    setTimeout(step, pause);
  };
  step();
}

// Открытие сделки
function openDeal(direction, amount, symbol, attempt = 0, onOpened = null) {
  if (robotStopped()) return;
  const way = normalizeSignalDirection(direction);
  if (!way) {
    console.error("[Q-bot] Неизвестное направление:", direction);
    scheduleStart(1000);
    return;
  }

  if (hasOpenTradesPreventingNewDeal()) {
    console.warn("[Q-bot] Есть открытые сделки — открытие отложено до закрытия.");
    setTimeout(() => openDeal(way, amount, symbol, attempt, onOpened), 1200);
    return;
  }

  if (typeof window !== "undefined" && window.__QBOT_DEAL_OPENING__) {
    setTimeout(() => openDeal(way, amount, symbol, attempt, onOpened), 700);
    return;
  }
  if (typeof window !== "undefined") {
    window.__QBOT_DEAL_OPENING__ = true;
    setTimeout(() => {
      window.__QBOT_DEAL_OPENING__ = false;
    }, 6000);
  }

  const amt = roundInvestmentAmount(amount);
  localStorage.setItem(QBOT_LAST_DEAL_AMOUNT_KEY, String(amt));

  try {
    const input = findTradeInvestmentInput();
    if (input) {
      try {
        input.focus({ preventScroll: true });
      } catch (e) {
        input.focus();
      }
      setInvestmentFieldValue(input, amt);
    } else {
      console.warn("[Q-bot] Поле суммы не найдено — открываем с текущей суммой на экране.");
    }
  } catch (e) {
    console.warn("[Q-bot] Ошибка установки суммы:", e);
  }

  const clickDirection = async () => {
    if (robotStopped()) return;
    try {
      const button = findTradeDirectionButton(way);
      if (button) {
        const before = await readFreshBalance();
        if (!Number.isFinite(before) || before <= 0) {
          console.warn("[Q-bot] Не вижу сумму в блоке DEMO/LIVE ACCOUNT, сделку не открываю.");
          if (typeof window !== "undefined") window.__QBOT_DEAL_OPENING__ = false;
          scheduleStart(1000);
          return;
        }
        localStorage.setItem("sesionBalance", String(before));
        const historyBefore = readLatestHistoryRow();
        localStorage.setItem(QBOT_HISTORY_BEFORE_KEY, historyBefore ? historyBefore.text : "");
        console.log("[Q-bot] Баланс перед сделкой:", before);
        button.click();
        if (typeof onOpened === "function") onOpened();
        console.log(`[Q-bot] Сделка: ${way} | ${symbol} | задано $${amt}`);
        setTimeout(() => activeDeal(way, symbol), 3500);
      } else if (attempt < 5) {
        window.__QBOT_DEAL_OPENING__ = false;
        console.warn("[Q-bot] Кнопка Выше/Ниже не найдена, повтор:", way);
        setTimeout(() => openDeal(way, amount, symbol, attempt + 1, onOpened), 600);
      } else {
        console.error("[Q-bot] Кнопка Выше/Ниже не найдена:", way);
        scheduleStart(1000);
      }
    } catch (e2) {
      console.error("[Q-bot] openDeal:", e2);
      scheduleStart(1000);
    }
  };

  setTimeout(() => {
    const inp = findTradeInvestmentInput();
    if (inp && !investmentFieldMatchesAmount(amt, readNumericFromInvestmentField(inp))) {
      adjustInvestmentByStepperThen(inp, amt, () =>
        setTimeout(clickDirection, 140)
      );
    } else {
      setTimeout(clickDirection, 320);
    }
  }, 120);
}

// Проверка активности сделки
function activeDeal(direction, symbol) {
  if (robotStopped()) return;
  let sawOpenTradesInNewUi = false;
  const dealOpenedAt = Date.now();
  const expiryMs = readExpiryMs();

  function onDealClosed() {
    clearInterval(qbotDealTimer);
    qbotDealTimer = null;
    if (robotStopped()) return;
    console.log("Сделка закрыта.");

    setTimeout(async () => {
      if (robotStopped()) return;
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const before = parseFloat(localStorage.getItem("sesionBalance")) || 0;
      const previousHistory = localStorage.getItem(QBOT_HISTORY_BEFORE_KEY) || "";
      const stake = Math.abs(Number(localStorage.getItem(QBOT_LAST_DEAL_AMOUNT_KEY)) || 0);
      let after = await readFreshBalance();
      let history = readLatestHistoryRow();
      const waitStarted = Date.now();
      while (Date.now() - waitStarted < 6000) {
        const historyFresh = history && history.text !== previousHistory;
        const balanceFresh = Number.isFinite(after) && Math.abs(after - before) >= 0.01;
        if (historyFresh || balanceFresh) break;
        await new Promise((resolve) => setTimeout(resolve, 400));
        after = await readFreshBalance();
        history = readLatestHistoryRow();
      }
      if (history && history.text === previousHistory) history = null;
      const balanceDelta = Number.isFinite(after) && before > 0
        ? Math.round((after - before) * 100) / 100
        : NaN;
      if (!history && !Number.isFinite(balanceDelta)) {
        console.warn("[Q-bot] После сделки нет ни баланса шапки, ни новой строки истории.");
        if (typeof window !== "undefined") window.__QBOT_DEAL_OPENING__ = false;
        scheduleStart(1000);
        return;
      }
      const settled = settleDeal(history, stake, balanceDelta);
      const lost = settled.kind === "loss";
      const strategy = getTradingStrategy();
      const total = Math.round(((Number(localStorage.getItem("qbot_session_profit")) || 0) + settled.delta) * 100) / 100;
      if (Number.isFinite(after) && after > 0) localStorage.setItem("sesionBalance", String(after));
      localStorage.setItem("qbot_session_profit", String(total));
      await updateProfit();
      console.log(
        "[Q-bot] Закрытие сделки: было",
        before,
        "стало",
        after,
        "история",
        history ? history.text : "нет",
        "ставка",
        history && history.stake ? history.stake : stake,
        "результат",
        settled.delta,
        settled.kind === "refund" ? "возврат" : lost ? "минус" : "плюс"
      );

      if (lost) {
        console.log("Сделка убыточная → мартингейл по стратегии:", strategy);
        if (strategy === "AI") await martinAI(direction, symbol);
        else if (strategy === "MARTIN") await martinClassic(direction, symbol);
        else scheduleStart(400);
      } else if (settled.kind === "refund") {
        console.log("Возврат суммы сделки, мартингейл не включается.");
        scheduleStart(400);
      } else {
        console.log("Сделка прибыльная.");
        scheduleStart(400);
      }
    }, 400);
  }

  if (qbotDealTimer) clearInterval(qbotDealTimer);
  qbotDealTimer = setInterval(() => {
    if (robotStopped()) {
      clearInterval(qbotDealTimer);
      qbotDealTimer = null;
      return;
    }
    const newCount = getOpenTradesCountNewUi();
    const plOpen =
      hasFloatingProfitLossOpenIndicator() &&
      isActivePairTabMatchingSymbol(symbol);
    const isOpen = (newCount !== null && newCount > 0) || plOpen;

    if (isOpen) sawOpenTradesInNewUi = true;
    if (sawOpenTradesInNewUi && !isOpen) {
      onDealClosed();
      return;
    }
    if (newCount !== null || plOpen) return;

    if (!sawOpenTradesInNewUi && Date.now() - dealOpenedAt >= expiryMs + 15000) {
      onDealClosed();
    }
  }, 1000);
}

// Мартингейл AI (с проверкой нового сигнала)
async function runMartin(direction, symbol, coef) {
  if (robotStopped()) return;
  const amount = peekNextMartinAmount(coef);
  if (amount == null) {
    console.log("Достигнуто максимальное количество шагов мартингейла:", martinLimit());
    scheduleStart(500);
    return;
  }
  const state = readMartinState();
  console.log(
    "[Q-bot] Мартин шаг",
    (state?.step || 0) + 1,
    "из",
    martinLimit(),
    "| база",
    state?.base,
    "→ ставка",
    amount
  );

  let way = direction;
  if (coef === 2.5) {
    const demo = QbotDom.isDemoAccount();
    const url = demo
      ? "https://ai-tradebot.com/newsignal/signal.php?para="
      : "https://ai-tradingbot.pro/module/signalsTW/signals.php?martin=1&para=";
    try {
      const response = await fetch(url + encodeURIComponent(symbol));
      const data = await response.json();
      const next = normalizeSignalDirection(Array.isArray(data) ? data[0] : data);
      if (next && next !== "none") way = next;
    } catch (error) {
      console.error("Ошибка при получении сигнала для мартин-АИ:", error);
    }
  }

  openDeal(way, amount, symbol, 0, commitMartinStep);
}

async function martinAI(direction, symbol) {
  await runMartin(direction, symbol, 2.5);
}

async function martinClassic(direction, symbol) {
  await runMartin(direction, symbol, 2.3);
}

localStorage.setItem("statusbot", "notwork");
