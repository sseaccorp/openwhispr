// Product boundaries only. Inference settings and model selection belong to the
// original managers. No Electron import: also used by preparation and tests.
const path = require("node:path");
const os = require("node:os");

const QA = Object.freeze({
  variant: "qa",
  name: "Flosi QA",
  appId: "com.sseaccorp.flosi.qa",
  credentialService: "Flosi-QA",
  credentialAccount: "qa-secrets-master-key-v1",
  schema: 1,
});
const PORTS = Object.freeze({
  whisper: [18900, 18921],
  parakeet: [18930, 18953],
  llama: [18960, 18979],
  qdrant: [18990, 19007],
});

function isQa(env = process.env) {
  return env.FLOSI_VARIANT === "qa";
}

function pathsFor(root) {
  if (!root || !path.isAbsolute(root)) throw new Error("Flosi QA requires an absolute data root");
  root = path.resolve(root);
  return Object.freeze({
    root,
    userData: path.join(root, "profile"),
    sessionData: path.join(root, "chromium"),
    cache: path.join(root, "cache"),
    temp: path.join(root, "temp"),
    logs: path.join(root, "logs"),
    crashDumps: path.join(root, "crashes"),
    marker: path.join(root, "flosi-qa.json"),
  });
}

function getPaths(env = process.env) {
  if (!isQa(env)) throw new Error("Flosi QA identity is not active");
  const base = env.LOCALAPPDATA || path.join(os.homedir(), ".local", "share");
  return pathsFor(env.FLOSI_QA_ROOT || path.join(base, "FlosiQA"));
}

function contains(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  );
}

function protectedRoots({ home, appData, localAppData, programData, systemDrive }) {
  return [
    ...[process.env.OneDrive, process.env.OneDriveCommercial, process.env.OneDriveConsumer].filter(
      Boolean
    ),
    ...[
      "OpenWhispr",
      "openwhispr",
      "open-whispr",
      "OpenWhispr-development",
      "OpenWhispr-staging",
    ].map((name) => path.join(appData, name)),
    path.join(home, ".cache", "openwhispr"),
    path.join(home, ".openwhispr"),
    path.join(localAppData, "OpenWhispr"),
    path.join(localAppData, "openwhispr-updater"),
    path.join(localAppData, "open-whispr-updater"),
    path.join(localAppData, "Programs", "OpenWhispr"),
    path.join(localAppData, "Programs", "open-whispr"),
    path.join(process.env.ProgramFiles || "C:\\Program Files", "OpenWhispr"),
    path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "OpenWhispr"),
    path.join(programData, "OpenWhispr"),
    path.join(systemDrive, "OpenWhispr"),
  ];
}

function assertRoot(root, protectedPaths, platform = process.platform) {
  if (
    root === path.parse(root).root ||
    protectedPaths.some((p) => contains(p, root) || contains(root, p))
  ) {
    throw new Error("Flosi QA root overlaps a protected location");
  }
  if (platform === "win32" && (!/^[\x21-\x7e]+$/.test(root) || root.startsWith("\\\\"))) {
    throw new Error(
      "Flosi QA needs a local ASCII data path without spaces; no shared fallback is permitted"
    );
  }
}

module.exports = { QA, PORTS, isQa, pathsFor, getPaths, contains, protectedRoots, assertRoot };
