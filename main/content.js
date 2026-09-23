// Создаём <style> элемент с @font-face
const fontStyle = document.createElement("style");
fontStyle.textContent = `
  @font-face {
    font-family: 'Orbitron';
    src: url('${chrome.runtime.getURL(
      "css/font/Orbitron.ttf"
    )}') format('truetype');
    font-weight: normal;
    font-style: normal;
    font-display: swap;
  }

  /* Шрифт только для UI Q-BOT, не для всего #app Quotex */
  #qbot-trading-modal-root,
  #qbot-trading-modal-root *,
  #qbot-header-dock,
  #qbot-header-dock *,
  .qbot-header-bar,
  .qbot-header-bar *,
  .hed,
  .hid,
  .stop-button,
  .ai-modal,
  .ai-modal *,
  .vip-modal,
  .vip-modal * {
    font-family: 'Orbitron', sans-serif !important;
  }
`;
document.head.appendChild(fontStyle);

// --- Работа с localStorage ---
const STORAGE_KEY = "qbot_settings";

// Получить настройки из localStorage или использовать значения по умолчанию
function getStorage() {
  const storedData = localStorage.getItem(STORAGE_KEY);
  if (storedData) {
    try {
      return JSON.parse(storedData);
    } catch (e) {
      console.error("Ошибка при парсинге данных из localStorage:", e);
    }
  }

  // Значения по умолчанию, если в localStorage ничего нет или ошибка
  const defaultStorage = {
    "trading-straregia": "MARTIN",
    "deal-otc": "OFF",
    "martin-step": 3,
    "start-invest": 70,
    "stop-loss": 10,
    "take-profit": 15,
    "trailing-stop": false,
    "auto-reinvest": false,

    "signal-strength": 35, // Добавлено для ползунка
    "martin-steps": 6, // Добавлено для ползунка
    PD: "0", // VIP status
  };

  // Сохраняем значения по умолчанию в localStorage при первом запуске
  localStorage.setItem(STORAGE_KEY, JSON.stringify(defaultStorage));
  return defaultStorage;
}

// Сохранить настройки в localStorage
function saveStorage(storageObj) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(storageObj));
  } catch (e) {
    console.error("Ошибка при сохранении данных в localStorage:", e);
  }
}

// Инициализируем storage данными из localStorage или значениями по умолчанию
let storage = getStorage();

const QBOT_MODAL_ROOT_ID = "qbot-trading-modal-root";

