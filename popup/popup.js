
if (chrome.proxy) {
    console.log("Proxi ok")
  } else {
    console.log("Proxi no")
  }




// popup.js

let proxyEnabled = false;

// Функция переключения прокси
function toggleProxy() {

  if (proxyEnabled) {
    // Отключаем прокси
    chrome.proxy.settings.set({mode: 'direct'});
    console.log("прокси выключил");
  } else {
    // Включаем прокси
    chrome.proxy.settings.set({ mode: "direct" });
    console.log("прокси не настроен");
  }

  proxyEnabled = !proxyEnabled;

}

// Повесить обработчик на кнопку
document.getElementById("toggleProxy").addEventListener("click", toggleProxy.bind(this));