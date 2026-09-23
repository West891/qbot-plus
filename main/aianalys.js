function ai() {
  // Check user access
  const hasAccess = storage["PD"] === "1";

  // Create the base structure of the modal window
  const aiModalHTML = `
                <div id="aiModal" class="ai-modal">
                    <div class="ai-modal-content">
                        <div class="ai-modal-header">
                            <h3 class="ai-modal-title">🤖 AI Analyzer</h3>
                            <span class="ai-close">&times;</span>
                        </div>
                        
                        <div class="ai-modal-body">
                            ${
                              hasAccess
                                ? createPremiumContent()
                                : createFreeContent()
                            }
                        </div>
                    </div>
                </div>
            `;

  const gen = hasAccess ? 30 : 5; // Set the number of generations for VIP and free users

  // Create and add the modal window
  const aiContainer = document.createElement("div");
  aiContainer.innerHTML = aiModalHTML;
  document.body.appendChild(aiContainer);

  // Initialize the modal window
  initModal();

  // Function to create content for premium users
  function createPremiumContent() {
    return `
                    <div class="ai-content-container">
                        <button id="capture" class="ai-button ai-primary-button">
                            <span class="ai-button-icon">✨</span>
                            <span class="ai-button-text">AI Analyze</span>
                        </button>
                        
                        <div class="preloader" id="preloader">
                            <span></span><span></span><span></span>
                        </div>
                        
                        <div class="ai-result-container">
                            <div class="ai-price">Click the AI Analyze button to start...</div>
                        </div>
                    </div>
                `;
  }

  // Function to create content for regular users
  function createFreeContent() {
    return `
                    <div class="ai-content-container">
                        <div class="ai-premium-banner">
                            <div class="ai-premium-image" style="width: 120px; height: 120px; background: linear-gradient(135deg, #ec4899, #db2777); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 15px; font-size: 48px;">🔒</div>
                            <p class="ai-premium-text">Available only for VIP users!</p>
                        </div>
                        
                        <div class="preloader" id="preloader">
                            <span></span><span></span><span></span>
                        </div>
                        
                        <button id="vipb" class="ai-button ai-upgrade-button">
                            <span class="ai-button-icon">💎</span>
                            <span class="ai-button-text">Get Premium</span>
                        </button>
                    </div>
                `;
  }

  // Modal window initialization function
  function initModal() {
    const aiModal = document.getElementById("aiModal");
    const aiClose = document.getElementsByClassName("ai-close")[0];

    // Handler for closing by clicking the cross
    aiClose.onclick = function () {
      aiModal.style.animation = "backdropFadeOut 0.4s ease";
      setTimeout(() => {
        aiModal.style.display = "none";
        aiModal.remove();
      }, 400);
    };

    // Handler for closing by clicking outside the modal window
    window.onclick = function (event) {
      if (event.target == aiModal) {
        aiModal.style.animation = "backdropFadeOut 0.4s ease";
        setTimeout(() => {
          aiModal.style.display = "none";
          aiModal.remove();
        }, 400);
      }
    };

    // Show the modal window
    aiModal.style.display = "flex";

    // Configure functionality depending on the user type
    if (hasAccess) {
      setupCaptureButton();
    } else {
      setupUpgradeButton();
    }
  }

  // Set up the capture button
  function setupCaptureButton() {
    const captureButton = document.getElementById("capture");
    const preloader = document.getElementById("preloader");
    const resultContainer = document.querySelector(".ai-price");
    const aiModal = document.getElementById("aiModal");

    function delay(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    if (captureButton && preloader && resultContainer) {
      captureButton.addEventListener("click", async () => {
        // Clear previous results
        aiModal.style.opacity = 0;
        resultContainer.innerHTML = "🔄 Processing your request...";

        // Show preloader
        preloader.style.display = "flex";

        try {
          // Add delay before screenshot
          await delay(800);

          const response = await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(
              { action: "captureScreen" },
              (response) => {
                if (chrome.runtime.lastError) {
                  reject(chrome.runtime.lastError);
                } else {
                  resolve(response);
                }
              }
            );
          });

          if (response.screenshot) {
            const screenshot = response.screenshot;
            aiModal.style.opacity = 1;

            // Fixed error: extra spaces in URL
            const serverUrl = "https://ai-tradingbot.pro/imgai/upload3.php";
            const formData = new FormData();
            formData.append(
              "image",
              dataURLToBlob(screenshot),
              "screenshot.png"
            );

            const res = await fetch(serverUrl, {
              method: "POST",
              body: formData,
            });
            console.log(res);
            const result = await res.json();

            // Fixed error: randomResult variable is not defined
            // Assume it should be result.text or another variable
            console.log(result.analysis);
            const displayResult =
              result.analysis || result.analysis || "Analysis completed";

            if (result.analysis) {
              resultContainer.innerHTML = `
                                <div class="ai-result-header">🤖 AI Analysis Results:</div>
                                <div class="ai-result-content">${displayResult.replace(
                                  /\n/g,
                                  "<br>"
                                )}</div>
                            `;
              localStorage.setItem("url", result.analysis);
            }
          }
        } catch (error) {
          console.error("Error:", error);
          resultContainer.innerHTML = `
                                <div class="ai-error">
                                    <span class="ai-error-icon">⚠️</span>
                                    <span class="ai-error-text">Failed to analyze market data.</span>
                                </div>
                            `;
        } finally {
          // Hide preloader
          preloader.style.display = "none";
        }
      });
    }
  }

  // Set up the upgrade button
  function setupUpgradeButton() {
    const upgradeButton = document.getElementById("vipb");

    if (upgradeButton) {
      upgradeButton.addEventListener("click", () => {
        showNotification("💎 Redirecting to VIP purchase...", "#ec4899");

        setTimeout(() => {
          const aiModal = document.getElementById("aiModal");
          if (aiModal) {
            aiModal.style.display = "none";
            aiModal.remove();
            window.location.href = "https://ai-tradingbot.pro/buy/vip.php";
          }
        }, 1500);
      });
    }
  }

  // Usage limitation logic
  // Moved inside setupCaptureButton for correct execution order
  setTimeout(() => {
    const button = document.getElementById("capture");
    const message = document.querySelector(".ai-price");

    if (button && message) {
      // Get data from localStorage
      const storedData = localStorage.getItem("analys_click_data");
      const today = new Date().toISOString().split("T")[0];

      let clickData = {
        date: today,
        count: 0,
      };

      if (storedData) {
        const parsedData = JSON.parse(storedData);
        if (parsedData.date === today) {
          clickData = parsedData;
        } else {
          // New day - reset counter
          clickData.count = 0;
          clickData.date = today;
          localStorage.setItem("analys_click_data", JSON.stringify(clickData));
        }
      } else {
        localStorage.setItem("analys_click_data", JSON.stringify(clickData));
      }

      // Update button text
      button.innerHTML = `<span class="ai-button-icon">✨</span><span class="ai-button-text">AI Analyze (${clickData.count}/${gen})</span>`;

      // Check limit
      if (clickData.count >= gen) {
        button.disabled = true;

        if (hasAccess) {
          message.innerHTML = `
                            <div class="ai-error">
                                <span class="ai-error-icon">⚠️</span>
                                <span class="ai-error-text">Today's limit has been reached.</span>
                            </div>
                        `;
        } else {
          message.innerHTML = `
                            <div class="ai-error">
                                <span class="ai-error-icon">⚠️</span>
                                <span class="ai-error-text">Today's limit has been reached! If you need more, <span class="vip-link" id="vipbb">get VIP access</span>.</span>
                            </div>
                        `;

          // Use event delegation or setTimeout for correct operation
          setTimeout(() => {
            const upgradeLink = document.getElementById("vipbb");
            if (upgradeLink) {
              upgradeLink.addEventListener("click", () => {
                showNotification(
                  "💎 Redirecting to VIP purchase...",
                  "#ec4899"
                );

                setTimeout(() => {
                  const aiModal = document.getElementById("aiModal");
                  if (aiModal) {
                    aiModal.style.display = "none";
                    aiModal.remove();
                  }
                }, 1500);
              });
            }
          }, 100);
        }
      }

      button.addEventListener("click", () => {
        if (clickData.count >= gen) return;

        clickData.count += 1;
        localStorage.setItem("analys_click_data", JSON.stringify(clickData));
        button.innerHTML = `<span class="ai-button-icon">✨</span><span class="ai-button-text">AI Analyze (${clickData.count}/${gen})</span>`;

        if (clickData.count === gen) {
          button.disabled = true;
          message.innerHTML = `
                            <div class="ai-error">
                                <span class="ai-error-icon">⚠️</span>
                                <span class="ai-error-text">You have used your AI analysis limit for today.</span>
                            </div>
                        `;
        }

        console.log("Button clicked:", clickData.count);
      });
    }
  }, 100); // Small delay to ensure DOM elements are created
}

