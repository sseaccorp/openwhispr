const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const preflight = require("../../src/helpers/flosiQa/preflight");
const identity = require("../../src/helpers/flosiQa/identity");
const pins = require("../../scripts/flosi-qa-artifacts.json");
const { buildGguf } = require("./harness/ggufFixtures");
const { saveManifest } = require("../../scripts/flosi-qa");
const repo = path.resolve(__dirname, "../..");

function load(relative, overrides) {
  const filename = path.join(repo, relative),
    module = { exports: {} },
    realRequire = createRequire(filename);
  vm.runInNewContext(
    fs.readFileSync(filename, "utf8"),
    {
      module,
      exports: module.exports,
      console: { log() {} },
      Buffer,
      URL,
      require: (name) => (Object.hasOwn(overrides, name) ? overrides[name] : realRequire(name)),
    },
    { filename }
  );
  return module.exports;
}

function fixture(t, { lowDisk = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flosi-qwen-prep-"));
  let sentinel, sentinelHash;
  t.after(() => {
    try {
      if (sentinel) assert.equal(preflight.hashFile(sentinel), sentinelHash);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  const R = path.join(dir, "checkout"),
    paths = identity.pathsFor(path.join(dir, "mvp"));
  fs.mkdirSync(path.join(R, "src", "dist"), { recursive: true });
  fs.writeFileSync(path.join(R, "src", "dist", "index.html"), "synthetic renderer fixture");
  preflight.prepareRoot(paths, [], { platform: "linux", minFreeBytes: 0 });
  sentinel = path.join(dir, "earlier-qa-profile.txt");
  fs.writeFileSync(sentinel, "synthetic previous profile: never alter");
  sentinelHash = preflight.hashFile(sentinel);
  const bytes = buildGguf([{ key: "general.architecture", type: 8, value: "qwen35" }]);
  const fixturePins = structuredClone(pins);
  fixturePins.reasoning.size = bytes.length;
  fixturePins.reasoning.sha256 = require("node:crypto")
    .createHash("sha256")
    .update(bytes)
    .digest("hex");
  const originalMetadata = require("../../src/models/modelRegistryData.json");
  const local = load("src/helpers/flosiQa/localDictation.js", {
    "../../../scripts/flosi-qa-artifacts.json": fixturePins,
    "../../models/modelRegistryData.json": originalMetadata,
  });
  const fakeFs = Object.create(fs);
  fakeFs.statfsSync = lowDisk
    ? () => ({ bavail: 1, bsize: 4096 })
    : () => ({ bavail: 24 * 1024 ** 3, bsize: 1 });
  const prep = load("scripts/flosi-qa-qwen.js", {
    "./flosi-qa-artifacts.json": fixturePins,
    "../src/helpers/flosiQa/localDictation": local,
    "node:fs": fakeFs,
  });
  // Use the real inventory writer against this fixture checkout.
  saveManifest(paths, "1".repeat(40), R);
  let downloads = 0,
    installs = 0;
  const deps = {
    probeRuntime: () => ({ executed: false, reason: "synthetic Windows boundary" }),
    installPack: async (pack) => {
      installs++;
      const binary = path.join(R, "resources", "bin", pack.binary);
      fs.mkdirSync(path.dirname(binary), { recursive: true });
      fs.writeFileSync(binary, "nonexecutable native fixture", { flag: "wx" });
      return [{ path: path.relative(R, binary), sha256: preflight.hashFile(binary) }];
    },
    downloadPinned: async (record, destination) => {
      downloads++;
      assert.equal(record.id, pins.reasoning.id);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, bytes, { flag: "wx" });
    },
    saveManifest: (p, commit) => saveManifest(p, commit, R),
  };
  return {
    R,
    paths,
    prep,
    local,
    deps,
    bytes,
    fixturePins,
    calls: () => ({ downloads, installs }),
  };
}

test("catalog identity and immutable production Qwen pins are exact; no substitute", () => {
  const model = require("../../src/helpers/flosiQa/localDictation").assertCatalog();
  assert.equal(model.id, "qwen3.5-2b-q4_k_m");
  assert.equal(model.fileName, "Qwen_Qwen3.5-2B-Q4_K_M.gguf");
  assert.equal(model.hfRepo, "bartowski/Qwen_Qwen3.5-2B-GGUF");
  assert.equal(pins.reasoning.revision, "7d26695454df6de5fbcce2e58681e62dae06ce43");
  assert.equal(
    pins.reasoning.sha256,
    "57a1085840f497d764a7fc5d346922dbde961efb54cc792ea81d694fd846a1d8"
  );
  assert.equal(pins.reasoning.size, 1396198496);
  assert.equal(pins.llama.version, "b9763");
});

test("new MVP identity rejects an earlier QA marker without changing it", (t) => {
  const { paths } = fixture(t);
  const old = { variant: "qa", appId: "com.sseaccorp.flosi.qa", schema: 1, root: paths.root };
  fs.writeFileSync(paths.marker, JSON.stringify(old));
  const before = preflight.hashFile(paths.marker);
  assert.throws(() => preflight.prepareRoot(paths, [], { minFreeBytes: 0 }), /identity/);
  assert.equal(preflight.hashFile(paths.marker), before);
  assert.notEqual(identity.QA.credentialService, "Flosi-QA");
  assert.notEqual(identity.QA.appId, "com.sseaccorp.flosi.qa");
  assert.equal(identity.QA.trayGuid, "a5665046-0304-4b90-a4f8-e6e7eb4060ca");
  assert.notEqual(identity.QA.trayGuid, "43497de8-a9bc-4778-a1fb-0d7c8a96a1e4");
  assert.equal(
    path.basename(identity.getPaths({ FLOSI_VARIANT: "qa", LOCALAPPDATA: os.tmpdir() }).root),
    "FlosiQA-MVP-Local"
  );
});

test("incremental preparation and retry preserve existing artifacts and do not reinstall dependencies", async (t) => {
  const f = fixture(t);
  const before = fs.readFileSync(path.join(f.R, "src/dist/index.html"));
  await f.prep.addQwen(f.R, f.paths, "1".repeat(40), f.deps);
  assert.deepEqual(f.calls(), { installs: 1, downloads: 1 });
  const inventory = fs.readFileSync(path.join(f.paths.root, "artifacts.json"));
  f.local.verifyQwen(f.R, f.paths);
  await f.prep.addQwen(f.R, f.paths, "1".repeat(40), f.deps);
  assert.deepEqual(f.calls(), { installs: 1, downloads: 1 });
  assert.deepEqual(fs.readFileSync(path.join(f.paths.root, "artifacts.json")), inventory);
  assert.deepEqual(fs.readFileSync(path.join(f.R, "src/dist/index.html")), before);
});

test("insufficient disk space refuses every download", async (t) => {
  const f = fixture(t, { lowDisk: true });
  await assert.rejects(f.prep.addQwen(f.R, f.paths, "1".repeat(40), f.deps), /GiB free/);
  assert.deepEqual(f.calls(), { installs: 0, downloads: 0 });
});

test("an existing differing model is retained and never replaced", async (t) => {
  const f = fixture(t),
    file = f.local.modelFile(f.paths);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "existing synthetic different model");
  const hash = preflight.hashFile(file);
  await assert.rejects(f.prep.addQwen(f.R, f.paths, "1".repeat(40), f.deps), /integrity/);
  assert.equal(preflight.hashFile(file), hash);
  assert.deepEqual(f.calls(), { installs: 0, downloads: 0 });
});

test("failed download cannot enable cleanup or create a receipt", async (t) => {
  const f = fixture(t);
  f.deps.downloadPinned = async () => {
    throw new Error("synthetic HTTP 403");
  };
  await assert.rejects(f.prep.addQwen(f.R, f.paths, "1".repeat(40), f.deps), /HTTP 403/);
  assert.equal(fs.existsSync(path.join(f.paths.root, "local-dictation.json")), false);
  assert.equal(fs.existsSync(f.local.modelFile(f.paths)), false);
});

test("runtime receipt rejects traversal and changed native bytes", async (t) => {
  const f = fixture(t);
  await f.prep.addQwen(f.R, f.paths, "1".repeat(40), f.deps);
  const target = path.join(f.paths.root, "local-dictation.json"),
    receipt = JSON.parse(fs.readFileSync(target));
  receipt.runtime.files[0].path = "../outside.exe";
  fs.writeFileSync(target, JSON.stringify(receipt));
  assert.throws(() => f.local.verifyQwen(f.R, f.paths), /Unsafe/);
  receipt.runtime.files[0].path = path.join("resources", "bin", pins.llama.binary);
  fs.writeFileSync(target, JSON.stringify(receipt));
  fs.appendFileSync(path.join(f.R, receipt.runtime.files[0].path), "changed");
  assert.throws(() => f.local.verifyQwen(f.R, f.paths), /runtime changed/);
});

test("changed existing preparation blocks AddQwen before installation", async (t) => {
  const f = fixture(t);
  fs.appendFileSync(path.join(f.R, "src/dist/index.html"), "modified");
  await assert.rejects(f.prep.addQwen(f.R, f.paths, "1".repeat(40), f.deps), /artifact changed/);
  assert.deepEqual(f.calls(), { installs: 0, downloads: 0 });
});

test("linked private model directory is rejected before any download", async (t) => {
  const f = fixture(t),
    outside = path.join(f.R, "untouched");
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(f.paths.cache, "models"), "dir");
  await assert.rejects(f.prep.addQwen(f.R, f.paths, "1".repeat(40), f.deps), /links/);
  assert.deepEqual(fs.readdirSync(outside), []);
  assert.deepEqual(f.calls(), { installs: 0, downloads: 0 });
});

test("MVP refuses a new child root inside an earlier custom QA root", (t) => {
  const f = fixture(t);
  const parent = path.join(f.R, "custom-old-qa");
  fs.mkdirSync(parent);
  fs.writeFileSync(
    path.join(parent, "flosi-qa.json"),
    JSON.stringify({ appId: "com.sseaccorp.flosi.qa", schema: 1 })
  );
  const child = identity.pathsFor(path.join(parent, "new-mvp"));
  assert.throws(() => preflight.prepareRoot(child, [], { minFreeBytes: 0 }), /earlier QA profile/);
  assert.equal(fs.existsSync(child.root), false);
});

test("Windows runtime version probe is executable-scoped and never starts a model/server", (t) => {
  const f = fixture(t),
    prep = require("../../scripts/flosi-qa-qwen");
  let calls = 0;
  const spawn = (binary, args, options) => {
    calls++;
    assert.equal(binary, path.join(f.R, "resources", "bin", pins.llama.binary));
    assert.deepEqual(args, ["--version"]);
    assert.equal(options.cwd, f.paths.temp);
    assert.equal(options.env.TEMP, f.paths.temp);
    assert.equal(options.windowsHide, true);
    return { status: 0, stdout: "version: 9763 (dec5ca557)", stderr: "" };
  };
  assert.equal(prep.probeCpuRuntime(f.R, f.paths, { platform: "win32", spawn }).executed, true);
  assert.equal(calls, 1);
  assert.throws(
    () => prep.probeCpuRuntime(f.R, f.paths, { platform: "win32", spawn: () => ({ status: 1 }) }),
    /cannot execute/
  );
  assert.throws(
    () =>
      prep.probeCpuRuntime(f.R, f.paths, {
        platform: "win32",
        spawn: () => ({ status: 0, stdout: "version: 9999 (unknown)" }),
      }),
    /Unexpected/
  );
  assert.equal(
    prep.probeCpuRuntime(f.R, f.paths, {
      platform: "linux",
      spawn: () => {
        throw Error("must not execute");
      },
    }).executed,
    false
  );
});

test("an incompatible native runtime blocks the large model download", async (t) => {
  const f = fixture(t);
  f.deps.probeRuntime = () => {
    throw new Error("synthetic missing Windows DLL");
  };
  await assert.rejects(f.prep.addQwen(f.R, f.paths, "1".repeat(40), f.deps), /missing Windows DLL/);
  assert.deepEqual(f.calls(), { installs: 1, downloads: 0 });
  assert.equal(fs.existsSync(path.join(f.paths.root, "local-dictation.json")), false);
});
