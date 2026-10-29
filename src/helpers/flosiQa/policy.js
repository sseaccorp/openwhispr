const { PORTS } = require("./identity");

function localEndpoint(host, port) {
  return (
    ["127.0.0.1", "::1", "[::1]"].includes(host) &&
    Object.values(PORTS).some(([start, end]) => Number(port) >= start && Number(port) <= end + 1)
  );
}

function allowedUrl(value) {
  try {
    const url = new URL(value);
    return (
      ["http:", "ws:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      localEndpoint(url.hostname, url.port)
    );
  } catch {
    return false;
  }
}

const BLOCKED_CHANNELS =
  /^(?:get-tinfoil-chat-models$|proxy-tinfoil-|cloud-|auth-set-token$|connector-|connectors-|gcal-|mcal-|acal-connect$|agent-web-search$|open-external$|test-(?:provider|enterprise)-connection$|enterprise-stream-|bedrock-list-models$|.*(?:checkout|billing|referral)|cleanup-app$|relaunch-app$|download-|model-download$|.*-download$|llama-cpp-(?:install|uninstall)$|install-update$|check-for-updates$|set-auto-start-enabled$|set-auto-updates-enabled$|granola-import-|note-files-(?:set-path|pick-folder)$)/;

const SECRET_CHANNELS = new Set([
  ...require("../../config/secretKeys").BYOK_API_KEYS.map((key) => `save-${key.base}-key`),
  "save-corti-client-id",
  "save-corti-client-secret",
  "save-custom-transcription-key",
  "save-cleanup-custom-key",
  "save-bedrock-access-key-id",
  "save-bedrock-secret-access-key",
  "save-bedrock-session-token",
  "save-azure-api-key",
  "save-vertex-api-key",
]);

function installIpcPolicy(ipcMain) {
  const original = ipcMain.handle;
  ipcMain.handle = function (channel, listener) {
    return original.call(this, channel, (event, ...args) => {
      if (BLOCKED_CHANNELS.test(channel) || SECRET_CHANNELS.has(channel))
        throw new Error(
          `FLOSI_QA_UNAVAILABLE: ${channel}; QA is local only, with no credentials, downloads, account migration or updates`
        );
      return listener(event, ...args);
    });
  };
  return () => {
    ipcMain.handle = original;
  };
}

function installNodeNetworkPolicy() {
  const net = require("node:net");
  const original = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    const parsed = Array.isArray(args[0]) ? args[0] : args;
    const options =
      typeof parsed[0] === "object"
        ? parsed[0]
        : { port: parsed[0], host: typeof parsed[1] === "string" ? parsed[1] : "localhost" };
    if (
      options.path ||
      !localEndpoint(options.host || options.hostname || "localhost", options.port)
    ) {
      throw new Error("FLOSI_QA_NETWORK_BLOCKED: only private QA loopback inference is available");
    }
    return original.apply(this, args);
  };
  return () => {
    net.Socket.prototype.connect = original;
  };
}

function installSessionPolicy(targetSession, fileRoots = []) {
  targetSession.webRequest.onBeforeRequest((details, callback) => {
    let localResource = /^(?:data|blob|devtools):/.test(details.url);
    if (details.url.startsWith("file:")) {
      try {
        const file = require("node:url").fileURLToPath(details.url);
        localResource = fileRoots.some((root) => require("./identity").contains(root, file));
      } catch {
        localResource = false;
      }
    }
    callback({ cancel: !localResource && !allowedUrl(details.url) });
  });
}

module.exports = {
  localEndpoint,
  allowedUrl,
  BLOCKED_CHANNELS,
  installIpcPolicy,
  installNodeNetworkPolicy,
  installSessionPolicy,
};
