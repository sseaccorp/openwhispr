const path = require("node:path");
try {
  require("../src/helpers/flosiQa/checkoutGuard").assertLegacyEntryAllowed(
    path.resolve(__dirname, "..")
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
