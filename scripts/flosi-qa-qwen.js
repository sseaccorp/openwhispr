// Preparation boundary only. Inference is owned by the original model manager.
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { QA, contains } = require("../src/helpers/flosiQa/identity");
const { scanTree, verifyArtifacts, hashFile } = require("../src/helpers/flosiQa/preflight");
const { readGgufMetadataFromFile } = require("../src/helpers/ggufMetadata");
const pins = require("./flosi-qa-artifacts.json");
const {
  assertCatalog,
  modelFile,
  verifyModel,
  verifyQwen,
} = require("../src/helpers/flosiQa/localDictation");
const GiB = 1024 ** 3;

function qwenPlan(repo, paths) {
  assertCatalog();
  scanTree(path.join(repo, "resources", "bin"));
  scanTree(paths.root);
  if (fs.existsSync(modelFile(paths))) verifyModel(paths); // never replace a differing model
  const archive = path.join(
    paths.cache,
    "downloads",
    path.basename(new URL(pins.llama.url).pathname)
  );
  if (
    fs.existsSync(archive) &&
    (fs.statSync(archive).size !== pins.llama.size || hashFile(archive) !== pins.llama.sha256)
  )
    throw new Error("Existing llama.cpp archive differs; no overwrite");
  const downloadBytes =
    (fs.existsSync(modelFile(paths)) ? 0 : pins.reasoning.size) +
    (fs.existsSync(archive) ? 0 : pins.llama.size);
  const requiredFreeBytes = downloadBytes + 256 * 1024 ** 2 + 4 * GiB;
  for (const directory of [repo, paths.root]) {
    const disk = fs.statfsSync(directory);
    if (disk.bavail * disk.bsize < requiredFreeBytes)
      throw new Error(
        `AddQwen needs ${Math.ceil(requiredFreeBytes / GiB)} GiB free on each volume; no download started`
      );
  }
  return {
    model: pins.reasoning.id,
    modelBytes: pins.reasoning.size,
    downloadBytes,
    requiredFreeBytes,
    backend: "cpu",
    runtime: pins.llama.version,
  };
}

function probeCpuRuntime(repo, paths, { platform = process.platform, spawn = spawnSync } = {}) {
  if (platform !== "win32")
    return { executed: false, reason: "Windows runtime requires native Windows validation" };
  const binary = path.join(repo, "resources", "bin", pins.llama.binary);
  const result = spawn(binary, ["--version"], {
    cwd: paths.temp,
    encoding: "utf8",
    timeout: 15000,
    windowsHide: true,
    env: {
      ...process.env,
      TEMP: paths.temp,
      TMP: paths.temp,
      XDG_CACHE_HOME: path.join(paths.cache, "xdg"),
    },
  });
  if (result.error || result.status !== 0)
    throw new Error(
      "Pinned llama.cpp CPU runtime cannot execute; inspect Windows DLL/CPU prerequisites before downloading Qwen"
    );
  const version = `${result.stdout || ""}\n${result.stderr || ""}`.trim();
  if (!/version:\s*9763\s*\(dec5ca557[0-9a-f]*\)/i.test(version))
    throw new Error("Unexpected llama.cpp CPU version; no model download started");
  return { executed: true, version };
}

async function addQwen(
  repo,
  paths,
  sourceCommit,
  { installPack, downloadPinned, saveManifest, probeRuntime = probeCpuRuntime }
) {
  // Incremental means verify the existing preparation first, never rerun npm or
  // rebuild the renderer here. Source changes require a reviewed Prepare first.
  verifyArtifacts(repo, paths);
  const plan = qwenPlan(repo, paths);
  console.log(JSON.stringify({ qwenPlan: plan }));
  if (fs.existsSync(path.join(paths.root, "local-dictation.json"))) {
    verifyQwen(repo, paths);
    return plan;
  }
  // Prevent the original manager's opportunistic GPU/MTP selection in this CPU
  // experiment by requiring a CPU-only preparation, not by changing inference.
  if (fs.existsSync(path.join(paths.userData, "bin", "llama-vulkan")))
    throw new Error(
      "This MVP uses a fresh CPU-only profile; preserve the Vulkan profile separately"
    );
  const runtimeFiles = await installPack(pins.llama, paths);
  const runtimeProbe = probeRuntime(repo, paths);
  await downloadPinned(pins.reasoning, modelFile(paths));
  verifyModel(paths);
  const metadata = await readGgufMetadataFromFile(modelFile(paths));
  if (metadata?.architecture !== "qwen35")
    throw new Error("Expected the original Qwen3.5 GGUF architecture");
  const binDir = path.join(repo, "resources", "bin");
  // installPack returns the exact archive members it copied, with hashes.
  if (!runtimeFiles?.some((file) => path.basename(file.path) === pins.llama.binary))
    throw new Error("llama.cpp installation did not return a verifiable inventory");
  for (const file of runtimeFiles) {
    const target = path.resolve(repo, file.path);
    if (!contains(binDir, target) || hashFile(target) !== file.sha256)
      throw new Error("Runtime inventory changed");
  }
  const receipt = {
    schema: 1,
    purpose: QA.purpose,
    model: pins.reasoning,
    runtime: {
      version: pins.llama.version,
      sourceRevision: pins.llama.sourceRevision,
      archiveSha256: pins.llama.sha256,
      probe: runtimeProbe,
      files: runtimeFiles,
    },
    preparedAt: new Date().toISOString(),
  };
  // Commit the artifact inventory before enabling first-run cleanup. Interrupted
  // work leaves hash-verified files for retry; no partial result enables Qwen.
  saveManifest(paths, sourceCommit);
  fs.writeFileSync(
    path.join(paths.root, "local-dictation.json"),
    JSON.stringify(receipt, null, 2),
    { flag: "wx", mode: 0o600 }
  );
  verifyQwen(repo, paths);
  return plan;
}

module.exports = {
  assertCatalog,
  modelFile,
  verifyModel,
  verifyQwen,
  qwenPlan,
  addQwen,
  probeCpuRuntime,
};