// --- Основной код модального окна ---
function createTradingBotModal() {
  if (document.getElementById(QBOT_MODAL_ROOT_ID)) return;
  if (typeof window !== "undefined" && window.__QBOT_CREATING_TRADING_MODAL__) {
    return;
  }
  if (typeof window !== "undefined") {
    window.__QBOT_CREATING_TRADING_MODAL__ = true;
  }

  try {
  // Create the modal background
  const modalBackground = document.createElement("div");
  modalBackground.id = QBOT_MODAL_ROOT_ID;
  modalBackground.className = "modal-background";

  // Create the modal container
  const modalContainer = document.createElement("div");
  modalContainer.className = "modal-container";

  // Create the close button
  const closeButton = document.createElement("span");
  closeButton.className = "close-button";
  closeButton.innerHTML = "&times;";
  closeButton.onclick = () => {
    modalBackground.style.animation = "backdropFadeOut 0.4s ease";
    modalContainer.style.animation = "modalSlideDown 0.4s ease";
    setTimeout(() => {
      document.body.removeChild(modalBackground);
    }, 400);
  };

  // Create the menu
  const menu = document.createElement("div");
  menu.className = "menu1";

  const instructionsButton = document.createElement("button");
  instructionsButton.className = "menu1-button";
  instructionsButton.textContent = "Instructions";

  const vipButton = document.createElement("button");
  vipButton.className = "menu1-button";
  vipButton.textContent = "Buy VIP";

  const scalperButton = document.createElement("button");
  scalperButton.className = "menu1-button";
  scalperButton.textContent = "AI Analysis";

  menu.appendChild(instructionsButton);
  menu.appendChild(vipButton);
  menu.appendChild(scalperButton);

  // Create the container
  const container = document.createElement("div");
  container.className = "container1";

  const title = document.createElement("div");
  title.className = "qtitle";
  title.textContent = "Q-BOT 2.0";

  const tradingSession = document.createElement("div");
  tradingSession.className = "trading-session";
  tradingSession.innerHTML =
    "Current Trading Session: <span><b>New York</b></span>";

  // Helper function to create input groups
  const createInputGroup = (
    labelText,
    inputType,
    inputId,
    // Используем значение из storage как начальное
    inputValue = storage[inputId] !== undefined
      ? storage[inputId]
      : inputType === "checkbox"
      ? false
      : "",
    isCheckbox = false,
    min = null,
    max = null,
    additionalClass = ""
  ) => {
    const inputGroup = document.createElement("div");
    inputGroup.className = "input-group";

    const label = document.createElement("label");
    label.setAttribute("for", inputId);
    label.innerHTML = labelText;

    let input;

    if (isCheckbox) {
      inputGroup.classList.add("checkbox-group");
      label.classList.add("checkbox-label");
      input = document.createElement("input");
      input.type = "checkbox";
      input.id = inputId;
      input.name = inputId;
      // Устанавливаем состояние чекбокса из storage
      input.checked =
        inputValue === true || inputValue === "true" || inputValue === "ON";
      input.addEventListener("input", (e) => {
        handleCheckboxChange(inputId, e);
      });
    } else {
      input = document.createElement("input");
      input.type = inputType;
      input.id = inputId;
      input.name = inputId;
      input.value = inputValue;
      if (additionalClass) {
        input.className = additionalClass;
      }
      if (inputType === "range") {
        input.min = min;
        input.max = max;
        // Инициализируем отображение значения для range
        const displaySpan = document.getElementById(
          inputId.replace("-steps", "-value").replace("-strength", "-value")
        );
        if (displaySpan) {
          displaySpan.textContent = inputValue;
        }
        input.addEventListener("input", (e) => {
          handleRangeChange(inputId, e);
        });
      } else if (inputType === "number") {
        input.addEventListener("input", (e) => {
          handleNumberChange(inputId, e);
        });
      }
    }

    inputGroup.appendChild(label);
    inputGroup.appendChild(input);

    return inputGroup;
  };

  // Helper function to create sections
  const createSection = (title, className = "") => {
    const section = document.createElement("div");
    section.className = `input-section ${className}`;

    const sectionTitle = document.createElement("div");
    sectionTitle.className = "section-title";
    sectionTitle.textContent = title;
    section.appendChild(sectionTitle);

    return section;
  };

  // Event handlers - обновляют storage и сохраняют в localStorage
  function handleCheckboxChange(inputId, e) {
    if (inputId === "martingale") {
      document.getElementById("ai-trading").checked = false;
      storage["trading-straregia"] = "MARTIN";
      if (!document.getElementById("martingale").checked) {
        storage["trading-straregia"] = "Basic";
      }
    } else if (inputId === "ai-trading") {
      document.getElementById("martingale").checked = false;
      storage["trading-straregia"] = "AI";
      if (!document.getElementById("ai-trading").checked) {
        storage["trading-straregia"] = "Basic";
      }
    } else if (inputId === "otc-trading") {
      storage["deal-otc"] = document.getElementById("otc-trading").checked
        ? "ON"
        : "OFF";
    } else if (inputId === "trailing-stop") {
      storage["trailing-stop"] = e.target.checked;
    } else if (inputId === "auto-reinvest") {
      storage["auto-reinvest"] = e.target.checked;
    }
    // Сохраняем изменения в localStorage
    saveStorage(storage);
  }

  function handleRangeChange(inputId, e) {
    const value = e.target.value;
    if (inputId === "signal-strength") {
      document.getElementById("signal-value").textContent = value;
      storage["signal-strength"] = parseInt(value, 10); // Сохраняем как число
    } else if (inputId === "martin-steps") {
      document.getElementById("martin-value").textContent = value;
      storage["martin-steps"] = parseInt(value, 10); // Сохраняем как число
    }
    // Сохраняем изменения в localStorage
    saveStorage(storage);
  }

  function handleNumberChange(inputId, e) {
    const value = parseFloat(e.target.value) || 0; // Преобразуем в число, на всякий случай
    if (inputId === "investment") {
      storage["start-invest"] = value;
    } else if (inputId === "stop-loss") {
      storage["stop-loss"] = value;
    } else if (inputId === "take-profit") {
      storage["take-profit"] = value;
    }
    // Сохраняем изменения в localStorage
    saveStorage(storage);
  }

  // Create sections and inputs
  // Basic Settings Section
  const basicSection = createSection("⚡ Basic Settings");
  const investmentGroup = createInputGroup(
    "Investment Amount ($, ₸, R, €, ₽, ₹, £)",
    "number",
    "investment", // ID должно совпадать с ключом в storage
    storage["start-invest"] // Берём значение из storage
  );
  const signalStrengthGroup = createInputGroup(
    `Signal Strength: <span id="signal-value" class="range-display">${
      storage["signal-strength"] || 35
    }</span>%`,
    "range",
    "signal-strength",
    storage["signal-strength"] || 35, // Берём значение из storage
    false,
    15,
    100
  );

  basicSection.appendChild(investmentGroup);
  basicSection.appendChild(signalStrengthGroup);

  // Strategy Section
  const strategySection = createSection("🧠 Trading Strategy");
  const martingaleGroup = createInputGroup(
    "Classic Martingale",
    "checkbox",
    "martingale",
    storage["trading-straregia"] === "MARTIN", // Устанавливаем checked на основе значения в storage
    true
  );
  const aiTradingGroup = createInputGroup(
    "AI Trading ✧",
    "checkbox",
    "ai-trading",
    storage["trading-straregia"] === "AI", // Устанавливаем checked на основе значения в storage
    true
  );
  const otcTradingGroup = createInputGroup(
    "(OTC) Trading",
    "checkbox",
    "otc-trading",
    storage["deal-otc"] === "ON", // Устанавливаем checked на основе значения в storage
    true
  );
  const martinStepsGroup = createInputGroup(
    `Martingale Steps: <span id="martin-value" class="range-display">${
      storage["martin-steps"] || 6
    }</span>`,
    "range",
    "martin-steps",
    storage["martin-steps"] || 6, // Берём значение из storage
    false,
    1,
    10
  );

  strategySection.appendChild(martingaleGroup);
  strategySection.appendChild(aiTradingGroup);
  strategySection.appendChild(otcTradingGroup);
  strategySection.appendChild(martinStepsGroup);

  // Risk Management Section
  const riskSection = createSection("🛡️ Risk Management", "risk-management");
  const stopLossGroup = createInputGroup(
    "Stop Loss (%)",
    "number",
    "stop-loss", // ID должно совпадать с ключом в storage
    storage["stop-loss"], // Берём значение из storage
    false,
    null,
    null,
    "stop-loss-input"
  );
  const trailingStopGroup = createInputGroup(
    "Trailing Stop Loss",
    "checkbox",
    "trailing-stop", // ID должно совпадать с ключом в storage
    storage["trailing-stop"], // Берём значение из storage
    true
  );

  const riskRow = document.createElement("div");
  riskRow.className = "input-row";
  riskRow.appendChild(stopLossGroup);

  const trailingStopWrapper = document.createElement("div");
  trailingStopWrapper.appendChild(trailingStopGroup);
  riskRow.appendChild(trailingStopWrapper);

  riskSection.appendChild(riskRow);

  // Profit Management Section
  const profitSection = createSection(
    "💰 Profit Management",
    "profit-management"
  );
  const takeProfitGroup = createInputGroup(
    "Take Profit (%)",
    "number",
    "take-profit", // ID должно совпадать с ключом в storage
    storage["take-profit"], // Берём значение из storage
    false,
    null,
    null,
    "take-profit-input"
  );
  const autoReinvestGroup = createInputGroup(
    "Auto Re-invest Profits",
    "checkbox",
    "auto-reinvest", // ID должно совпадать с ключом в storage
    storage["auto-reinvest"], // Берём значение из storage
    true
  );

  const profitRow = document.createElement("div");
  profitRow.className = "input-row";
  profitRow.appendChild(takeProfitGroup);

  const autoReinvestWrapper = document.createElement("div");
  autoReinvestWrapper.appendChild(autoReinvestGroup);
  profitRow.appendChild(autoReinvestWrapper);

  profitSection.appendChild(profitRow);

  // Create start button
  const startButton = document.createElement("button");
  startButton.className = "start-button";
  startButton.innerHTML = "🚀 Start Robot";
  startButton.onclick = () => {
    startButton.innerHTML = "⚡ Initializing...";
    startButton.style.background =
      "linear-gradient(135deg, #2ecc71, #27ae60, #16a085)";
    startButton.style.animation = "none";

    setTimeout(() => {
      startButton.innerHTML = "🤖 Robot Active";
      setTimeout(() => {
        modalBackground.style.animation = "backdropFadeOut 0.4s ease";
        modalContainer.style.animation = "modalSlideDown 0.4s ease";
        setTimeout(() => {
          document.body.removeChild(modalBackground);
          showSuccessNotification();
          start();
          document.querySelector(".hid").style.visibility = "visible";
        }, 400);
      }, 400);
    }, 400);
  };

  // Append all elements to the container
  container.appendChild(title);
  container.appendChild(tradingSession);
  container.appendChild(basicSection);
  container.appendChild(strategySection);
  container.appendChild(riskSection);
  container.appendChild(profitSection);
  container.appendChild(startButton);

  // Append close button, menu, and container to the modal container
  modalContainer.appendChild(closeButton);
  modalContainer.appendChild(menu);
  modalContainer.appendChild(container);

  // Append modal container to the modal background
  modalBackground.appendChild(modalContainer);

  // Append modal background to the body
  document.body.appendChild(modalBackground);

  // Initialize trading session
  initializeTradingSession();

  // Initialize menu handlers
  initializeMenuHandlers(
    instructionsButton,
    vipButton,
    scalperButton,
    modalBackground
  );

  // Initialize VIP restrictions
  initializeVipRestrictions();
  } finally {
    if (typeof window !== "undefined") {
      window.__QBOT_CREATING_TRADING_MODAL__ = false;
    }
  }
}

