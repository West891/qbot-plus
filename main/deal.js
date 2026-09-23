function getCleanBalance() {
  const element = QbotDom.findBalance();
  if (!element) {
    console.warn("Элемент баланса не найден.");
    return 0;
  }

  const balanceText = element.innerText || element.textContent;
  const cleaned = balanceText.replace(/[,\$₸R€₽₹£\s]/g, "").trim();

  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : Math.round(parsed);
}

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

/** Поле суммы: на Quotex два степпера ._hHHo — сверху время, ниже инвестиции */
function findTradeInvestmentInput() {
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

/** База для мартингейла: последняя реальная ставка из openDeal, иначе поле, иначе настройки */
function getAmountForNextMartin() {
  const last = parseFloat(
    localStorage.getItem(QBOT_LAST_DEAL_AMOUNT_KEY) || "",
    10
  );
  if (!Number.isNaN(last) && last > 0) return roundInvestmentAmount(last);
  const inp = findTradeInvestmentInput();
  const v = inp
    ? parseFloat(String(inp.value).replace(/[^0-9.]/g, ""), 10)
    : NaN;
  if (!Number.isNaN(v) && v > 0) return roundInvestmentAmount(v);
  return roundInvestmentAmount(getQbotSettings()["start-invest"] ?? 1);
}

// Обновление профита
function updateProfit() {
  try {
    const currentBalance = Number(getCleanBalance());
    if (isNaN(currentBalance)) {
      console.error("Invalid current balance value");
      return;
    }

    const startBalance = Number(localStorage.getItem("startBalance")) || 0;
    const profit = currentBalance - startBalance;

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
  if (hasOpenTradesPreventingNewDeal()) {
    console.warn("[Q-bot] Есть открытые сделки — ждём закрытия перед новым циклом.");
    setTimeout(start, 1500);
    return;
  }

  localStorage.setItem("MartinSteps", "0");
  const baseInv = roundInvestmentAmount(getQbotSettings()["start-invest"] ?? 1);
  localStorage.setItem(QBOT_LAST_DEAL_AMOUNT_KEY, String(baseInv));

  const currentBalance = getCleanBalance();
  localStorage.setItem("sesionBalance", currentBalance);

  const labelElements = collectPairTabElements();

  if (labelElements.length === 0) {
    console.warn("Нет доступных валютных пар.");
    setTimeout(start, 2000);
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

  const clickTarget = getPairTabClickTarget(selectedTab);
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

    const signal = Array.isArray(data) ? data[0] : data;
    const logElement = document.querySelector(".log");
    if (logElement) {
      logElement.textContent = `${symbol} - ${signal}`;
    }

    if (signal === "none") {
      console.log("Сигнал не найден. Повтор через 1.5 сек.");
      setTimeout(start, 1500);
      return;
    }

    if (hasOpenTradesPreventingNewDeal()) {
      console.warn("[Q-bot] Перед открытием появились открытые сделки — откладываем.");
      setTimeout(start, 1500);
      return;
    }

    const investment = String(getQbotSettings()["start-invest"] ?? "1");
    openDeal(signal, investment, symbol);
  } catch (error) {
    console.error("Ошибка при получении сигнала:", error);
    setTimeout(start, 2000);
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
function openDeal(direction, amount, symbol) {
  if (hasOpenTradesPreventingNewDeal()) {
    console.warn("[Q-bot] Есть открытые сделки — открытие отложено до закрытия.");
    setTimeout(() => openDeal(direction, amount, symbol), 1200);
    return;
  }

  if (typeof window !== "undefined" && window.__QBOT_DEAL_OPENING__) {
    console.warn("[Q-bot] Уже выполняется открытие сделки — пропуск.");
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

  const clickDirection = () => {
    try {
      const button = findTradeDirectionButton(direction);
      if (button) {
        button.click();
        console.log(
          `[Q-bot] Сделка: ${direction} | ${symbol} | задано $${amt}`
        );
        setTimeout(() => activeDeal(direction, symbol), 3500);
      } else {
        console.error("[Q-bot] Кнопка Выше/Ниже не найдена:", direction);
        setTimeout(start, 1000);
      }
    } catch (e2) {
      console.error("[Q-bot] openDeal:", e2);
      setTimeout(start, 1000);
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
  let sawOpenTradesInNewUi = false;
  const dealOpenedAt = Date.now();
  const MIN_OPEN_MS = 3000;

  function onDealClosed() {
    clearInterval(intervalId);
    console.log("Сделка закрыта.");

    setTimeout(updateProfit, 500);

    setTimeout(async () => {
      const sessionBalance =
        parseInt(localStorage.getItem("sesionBalance"), 10) || 0;

      let currentBalance = getCleanBalance();
      if (currentBalance >= sessionBalance && sessionBalance > 0) {
        await new Promise((r) => setTimeout(r, 2500));
        currentBalance = getCleanBalance();
      }

      const strategy = getTradingStrategy();
      console.log(
        "[Q-bot] Закрытие сделки: баланс",
        currentBalance,
        "на старт",
        sessionBalance,
        "стратегия",
        strategy
      );

      if (currentBalance < sessionBalance) {
        console.log("Сделка убыточная → мартингейл по стратегии:", strategy);
        if (strategy === "AI") {
          await martinAI(direction, symbol);
        } else if (strategy === "MARTIN") {
          await martinClassic(direction, symbol);
        } else {
          start();
        }
      } else {
        console.log("Сделка прибыльная или без изменения баланса.");
        start();
      }
    }, 1500);
  }

  const intervalId = setInterval(() => {
    const newCount = getOpenTradesCountNewUi();
    const plOpen =
      hasFloatingProfitLossOpenIndicator() &&
      isActivePairTabMatchingSymbol(symbol);
    const isOpen =
      (newCount !== null && newCount > 0) || plOpen;

    if (isOpen) sawOpenTradesInNewUi = true;

    if (sawOpenTradesInNewUi && !isOpen) {
      onDealClosed();
      return;
    }

    if (newCount !== null || plOpen) {
      return;
    }

    if (!sawOpenTradesInNewUi) {
      if (hasLegacyMoneyTabOpen()) return;
      if (Date.now() - dealOpenedAt < MIN_OPEN_MS) return;
      onDealClosed();
    }
  }, 1000);
}

// Мартингейл AI (с проверкой нового сигнала)
async function martinAI(direction, symbol) {
  const maxSteps =
    parseInt(String(getQbotSettings()["martin-steps"] ?? 6), 10) || 6;
  let currentStep = parseInt(localStorage.getItem("MartinSteps")) || 0;

  if (currentStep >= maxSteps) {
    console.log("Достигнуто максимальное количество шагов мартингейла.");
    start();
    return;
  }

  const cof = 2.5;
  const amount = getAmountForNextMartin();
  const newAmount = roundInvestmentAmount(amount * cof);
  console.log(
    "[Q-bot] Мартин AI: база",
    amount,
    "→ следующая ставка",
    newAmount
  );
  // Проверяем демо или реал
  let chekuid = QbotDom.isDemoAccount();
  let Urls;
  if (chekuid) {
    Urls = "https://ai-tradebot.com/newsignal/signal.php?para=";
    console.log("Demo account1");
  } else {
    Urls =
      "https://ai-tradingbot.pro/module/signalsTW/signals.php?martin=1&para=";
    console.log("Real account1");
  }
  // Проверяем актуальный сигнал // https://ai-tradingbot.pro/module/signalsTW/signals.php?martin=1&para=
  try {
    const response = await fetch(Urls + encodeURIComponent(symbol));
    const data = await response.json();
    const newDirection = Array.isArray(data) ? data[0] : data;

    const finalDirection = newDirection === "none" ? direction : newDirection;
    console.log(`Мартин AI: ${finalDirection}, сумма: ${newAmount}`);

    localStorage.setItem("sesionBalance", getCleanBalance());
    openDeal(finalDirection, newAmount, symbol);
    localStorage.setItem("MartinSteps", (currentStep + 1).toString());
  } catch (error) {
    console.error("Ошибка при получении сигнала для мартин-АИ:", error);
    openDeal(direction, newAmount, symbol);
    localStorage.setItem("MartinSteps", (currentStep + 1).toString());
  }
}

// Классический мартингейл (без смены направления)
async function martinClassic(direction, symbol) {
  const maxSteps =
    parseInt(String(getQbotSettings()["martin-step"] ?? 3), 10) || 3;
  let currentStep = parseInt(localStorage.getItem("MartinSteps")) || 0;

  if (currentStep >= maxSteps) {
    console.log(
      "Достигнуто максимальное количество шагов классического мартингейла."
    );
    start();
    return;
  }

  const cof = 2.3;
  const amount = getAmountForNextMartin();
  const newAmount = roundInvestmentAmount(amount * cof);
  console.log(
    "[Q-bot] Мартин: база",
    amount,
    "→ следующая ставка",
    newAmount
  );

  console.log(`Мартин Классик: ${direction}, сумма: ${newAmount}`);
  localStorage.setItem("sesionBalance", getCleanBalance());
  openDeal(direction, newAmount, symbol);
  localStorage.setItem("MartinSteps", (currentStep + 1).toString());
}
