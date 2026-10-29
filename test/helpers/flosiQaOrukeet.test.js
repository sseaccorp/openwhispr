const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const { createHash } = require("node:crypto");
const { pathsFor } = require("../../src/helpers/flosiQa/identity");
const { prepareRoot } = require("../../src/helpers/flosiQa/preflight");
const { prepareOrukeet, diskBudget } = require("../../scripts/flosi-qa-orukeet");
const { extractPinnedTarBz2, downloadPinned } = require("../../scripts/flosi-qa-download");
const {
  verifyOrukeet,
  assertRuntime,
  assertProtection,
  checkNativeDependencies,
} = require("../../src/helpers/flosiQa/orukeet");
const fixtures = require("../fixtures/flosiQaOrukeetArchives.json");
const pins = require("../../scripts/flosi-qa-orukeet-artifacts.json");

const digest = (b) => createHash("sha256").update(b).digest("hex");

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "flosi-orukeet-"));
  const repo = path.join(directory, "checkout");
  fs.mkdirSync(repo);
  const paths = pathsFor(path.join(directory, "FlosiQA"));
  const official = path.join(directory, "OpenWhispr");
  fs.mkdirSync(official);
  const sentinel = path.join(official, "history.db");
  fs.writeFileSync(sentinel, "synthetic official reference");
  prepareRoot(paths, [official, repo]);
  t.after(() => {
    assert.equal(fs.readFileSync(sentinel, "utf8"), "synthetic official reference");
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const model = Buffer.from("synthetic tokens fixture\n");
  const runtime = Buffer.from("synthetic native-package fixture; not executable\n");
  const record = (key) => ({
    url: `https://huggingface.co/fixture/${key}`,
    size: Buffer.from(fixtures[key], "base64").length,
    sha256: digest(Buffer.from(fixtures[key], "base64")),
  });
  const artifacts = {
    ...pins,
    model: record("model"),
    runtime: record("runtime"),
    extractDir: "model",
    modelFiles: [{ path: "tokens.txt", bytes: model.length, sha256: digest(model) }],
    runtimeFiles: [
      {
        archivePath: "runtime/fixture.dll",
        file: "fixture.dll",
        size: runtime.length,
        sourceSha256: digest(runtime),
        installedSha256: digest(runtime),
      },
    ],
    modelManifest: {
      url: "https://huggingface.co/fixture/manifest",
      size: 3,
      sha256: digest(Buffer.from("{}\n")),
    },
  };
  const download = async (record, target, { signal } = {}) => {
    signal?.throwIfAborted();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const key = record.url.split("/").pop();
    fs.writeFileSync(
      target,
      key === "manifest" ? Buffer.from("{}\n") : Buffer.from(fixtures[key], "base64")
    );
  };
  return { repo, paths, directory, artifacts, download };
}

for (const name of [
  "traversal",
  "absolute",
  "drive",
  "backslash",
  "symlink",
  "hardlink",
  "device",
  "duplicate",
])
  test(`Orukeet preparation rejects TAR ${name} without touching the official fixture`, async (t) => {
    const { paths } = fixture(t);
    const archive = path.join(paths.temp, "fixture.tar.bz2");
    fs.writeFileSync(archive, Buffer.from(fixtures[name], "base64"));
    await assert.rejects(
      extractPinnedTarBz2(archive, path.join(paths.temp, "out")),
      /Unsafe|Duplicate/
    );
  });

test("TAR extraction enforces size budget and preserves existing staging", async (t) => {
  const { paths } = fixture(t);
  const archive = path.join(paths.temp, "model.tar.bz2");
  fs.writeFileSync(archive, Buffer.from(fixtures.model, "base64"));
  const target = path.join(paths.temp, "out");
  await assert.rejects(extractPinnedTarBz2(archive, target, { maxBytes: 1 }), /budget/);
  await assert.rejects(extractPinnedTarBz2(archive, target), /preserved/);
});

test("optional preparation installs only private files, retains model attribution and is idempotent", async (t) => {
  const f = fixture(t);
  const history = path.join(f.paths.userData, "history.db");
  fs.writeFileSync(history, "existing QA data");
  const a = await prepareOrukeet(f.repo, f.paths, f);
  const b = await prepareOrukeet(f.repo, f.paths, f);
  assert.deepEqual(a, b);
  assert.equal(fs.readFileSync(history, "utf8"), "existing QA data");
  const calls = [];
  const validated = verifyOrukeet(f.repo, f.paths, {
    artifacts: f.artifacts,
    protect: (...args) => calls.push(args),
  });
  assert.equal(validated.modelDir, path.join(f.paths.cache, "parakeet-models", pins.modelId));
  assert.equal(calls.length, 1);
  assert.deepEqual(fs.readdirSync(f.paths.temp), []);
  assert.ok(pins.modelFiles.some((file) => file.path === "LICENSE-WEIGHTS"));
  assert.ok(pins.modelFiles.some((file) => file.path === "NOTICE.md"));
});

test("existing differing Orukeet files are preserved and not blessed by a receipt", async (t) => {
  const f = fixture(t);
  const directory = path.join(f.paths.cache, "parakeet-models", pins.modelId);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "tokens.txt"), "preserve this file");
  await assert.rejects(prepareOrukeet(f.repo, f.paths, f), /integrity/);
  assert.equal(fs.readFileSync(path.join(directory, "tokens.txt"), "utf8"), "preserve this file");
  assert.equal(fs.existsSync(path.join(f.paths.root, "orukeet.json")), false);
});

