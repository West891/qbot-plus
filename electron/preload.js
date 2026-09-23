const { ipcRenderer } = require("electron");

document.addEventListener("qbot-capture-request", async (event) => {
  const id = event.detail && event.detail.id;
  if (!id) return;

  let response = {};
  let error = "";
  try {
    const screenshot = await ipcRenderer.invoke("qbot-capture");
    response = { screenshot };
  } catch (e) {
    error = e && e.message ? e.message : "Не удалось сделать скриншот";
  }

  document.dispatchEvent(
    new CustomEvent("qbot-capture-result", {
      detail: { id, response, error },
    })
  );
});