function initializeTradingSession() {
  let tradeSesion = document.querySelector(".trading-session span");
  let tradeSesion1 = document.querySelector(".trading-session");

  function checkMoscowTime() {
    const moscowTime = new Date().toLocaleString("en-US", {
      timeZone: "Europe/Moscow",
    });
    const moscowDate = new Date(moscowTime);
    const tm = moscowDate.getHours();

    if (tm >= 11 && tm <= 15) {
      tradeSesion.innerText = "London 🇬🇧";
      tradeSesion1.style.background =
        "linear-gradient(135deg, #2ecc71, #27ae60)";
      tradeSesion1.style.color = "white";
      tradeSesion1.style.boxShadow = "0 0 30px rgba(46, 204, 113, 0.4)";
    } else if (tm >= 16 && tm <= 19) {
      tradeSesion.innerText = "London & New York 🌍";
      tradeSesion1.style.background =
        "linear-gradient(135deg, #f39c12, #e67e22)";
      tradeSesion1.style.color = "white";
      tradeSesion1.style.boxShadow = "0 0 30px rgba(243, 156, 18, 0.4)";
    } else if (tm >= 20 && tm <= 23) {
      tradeSesion.innerText = "New York 🇺🇸";
      tradeSesion1.style.background =
        "linear-gradient(135deg, #3498db, #2980b9)";
      tradeSesion1.style.color = "white";
      tradeSesion1.style.boxShadow = "0 0 30px rgba(52, 152, 219, 0.4)";
    } else if (tm >= 2 && tm <= 8) {
      tradeSesion.innerText = "Sydney & Tokyo 🌏";
      tradeSesion1.style.background =
        "linear-gradient(135deg, #9b59b6, #8e44ad)";
      tradeSesion1.style.color = "white";
      tradeSesion1.style.boxShadow = "0 0 30px rgba(155, 89, 182, 0.4)";
    } else if (tm >= 9 && tm <= 10) {
      tradeSesion.innerText = "Tokyo 🇯🇵";
      tradeSesion1.style.background =
        "linear-gradient(135deg, #e74c3c, #c0392b)";
      tradeSesion1.style.color = "white";
      tradeSesion1.style.boxShadow = "0 0 30px rgba(231, 76, 60, 0.4)";
    } else {
      tradeSesion.innerText = "Market Closed 😴";
      tradeSesion1.style.background =
        "linear-gradient(135deg, #95a5a6, #7f8c8d)";
      tradeSesion1.style.color = "white";
      tradeSesion1.style.boxShadow = "0 0 30px rgba(149, 165, 166, 0.4)";
    }
  }

  checkMoscowTime();
  setInterval(checkMoscowTime, 60000);
}

