// Runtime validation and preparation share the same immutable model identity.
const fs = require("node:fs");
const path = require("node:path");
const { QA, contains } = require("./identity");
const { assertNoLinks, hashFile } = require("./preflight");
const pins = require("../../../scripts/flosi-qa-artifacts.json");

function assertCatalog() {
  const models = require("../../models/modelRegistryData.json").localProviders.flatMap(
    (p) => p.models
  );
  const model = models.find((m) => m.id === pins.reasoning.id);
  if (
    !model ||
    model.fileName !== pins.reasoning.fileName ||
    model.hfRepo !== pins.reasoning.hfRepo
  )
    throw new Error("The pinned Qwen artifact does not match the original catalog");
  if (
    !/^[a-f0-9]{40}$/.test(pins.reasoning.revision) ||
    !pins.reasoning.url.includes(`/resolve/${pins.reasoning.revision}/`)
  )
    throw new Error("Qwen preparation requires an immutable revision");
  return model;
}

function modelFile(paths) {
  return path.join(paths.cache, "models", pins.reasoning.fileName);
}

function verifyModel(paths) {
  const target = modelFile(paths);
  assertNoLinks(target);
  if (
    !contains(paths.root, target) ||
    fs.statSync(target).size !== pins.reasoning.size ||
    hashFile(target) !== pins.reasoning.sha256
  )
    throw new Error("Qwen model integrity failed; the existing file was preserved");
  return target;
}

function verifyQwen(repo, paths) {
  assertCatalog();
  if (fs.existsSync(path.join(paths.userData, "bin", "llama-vulkan")))
    throw new Error("This MVP requires the prepared CPU-only llama.cpp runtime");
  const receipt = JSON.parse(
    fs.readFileSync(path.join(paths.root, "local-dictation.json"), "utf8")
  );
  if (
    receipt.schema !== 1 ||
    receipt.purpose !== QA.purpose ||
    receipt.model.id !== pins.reasoning.id ||
    receipt.model.fileName !== pins.reasoning.fileName ||
    receipt.model.hfRepo !== pins.reasoning.hfRepo ||
    receipt.model.size !== pins.reasoning.size ||
    receipt.model.sha256 !== pins.reasoning.sha256 ||
    receipt.model.revision !== pins.reasoning.revision ||
    receipt.runtime.version !== pins.llama.version ||
    receipt.runtime.sourceRevision !== pins.llama.sourceRevision ||
    receipt.runtime.archiveSha256 !== pins.llama.sha256 ||
    !Array.isArray(receipt.runtime.files) ||
    !receipt.runtime.files.length
  )
    throw new Error("Qwen preparation receipt differs from the reviewed pins");
  verifyModel(paths);
  let executable = false;
  for (const file of receipt.runtime.files) {
    const target = path.resolve(repo, file.path);
    if (!contains(path.join(repo, "resources", "bin"), target))
      throw new Error("Unsafe Qwen runtime receipt");
    assertNoLinks(target);
    if (hashFile(target) !== file.sha256) throw new Error("Prepared llama.cpp runtime changed");
    if (path.basename(target) === pins.llama.binary) executable = true;
  }
  if (!executable) throw new Error("The pinned CPU llama-server is absent");
  return receipt;
}

module.exports = { assertCatalog, modelFile, verifyModel, verifyQwen };