test("incorrect source hashes stop preparation before installation", async (t) => {
  const f = fixture(t);
  f.artifacts.model.sha256 = "0".repeat(64);
  await assert.rejects(prepareOrukeet(f.repo, f.paths, f), /integrity/);
  assert.equal(fs.existsSync(path.join(f.paths.cache, "parakeet-models")), false);
});

test("preparation cancellation leaves QA data intact and removes its own staging", async (t) => {
  const f = fixture(t);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(prepareOrukeet(f.repo, f.paths, { ...f, signal: controller.signal }), {
    name: "AbortError",
  });
  assert.deepEqual(fs.readdirSync(f.paths.temp), []);
  assert.equal(fs.existsSync(path.join(f.paths.root, "orukeet.json")), false);
});

test("download cancellation before a request makes no network call or file", async (t) => {
  const { paths } = fixture(t);
  const controller = new AbortController();
  controller.abort();
  const file = path.join(paths.temp, "download");
  await assert.rejects(downloadPinned(pins.model, file, { signal: controller.signal }), {
    name: "AbortError",
  });
  assert.equal(fs.existsSync(file), false);
});

test("preparation refuses links to shared model directories", async (t) => {
  const f = fixture(t);
  fs.symlinkSync(
    f.directory,
    path.join(f.paths.cache, "shared"),
    process.platform === "win32" ? "junction" : "dir"
  );
  await assert.rejects(prepareOrukeet(f.repo, f.paths, f), /links/);
});

test("runtime refuses a missing receipt, altered model, altered binary and missing network protection", async (t) => {
  const f = fixture(t);
  assert.throws(() => verifyOrukeet(f.repo, f.paths), /AddOrukeet/);
  await prepareOrukeet(f.repo, f.paths, f);
  assert.throws(
    () =>
      verifyOrukeet(f.repo, f.paths, {
        artifacts: f.artifacts,
        protect: () => {
          throw Error("protection unavailable");
        },
      }),
    /protection unavailable/
  );
  const token = path.join(f.paths.cache, "parakeet-models", pins.modelId, "tokens.txt");
  fs.appendFileSync(token, "tamper");
  assert.throws(
    () => verifyOrukeet(f.repo, f.paths, { artifacts: f.artifacts, protect() {} }),
    /integrity/
  );
});

