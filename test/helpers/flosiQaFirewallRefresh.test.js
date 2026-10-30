const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathsFor } = require("../../src/helpers/flosiQa/identity");
const { prepareRoot, hashFile, BASELINE } = require("../../src/helpers/flosiQa/preflight");
const {
  PARENT,
  assertFirewallOnlyChanges,
  refreshFirewallArtifacts,
} = require("../../scripts/flosi-qa-firewall-refresh");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "flosi-firewall-refresh-"));
  const paths = pathsFor(path.join(root, "QA"));
  const repo = path.join(root, "repo");
  const official = path.join(root, "official");
  fs.mkdirSync(repo);
  fs.mkdirSync(official);
  fs.writeFileSync(path.join(official, "history.db"), "synthetic official sentinel");
  prepareRoot(paths, [repo, official]);
  const artifact = path.join(paths.cache, "unchanged-model");
  fs.writeFileSync(artifact, "synthetic model sentinel");
  const previous = {
    schema: 1,
    baseline: BASELINE,
    sourceCommit: PARENT,
    files: [
      { area: "data", path: path.relative(paths.root, artifact), sha256: hashFile(artifact) },
    ],
    sources: { preserved: true },
  };
  const target = path.join(paths.root, "artifacts.json");
  fs.writeFileSync(target, JSON.stringify(previous));
  let current = "a".repeat(40);
  let changes = "scripts/flosi-qa-orukeet-firewall.ps1\nscripts/lib/flosi-qa-firewall.ps1";
  let protection = 0;
  const opts = {
    git: (...args) => (args[0] === "rev-parse" ? current : args[0] === "diff" ? changes : ""),
    protect: () => {
      protection++;
    },
  };
  t.after(() => {
    assert.equal(
      fs.readFileSync(path.join(official, "history.db"), "utf8"),
      "synthetic official sentinel"
    );
    assert.equal(fs.readFileSync(artifact, "utf8"), "synthetic model sentinel");
    fs.rmSync(root, { recursive: true, force: true });
  });
  return {
    paths,
    repo,
    artifact,
    previous,
    target,
    opts,
    setCurrent: (value) => {
      current = value;
    },
    setChanges: (value) => {
      changes = value;
    },
    count: () => protection,
  };
}

test("firewall refresh preserves all artifact hashes and backs up only validated metadata", (t) => {
  const f = fixture(t);
  const before = fs.readFileSync(f.target);
  const next = refreshFirewallArtifacts(f.repo, f.paths, f.opts);
  assert.deepEqual(next.files, f.previous.files);
  assert.deepEqual(next.sources, f.previous.sources);
  assert.equal(next.sourceCommit, "a".repeat(40));
  assert.equal(f.count(), 1);
  const backups = fs.readdirSync(f.paths.logs);
  assert.equal(backups.length, 1);
  assert.deepEqual(fs.readFileSync(path.join(f.paths.logs, backups[0])), before);
  refreshFirewallArtifacts(f.repo, f.paths, f.opts);
  assert.equal(fs.readdirSync(f.paths.logs).length, 1);
});

for (const changed of [
  "src/helpers/parakeetWsServer.js",
  "src/models/modelRegistryData.json",
  "src/config/prompts.ts",
  "package-lock.json",
  "preload.js",
  "main.js",
  "src/dist/index.html",
  "scripts/download-sherpa-onnx.js",
])
  test(`refresh rejects changes outside the firewall update: ${changed}`, (t) => {
    const f = fixture(t);
    f.setChanges(changed);
    const before = fs.readFileSync(f.target);
    assert.throws(() => refreshFirewallArtifacts(f.repo, f.paths, f.opts), /refuses.*change/);
    assert.deepEqual(fs.readFileSync(f.target), before);
    assert.equal(f.count(), 0);
    assert.equal(fs.readdirSync(f.paths.logs).length, 0);
  });

test("refresh never blesses changed artifact bytes", (t) => {
  const f = fixture(t);
  const before = fs.readFileSync(f.target);
  fs.writeFileSync(f.artifact, "altered");
  assert.throws(() => refreshFirewallArtifacts(f.repo, f.paths, f.opts), /artifact changed/);
  assert.deepEqual(fs.readFileSync(f.target), before);
  fs.writeFileSync(f.artifact, "synthetic model sentinel");
});

test("refresh refuses invalid ancestry and absent effective firewall protection", (t) => {
  const f = fixture(t);
  const before = fs.readFileSync(f.target);
  assert.throws(
    () => refreshFirewallArtifacts(f.repo, f.paths, { ...f.opts, git: () => "invalid" }),
    /Invalid.*identity/
  );
  assert.throws(
    () =>
      refreshFirewallArtifacts(f.repo, f.paths, {
        ...f.opts,
        git: (...args) => {
          if (args[0] === "merge-base") throw Error("not an ancestor");
          return f.opts.git(...args);
        },
      }),
    /not an ancestor/
  );
  assert.throws(
    () =>
      refreshFirewallArtifacts(f.repo, f.paths, {
        ...f.opts,
        protect: () => {
          throw Error("no verified firewall");
        },
      }),
    /no verified firewall/
  );
  assert.deepEqual(fs.readFileSync(f.target), before);
  assert.equal(fs.readdirSync(f.paths.logs).length, 0);
});

test("firewall refresh allows only its narrow scripts plus documentation and tests", () => {
  assertFirewallOnlyChanges([
    "scripts/flosi-qa.ps1",
    "scripts/flosi-qa.js",
    "docs/FLOSI_FIREWALL_FIX.md",
    "test/helpers/flosiQaFirewallRefresh.test.js",
  ]);
  assert.throws(() => assertFirewallOnlyChanges(["scripts/arbitrary.js"]), /refuses/);
});
