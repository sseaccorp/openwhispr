const fs = require("node:fs");
const path = require("node:path");

function isQaCheckout(repo) {
  return fs.existsSync(path.join(repo, "flosi-qa-checkout.json"));
}

function assertExplicitQaMode(repo, env = process.env) {
  if (isQaCheckout(repo) && env.FLOSI_VARIANT !== "qa")
    throw new Error(
      "This is a Flosi QA checkout. Start with scripts/flosi-qa.ps1 -Action Run; ordinary Electron/npm start cannot access the original profile."
    );
}

function assertLegacyEntryAllowed(repo) {
  if (isQaCheckout(repo))
    throw new Error(
      "Flosi QA blocks the original start/dev/build/download/cleanup lifecycle. Use scripts/flosi-qa.ps1 -Action Prepare, Check or Run. No original cache was migrated."
    );
}

module.exports = { isQaCheckout, assertExplicitQaMode, assertLegacyEntryAllowed };
