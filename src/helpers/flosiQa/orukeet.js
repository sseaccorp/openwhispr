const fs = require("node:fs");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const { getPaths } = require("./identity");
const { hashFile, scanTree } = require("./preflight");
const pins = require("../../../scripts/flosi-qa-orukeet-artifacts.json");

function assertProtection(repo, binary) {
  if (process.platform !== "win32")
    throw new Error("QA Orukeet network protection requires Windows");
  const ps = path.win32.join(
    process.env.SystemRoot || "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe"
  );
  try {
    execFileSync(
      ps,
      [
        "-NoProfile",
        "-NonInteractive",
        "-File",
        path.join(repo, "scripts", "flosi-qa-orukeet-firewall.ps1"),
        "-Mode",
        "Check",
        "-Binary",
        binary,
      ],
      {
        encoding: "utf8",
        windowsHide: true,
        timeout: 20000,
      }
    );
  } catch (error) {
    throw new Error(
      "Orukeet QA blocked: its native server listens on 0.0.0.0. Verify the dedicated inbound/outbound firewall rules with scripts/flosi-qa-orukeet-firewall.ps1; never allow the binary through the firewall prompt.\n" +
        String(error.stderr || error.message)
          .trim()
          .slice(-1500)
    );
  }
}

function checkNativeDependencies(binary, paths, env, { execute = spawnSync, log } = {}) {
  // --help exits before model/server construction. A missing MSVC runtime or
  // wrong ONNX DLL must fail here, before starting an unprotected listener.
  const result = execute(binary, ["--help"], {
    cwd: paths.temp,
    env,
    encoding: "utf8",
    windowsHide: true,
    timeout: 15000,
    maxBuffer: 1024 ** 2,
  });
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  if (log)
    fs.appendFileSync(
      log,
      `\nOrukeet --help: exit ${result.status}; ${result.error?.message || ""}\n${output}\n`
    );
  if (
    result.error ||
    ![0, 1].includes(result.status) ||
    !output.includes("--num-work-threads") ||
    !output.includes("--encoder") ||
    !output.includes("--port")
  )
    throw new Error(
      "Orukeet native dependency probe failed. Check the QA log and Microsoft Visual C++ 2015–2022 x64 runtime from Microsoft; never copy DLLs from the official app or System32."
    );
}

function verifyOrukeet(repo, paths, { protect = assertProtection, artifacts = pins } = {}) {
  const receiptPath = path.join(paths.root, "orukeet.json");
  if (!fs.existsSync(receiptPath)) throw new Error("Run AddOrukeet first; no QA Orukeet receipt");
  scanTree(path.join(paths.cache, "parakeet-models"));
  const receipt = JSON.parse(fs.readFileSync(receiptPath));
  if (
    receipt.schema !== 1 ||
    receipt.modelId !== artifacts.modelId ||
    receipt.revision !== artifacts.revision ||
    receipt.runtimeVersion !== artifacts.runtimeVersion
  )
    throw new Error("QA Orukeet provenance mismatch");
  const expected = [
    ...artifacts.modelFiles.map((file) => ({
      area: "data",
      path: path.join("cache", "parakeet-models", artifacts.modelId, file.path),
      sha256: file.sha256,
    })),
    ...artifacts.runtimeFiles.map((file) => ({
      area: "repo",
      path: path.join("resources", "bin", file.file),
      sha256: file.installedSha256,
    })),
  ];
  if (!Array.isArray(receipt.files) || receipt.files.length !== expected.length)
    throw new Error("Incomplete QA Orukeet receipt");
  for (const entry of expected) {
    const file = receipt.files.find(
      (f) => f.area === entry.area && path.normalize(f.path) === entry.path
    );
    if (
      !file ||
      (entry.sha256 && entry.sha256 !== file.sha256) ||
      !/^[a-f0-9]{64}$/.test(file.sha256)
    )
      throw new Error("QA Orukeet file identity mismatch");
    if (hashFile(path.join(entry.area === "data" ? paths.root : repo, entry.path)) !== file.sha256)
      throw new Error("QA Orukeet file integrity mismatch");
  }
  const binary = path.join(repo, "resources", "bin", "sherpa-onnx-ws-win32-x64.exe");
  protect(repo, binary);
  return { binary, modelDir: path.join(paths.cache, "parakeet-models", artifacts.modelId) };
}

function assertRuntime(
  { modelName, modelDir, runtime, binary },
  { repo = path.resolve(__dirname, "../../.."), paths = getPaths(), protect } = {}
) {
  if (modelName !== pins.modelId || runtime !== "offline")
    throw new Error(
      "QA enables only the prepared offline Orukeet model; other Parakeet servers are blocked"
    );
  const expected = verifyOrukeet(repo, paths, { protect });
  if (path.resolve(modelDir) !== expected.modelDir || path.resolve(binary) !== expected.binary)
    throw new Error("QA Orukeet cannot use another model or native binary path");
}

module.exports = { verifyOrukeet, assertProtection, assertRuntime, checkNativeDependencies };
