// Optional, incremental provisioning. No production downloader or inference
// code is invoked; all source artifacts and installed files are authenticated.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const pins = require("./flosi-qa-orukeet-artifacts.json");
const { downloadPinned, extractPinnedTarBz2, hashFile } = require("./flosi-qa-download");
const { scanTree } = require("../src/helpers/flosiQa/preflight");
const { renameImportedModule } = require("./lib/pe-imports");

function verifyFile(file, size, sha256) {
  if (fs.statSync(file).size !== size || hashFile(file) !== sha256)
    throw new Error(`Orukeet integrity check failed: ${path.basename(file)}`);
}

function copyNewBuffer(bytes, target) {
  if (fs.existsSync(target)) {
    if (!fs.readFileSync(target).equals(bytes))
      throw new Error(`Existing Orukeet artifact differs; preserved: ${target}`);
    return;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes, { flag: "wx" });
}

function diskBudget(artifacts = pins) {
  // Retained archives + staging + installed files + renderer scratch + reserve.
  const extracted = artifacts.modelFiles.reduce((sum, file) => sum + file.bytes, 0);
  return (
    artifacts.model.size +
    artifacts.runtime.size +
    2 * extracted +
    2 * 40 * 1024 ** 2 +
    512 * 1024 ** 2 +
    4 * 1024 ** 3
  );
}

async function prepareOrukeet(
  repo,
  paths,
  { download = downloadPinned, signal, artifacts = pins } = {}
) {
  scanTree(paths.root);
  scanTree(path.join(repo, "resources", "bin"));
  for (const root of [paths.root, repo]) {
    const stat = fs.statfsSync(root);
    if (stat.bavail * stat.bsize < diskBudget(artifacts))
      throw new Error(
        `Optional Orukeet requires ${(diskBudget(artifacts) / 1024 ** 3).toFixed(2)} GiB free on BOTH volumes`
      );
  }
  const staging = fs.mkdtempSync(path.join(paths.temp, "orukeet-"));
  try {
    const archives = {};
    for (const [key, record] of Object.entries({
      model: artifacts.model,
      runtime: artifacts.runtime,
      modelManifest: artifacts.modelManifest,
    })) {
      signal?.throwIfAborted();
      const target = path.join(
        paths.cache,
        "downloads",
        `${record.sha256}-${key}${key === "modelManifest" ? ".json" : ".tar.bz2"}`
      );
      await download(record, target, { signal });
      verifyFile(target, record.size, record.sha256);
      archives[key] = target;
    }
    await extractPinnedTarBz2(archives.model, path.join(staging, "model"));
    const runtimeNames = new Set(artifacts.runtimeFiles.map((file) => file.archivePath));
    await extractPinnedTarBz2(archives.runtime, path.join(staging, "runtime"), {
      select: (name) => runtimeNames.has(name),
      maxBytes: 40 * 1024 ** 2,
    });
    signal?.throwIfAborted();
    const installed = [];
    const modelDirectory = path.join(paths.cache, "parakeet-models", artifacts.modelId);
    // Check every source before installing anything. Never replace an existing
    // model directory, unlike the general upstream download/migration path.
    for (const file of artifacts.modelFiles)
      verifyFile(
        path.join(staging, "model", artifacts.extractDir, file.path),
        file.bytes,
        file.sha256
      );
    const native = artifacts.runtimeFiles.map((file) => {
      const source = path.join(staging, "runtime", file.archivePath);
      verifyFile(source, file.size, file.sourceSha256);
      const bytes = fs.readFileSync(source);
      if (
        file.file.endsWith(".exe") &&
        renameImportedModule(bytes, "onnxruntime.dll", "ow-onnxrt.dll") !== 1
      )
        throw new Error("Unexpected sherpa ONNX import table; no engine replacement permitted");
      if (crypto.createHash("sha256").update(bytes).digest("hex") !== file.installedSha256)
        throw new Error("Unexpected installed sherpa hash after the original PE import transform");
      return { file, bytes };
    });
    for (const file of artifacts.modelFiles) {
      const target = path.join(modelDirectory, file.path);
      if (fs.existsSync(target)) verifyFile(target, file.bytes, file.sha256);
      else {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(
          path.join(staging, "model", artifacts.extractDir, file.path),
          target,
          fs.constants.COPYFILE_EXCL
        );
      }
      installed.push({
        area: "data",
        path: path.relative(paths.root, target),
        sha256: file.sha256,
      });
    }
    copyNewBuffer(
      fs.readFileSync(archives.modelManifest),
      path.join(modelDirectory, "download-manifest.json")
    );
    for (const { file, bytes } of native) {
      const target = path.join(repo, "resources", "bin", file.file);
      copyNewBuffer(bytes, target);
      installed.push({
        area: "repo",
        path: path.relative(repo, target),
        sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
      });
    }
    const receipt = {
      schema: 1,
      modelId: artifacts.modelId,
      revision: artifacts.revision,
      runtimeVersion: artifacts.runtimeVersion,
      files: installed,
      sources: artifacts,
    };
    copyNewBuffer(
      Buffer.from(JSON.stringify(receipt, null, 2) + "\n"),
      path.join(paths.root, "orukeet.json")
    );
    return receipt;
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

module.exports = { prepareOrukeet, diskBudget, copyNewBuffer, verifyFile };
