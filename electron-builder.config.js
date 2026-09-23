const repo = require("./electron/github-update.json");

const owner = String(repo.owner || "").trim();
const name = String(repo.repo || "qbot-plus").trim();
const canPublish = owner && owner !== "REPLACE_OWNER" && name;
if (process.argv.includes("always") && !canPublish) {
  throw new Error("Укажите owner и repo в electron/github-update.json");
}

module.exports = {
  appId: "pro.aitradingbot.qbotplus",
  productName: "Q-bot PLUS",
  directories: { output: "dist" },
  files: [
    "electron/**/*",
    "main/**/*",
    "css/**/*",
    "logo/**/*",
    "popup/**/*",
    "privacy/**/*",
    "manifest.json",
    "package.json",
  ],
  asar: true,
  publish: canPublish
    ? [{ provider: "github", owner, repo: name }]
    : undefined,
  win: {
    target: ["nsis"],
    icon: "logo/logo-128.png",
  },
  nsis: {
    oneClick: true,
    perMachine: false,
    allowToChangeInstallationDirectory: false,
    deleteAppDataOnUninstall: false,
    shortcutName: "Q-bot PLUS",
    uninstallDisplayName: "Q-bot PLUS",
  },
};