function showNotification(message, color) {
  const notification = document.createElement("div");
  notification.style.cssText = `
                position: fixed;
                top: 80px;
                right: 20px;
                background: linear-gradient(135deg, ${color}, ${color}dd);
                color: white;
                padding: 15px 25px;
                border-radius: 12px;
                font-weight: 600;
                z-index: 20000;
                box-shadow: 0 10px 30px rgba(0,0,0,0.3);
                animation: slideInRight 0.5s ease;
                border: 1px solid rgba(255,255,255,0.2);
                backdrop-filter: blur(10px);
                font-family: 'Inter', sans-serif;
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

// Add animations for notifications and modal window
const style = document.createElement("style");
style.textContent = `
            @keyframes slideInRight {
                from { transform: translateX(100%); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
            
            @keyframes slideOutRight {
                from { transform: translateX(0); opacity: 1; }
                to { transform: translateX(100%); opacity: 0; }
            }
            
            @keyframes backdropFadeOut {
                from { 
                    opacity: 1;
                    backdrop-filter: blur(15px) saturate(180%);
                }
                to { 
                    opacity: 0;
                    backdrop-filter: blur(0px) saturate(100%);
                }
            }
            
            @keyframes modalSlideDown {
                from { 
                    opacity: 1;
                    transform: translateY(0) scale(1) rotateX(0deg);
                }
                to { 
                    opacity: 0;
                    transform: translateY(100px) scale(0.8) rotateX(-15deg);
                }
            }
        `;
document.head.appendChild(style);

// Added missing dataURLToBlob function
function dataURLToBlob(dataURL) {
  let byteString;
  if (dataURL.split(",")[0].indexOf("base64") >= 0) {
    byteString = atob(dataURL.split(",")[1]);
  } else {
    byteString = unescape(dataURL.split(",")[1]);
  }

  const mimeString = dataURL.split(",")[0].split(":")[1].split(";")[0];
  const ia = new Uint8Array(byteString.length);
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i);
  }
  return new Blob([ia], { type: mimeString });
}