function initializeMenuHandlers(
  instructionsButton,
  vipButton,
  scalperButton,
  modalBackground
) {
  instructionsButton.onclick = function () {
    showNotification("📚 Opening instructions in new tab...", "#3498db");
    setTimeout(() => {
      window.open("https://ai-tradingbot.pro/qbot/lesons.html  ", "_blank");
    }, 1000);
  };

  vipButton.addEventListener("click", (event) => {
    showNotification("💎 Redirecting to VIP purchase...", "#f39c12");

    setTimeout(() => {
      modalBackground.style.animation = "backdropFadeOut 0.4s ease";
      setTimeout(() => {
        document.body.removeChild(modalBackground);
        window.location.href = "https://ai-tradingbot.pro/buy/vip.php";
      }, 400);
    }, 1500);
  });

  scalperButton.addEventListener("click", (event) => {
    showNotification("🤖 Loading AI Analysis module...", "#9b59b6");
    setTimeout(() => {
      modalBackground.style.animation = "backdropFadeOut 0.4s ease";
      setTimeout(() => {
        document.body.removeChild(modalBackground);
        ai();
      }, 400);
    }, 400);
  });
}

function initializeVipRestrictions() {
  const dostup = storage["PD"];
  const vipButton = document.querySelector(".menu1-button:nth-child(2)");

  if (dostup === "1") {
    vipButton.innerHTML = "💎 VIP Active";
    vipButton.style.background = "linear-gradient(135deg, #ffd700, #ffed4a)";
    vipButton.style.color = "#333";
    vipButton.style.fontWeight = "700";
  }

  function vipdostup(idtag) {
    if (dostup === "0") {
      const element = document.getElementById(idtag);
      if (element) {
        element.disabled = true;
        element.title = "Available for VIP users only!";

        const tooltip = document.createElement("span");
        tooltip.textContent = "⭐ VIP Feature - Upgrade to unlock!";
        tooltip.className = "tooltip";

        element.closest(".input-group").appendChild(tooltip);
        element.closest(".input-group").style.opacity = "0.6";
        element.closest(".input-group").style.filter = "grayscale(50%)";
      }
    }
  }

  // Apply VIP restrictions
  vipdostup("otc-trading");
  vipdostup("signal-strength");
  vipdostup("martin-steps");
  vipdostup("trailing-stop");
  vipdostup("auto-reinvest");
  vipdostup("stop-loss");
  vipdostup("take-profit");
}