test("runtime never trusts a receipt hash to authorize a different native executable", async (t) => {
  const f = fixture(t);
  await prepareOrukeet(f.repo, f.paths, f);
  const target = path.join(f.repo, "resources", "bin", "fixture.dll");
  fs.appendFileSync(target, "tamper");
  const file = path.join(f.paths.root, "orukeet.json");
  const receipt = JSON.parse(fs.readFileSync(file));
  receipt.files.find((entry) => entry.area === "repo").sha256 = digest(fs.readFileSync(target));
  fs.writeFileSync(file, JSON.stringify(receipt));
  assert.throws(
    () => verifyOrukeet(f.repo, f.paths, { artifacts: f.artifacts, protect() {} }),
    /identity/
  );
});

test("QA rejects unprepared online and unrelated models before spawning", (t) => {
  const f = fixture(t);
  for (const [modelName, runtime] of [
    [pins.modelId, "online"],
    ["parakeet-tdt-0.6b-v3", "offline"],
  ])
    assert.throws(() => assertRuntime({ modelName, runtime }, f), /only.*offline/);
});

test(
  "a non-Windows host cannot claim that native Windows protection was verified",
  { skip: process.platform === "win32" },
  () => {
    assert.throws(() => assertProtection("unused", "unused"), /requires Windows/);
  }
);

test("optional disk budget fits 24 GiB and includes installed and staging copies plus reserve", () => {
  assert.ok(diskBudget() > 6 * 1024 ** 3);
  assert.ok(diskBudget() < 24 * 1024 ** 3);
});

test("native dependency probe rejects loader failures and accepts only the offline CLI contract", (t) => {
  const { paths } = fixture(t);
  const help = "--num-work-threads --encoder --port";
  for (const result of [
    { status: -1073741515, stdout: help },
    { status: 0, stdout: "wrong executable" },
    { status: null, error: new Error("timeout") },
  ])
    assert.throws(
      () => checkNativeDependencies("fixture.exe", paths, {}, { execute: () => result }),
      /dependency probe failed/
    );
  checkNativeDependencies(
    "fixture.exe",
    paths,
    {},
    {
      log: path.join(paths.logs, "native-probe.log"),
      execute: (_binary, args, options) => {
        assert.deepEqual(args, ["--help"]);
        assert.equal(options.cwd, paths.temp);
        return { status: 1, stderr: help };
      },
    }
  );
  assert.match(
    fs.readFileSync(path.join(paths.logs, "native-probe.log"), "utf8"),
    /Orukeet --help: exit 1/
  );
});

test("QA refuses native spawn before port allocation or PID writes when protection is unavailable", async (t) => {
  const f = fixture(t);
  const filename = require.resolve("../../src/helpers/parakeetWsServer");
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  const unexpected = () => {
    throw new Error("unsafe native side effect reached");
  };
  vm.runInNewContext(
    fs.readFileSync(filename, "utf8"),
    {
      module,
      Buffer,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      process: { env: { FLOSI_VARIANT: "qa" }, platform: "win32", arch: "x64" },
      require: (name) => {
        if (name === "child_process") return { spawn: unexpected };
        if (name === "../utils/serverUtils")
          return { getAvailableParallelism: () => 8, findAvailablePort: unexpected };
        if (name === "./flosiQa/orukeet")
          return {
            assertRuntime: () => {
              throw Error("QA network protection unavailable");
            },
          };
        if (name === "./debugLogger") return { debug() {} };
        if (name === "./sidecarPidFile") return { write: unexpected };
        return localRequire(name);
      },
    },
    { filename }
  );
  const server = new module.exports();
  server.getWsBinaryPath = () =>
    path.join(f.repo, "resources", "bin", "sherpa-onnx-ws-win32-x64.exe");
  await assert.rejects(
    server.start(pins.modelId, f.paths.cache),
    /QA network protection unavailable/
  );
  assert.equal(server.process, null);
  assert.equal(server.port, null);
  assert.equal(server.startupPromise, null);
});
