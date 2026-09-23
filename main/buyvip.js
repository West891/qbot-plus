function byvip() {
  // Define the modal structure as a string
  var vipModalHTML = `
        <div id="vipModal" class="vip-modal">
            <div class="vip-modal-content">
                <span class="vip-close">&times;</span>
                <img src="https://evo-lution.ru/vip.png" alt="VIP Access" style="margin-left: 80px;">
                <h2 class="vip-color1">VIP Access</h2>
                <div class="vip-price">
                    <span>39 USD</span>
                    <span class="vip-old-price">69 USD</span>
                </div>
                <ul class="vip-color">
                    <li>Lifetime access to Q-bot</li>
                    <li>AI-driven trading</li>
                    <li>Improved signal search algorithm</li>
                    <li>Flexible adjustment of signal quality</li>
                    <li>Weekend trading (OTC)</li>
                </ul>
               
                <button id="vipBuyAccess">Buy Access</button>
                <p><a class="vip-link" target="_blank" href="https://youlink.biz/EXwr">Learn how to get VIP access for free ></a></p>
                <p>*****</p>
                <p><a class="vip-link" target="_blank" href="https://t.me/o_signals1">Write to support ></a></p>
            </div>
        </div>
    `;

  // Create a new div element
  var vipDiv = document.createElement("div");

  // Set the innerHTML of the new div to the modal structure
  vipDiv.innerHTML = vipModalHTML;

  // Append the new div to the body
  document.body.appendChild(vipDiv);

  // Get the modal
  var vipModal = document.getElementById("vipModal");

  // Get the <span> element that closes the modal
  var vipSpan = document.getElementsByClassName("vip-close")[0];

  // When the user clicks on <span> (x), close the modal
  vipSpan.onclick = function () {
    vipModal.style.display = "none";
  };

  // When the user clicks anywhere outside of the modal, close it
  window.onclick = function (event) {
    if (event.target == vipModal) {
      vipModal.style.display = "none";
    }
  };

  // Show the modal
  vipModal.style.display = "flex";

  document.getElementById("vipBuyAccess").onclick = function () {
    window.open("https://ai-tradingbot.pro/buy/pay.php", "_blank");
  };
}