function showNotification(message, color = "#667eea") {
  const notification = document.createElement("div");
  notification.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                background: linear-gradient(135deg, ${color}, ${color}dd);
                color: white;
                padding: 15px 25px;
                border-radius: 10px;
                font-weight: 600;
                z-index: 20000;
                box-shadow: 0 10px 30px rgba(0,0,0,0.3);
                animation: slideInRight 0.5s ease;
                border: 1px solid rgba(255,255,255,0.2);
            `;
  notification.textContent = message;
  document.body.appendChild(notification);

  setTimeout(() => {
    notification.style.animation = "slideOutRight 0.5s ease";
    setTimeout(() => {
      if (notification.parentNode) {
        document.body.removeChild(notification);
      }
    }, 500);
  }, 3000);
}

function showSuccessNotification() {
  const settings = `
🤖 Q-BOT 2.0 Successfully Activated!

⚙️ Configuration:
• Strategy: ${storage["trading-straregia"]}
• Investment: ${storage["start-invest"]}
• Stop Loss: ${storage["stop-loss"]}%
• Take Profit: ${storage["take-profit"]}%
• OTC Trading: ${storage["deal-otc"]}
• Martingale Steps: ${
    storage["martin-steps"] || storage["martin-step"]
  } // Используем martin-steps из storage
• Trailing Stop: ${storage["trailing-stop"] ? "ON" : "OFF"}
• Auto Re-invest: ${storage["auto-reinvest"] ? "ON" : "OFF"}
• Signal Strength: ${storage["signal-strength"]}% // Добавлено

🚀 Robot is now actively monitoring markets!
            `;

  showNotification("🎉 Q-BOT 2.0 Activated Successfully!", "#2ecc71");

  setTimeout(() => {
    // alert(settings);
  }, 1000);
}

// --- Вызов функции для создания модального окна ---
// createTradingBotModal(); // Предполагается, что эта функция вызывается где-то в коде
