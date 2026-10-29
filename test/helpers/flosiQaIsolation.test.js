const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const identity = require("../../src/helpers/flosiQa/identity");
const preflight = require("../../src/helpers/flosiQa/preflight");
const policy = require("../../src/helpers/flosiQa/policy");
const { hashFile, verifiedHost } = require("../../scripts/flosi-qa-download");

const repo = path.resolve(__dirname, "../..");
const normalEnv = { FLOSI_VARIANT: "qa", NODE_ENV: "flosi-qa", OPENWHISPR_CHANNEL: "development" };

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "flosi-isolation-"));
  const paths = identity.pathsFor(path.join(directory, "FlosiQA"));
  const official = path.join(directory, "OpenWhispr");
  fs.mkdirSync(official);
  for (const name of [
    "transcriptions.db",
    "transcriptions.db-wal",
    "auth-token.bin",
    "model.bin",
    "settings.json",
  ])
    fs.writeFileSync(path.join(official, name), `synthetic reference ${name}`);
  const original = () =>
    Object.fromEntries(
      fs.readdirSync(official).map((name) => [name, hashFile(path.join(official, name))])
    );
  const before = original();
  t.after(() => {
    try {
      assert.deepEqual(original(), before, "official fixture changed");
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
  return { directory, paths, official, before };
}

function runChild(script, env = {}) {
  const result = spawnSync(process.execPath, ["-e", script], {
    cwd: repo,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result;
}

test("identity is opt-in and future production cannot silently become QA", () => {
  assert.equal(identity.isQa({}), false);
  assert.equal(identity.isQa({ FLOSI_VARIANT: "production" }), false);
  assert.throws(() => identity.getPaths({}), /not active/);
});

test("baseline bootstrap without a variant has no Electron side effects", () => {
  runChild(
    `delete process.env.FLOSI_VARIANT; const assert=require('node:assert/strict'); assert.equal(require('./src/helpers/flosiQa/bootstrap').initialize(new Proxy({}, {get(){throw Error('Electron touched')}})),null);`
  );
});

test("unknown variant fails before Electron state is read", () => {
  runChild(
    `process.env.FLOSI_VARIANT='production'; const assert=require('node:assert/strict'); assert.throws(()=>require('./src/helpers/flosiQa/bootstrap').initialize({}),/not implemented/);`
  );
});

test("QA paths are siblings under a dedicated root", (t) => {
  const { paths, official } = fixture(t);
  assert.equal(new Set(Object.values(paths)).size, Object.keys(paths).length);
  for (const target of Object.values(paths)) {
    assert.ok(identity.contains(paths.root, target));
    assert.equal(identity.contains(official, target), false);
  }
});

for (const kind of ["inside", "ancestor", "same"])
  test(`protected root ${kind} overlap is rejected before writes`, (t) => {
    const { directory, official } = fixture(t);
    const target =
      kind === "inside" ? path.join(official, "QA") : kind === "ancestor" ? directory : official;
    assert.throws(() => preflight.prepareRoot(identity.pathsFor(target), [official]), /overlaps/);
  });

test("Windows rejects spaces and Unicode instead of using official ProgramData", (t) => {
  const { directory } = fixture(t);
  for (const name of ["Flosi QA", "Flosi-ñ"])
    assert.throws(() => identity.assertRoot(path.join(directory, name), [], "win32"), /ASCII/);
});

test("private root initializes idempotently without importing official data", (t) => {
  const { paths, official } = fixture(t);
  preflight.prepareRoot(paths, [official]);
  const marker = hashFile(paths.marker);
  preflight.prepareRoot(paths, [official]);
  assert.equal(hashFile(paths.marker), marker);
  assert.deepEqual(fs.readdirSync(paths.userData), []);
  assert.deepEqual(fs.readdirSync(paths.cache), []);
});

test("nonempty unmarked directory is preserved and rejected", (t) => {
  const { paths, official } = fixture(t);
  fs.mkdirSync(paths.root);
  fs.writeFileSync(path.join(paths.root, "unknown"), "preserve");
  assert.throws(() => preflight.prepareRoot(paths, [official]), /unmarked/);
  assert.equal(fs.readFileSync(path.join(paths.root, "unknown"), "utf8"), "preserve");
  assert.equal(fs.existsSync(paths.marker), false);
});

test("marker from another root or identity cannot be reused", (t) => {
  const { paths } = fixture(t);
  preflight.prepareRoot(paths, []);
  fs.writeFileSync(paths.marker, JSON.stringify({ ...identity.QA, root: `${paths.root}-other` }));
  assert.throws(() => preflight.prepareRoot(paths, []), /identity/);
});

test("disk headroom failure occurs before creating the QA root", (t) => {
  const { paths } = fixture(t);
  assert.throws(
    () => preflight.prepareRoot(paths, [], { minFreeBytes: Number.MAX_SAFE_INTEGER }),
    /GiB/
  );
  assert.equal(fs.existsSync(paths.root), false);
});

test("symlink/junction root pointing at reference data fails closed", (t) => {
  const { paths, official } = fixture(t);
  fs.symlinkSync(official, paths.root, process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => preflight.prepareRoot(paths, [official]), /links/);
});

test("nested link and hard-linked model are refused", (t) => {
  const { paths, official } = fixture(t);
  preflight.prepareRoot(paths, []);
  const target = path.join(paths.cache, "model.bin");
  fs.linkSync(path.join(official, "model.bin"), target);
  assert.throws(() => preflight.scanTree(paths.root), /hard-linked/);
  fs.unlinkSync(target);
  fs.symlinkSync(
    official,
    path.join(paths.cache, "nested"),
    process.platform === "win32" ? "junction" : "dir"
  );
  assert.throws(() => preflight.scanTree(paths.root), /links/);
});

for (const key of [
  "OPENAI_API_KEY",
  "GITHUB_TOKEN",
  "HF_TOKEN",
  "AWS_PROFILE",
  "VITE_AUTH_URL",
  "OPENWHISPR_CACHE_ROOT",
  "OPENWHISPR_AUTH_BRIDGE_PORT",
  "WHISPER_SERVER_URL",
  "LLAMA_SERVER_PATH",
  "NODE_OPTIONS",
  "ELECTRON_DISABLE_SANDBOX",
])
  test(`preflight rejects inherited ${key} without revealing its value`, () => {
    assert.throws(
      () =>
        preflight.assertEnvironment({ ...normalEnv, [key]: "synthetic-must-never-print" }, repo),
      (error) => !error.message.includes("synthetic-must-never-print")
    );
  });

test("checkout dotenv is rejected without loading credentials", (t) => {
  const { directory } = fixture(t);
  fs.mkdirSync(path.join(directory, "src"));
  fs.writeFileSync(path.join(directory, ".env.local"), "OPENAI_API_KEY=synthetic");
  assert.throws(() => preflight.assertEnvironment(normalEnv, directory), /\.env/);
});

for (const file of [
  "auth-token.bin",
  "account-scope-binding.json",
  "workspace-policy.json",
  "managed-enterprise-config.json",
])
  test(`private profile refuses copied account file ${file}`, (t) => {
    const { paths } = fixture(t);
    preflight.prepareRoot(paths, []);
    fs.writeFileSync(path.join(paths.userData, file), "synthetic");
    assert.throws(() => preflight.prepareRoot(paths, []), /account data/);
  });

test("private dotenv cannot introduce API credentials", (t) => {
  const { paths } = fixture(t);
  preflight.prepareRoot(paths, []);
  for (const key of [
    "OPENAI_API_KEY",
    "FLOSI_VARIANT",
    "NODE_ENV",
    "HOME",
    "OPENWHISPR_CACHE_ROOT",
  ]) {
    fs.writeFileSync(path.join(paths.userData, ".env"), `${key}=synthetic`);
    assert.throws(() => preflight.prepareRoot(paths, []), /credentials/);
  }
  fs.writeFileSync(
    path.join(paths.userData, ".env"),
    "LOCAL_WHISPER_MODEL=base\nWHISPER_CUDA_ENABLED=false\nOPENWHISPR_LOG_LEVEL=debug\n"
  );
  preflight.prepareRoot(paths, []);
  assert.throws(
    () =>
      preflight.assertEnvironment(
        { ...normalEnv, DICTATION_KEY: "synthetic-inherited-hotkey" },
        repo
      ),
    /DICTATION_KEY/
  );
  assert.throws(
    () =>
      preflight.assertEnvironment(
        { ...normalEnv, AWS_CONFIG_FILE: "synthetic-credential-selector" },
        repo
      ),
    /AWS_CONFIG_FILE/
  );
});

for (const name of [
  "OpenWhispr.exe",
  "whisper-server-win32-x64.exe",
  "qdrant.exe",
  "sherpa-onnx-ws-win32-x64.exe",
  "llama-server.exe",
  "electron.exe",
])
  test(`collision guard blocks ${name} without killing it`, () => {
    assert.throws(
      () =>
        preflight.assertProcesses([{ Name: name, ProcessId: 123, ParentProcessId: 987 }], {
          ownPid: 1,
          launcherPid: 2,
          repo,
        }),
      /Close the conflicting/
    );
  });

test("collision guard allows its own direct renderer child", () => {
  preflight.assertProcesses([{ Name: "electron.exe", ProcessId: 123, ParentProcessId: 1 }], {
    ownPid: 1,
    launcherPid: 2,
    repo,
  });
});

test("loopback port ownership probe detects occupied sockets", async (t) => {
  const net = require("node:net");
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  await assert.rejects(preflight.assertPortsFree([server.address().port]), /occupied/);
});

for (const url of [
  "https://api.openwhispr.com/api/reason",
  "https://auth.openwhispr.com",
  "https://example.com",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:8178",
  "http://localhost:18900",
  "http://127.0.0.1.evil.test:18900",
  "http://user:pass@127.0.0.1:18900",
])
  test(`runtime denies remote or non-QA endpoint ${url}`, () =>
    assert.equal(policy.allowedUrl(url), false));

test("runtime allows the separate local inference port ranges", () => {
  for (const [start, end] of Object.values(identity.PORTS))
    for (const port of [start, end])
      assert.equal(policy.allowedUrl(`http://127.0.0.1:${port}/health`), true);
  assert.equal(policy.allowedUrl("ws://127.0.0.1:18930"), true);
});

test("Node TCP guard blocks actual external attempts before connect", () => {
  const undo = policy.installNodeNetworkPolicy();
  try {
    assert.throws(
      () => require("node:net").connect({ host: "example.com", port: 443 }),
      /NETWORK_BLOCKED/
    );
    assert.throws(
      () => require("node:net").connect({ host: "127.0.0.1", port: 3000 }),
      /NETWORK_BLOCKED/
    );
    assert.throws(() => require("node:net").connect("\\\\.\\pipe\\openwhispr"), /NETWORK_BLOCKED/);
  } finally {
    undo();
  }
});

test("Chromium policy blocks both account requests and arbitrary providers", () => {
  let handler;
  policy.installSessionPolicy({
    webRequest: {
      onBeforeRequest: (fn) => {
        handler = fn;
      },
    },
  });
  for (const [url, expected] of [
    ["https://auth.openwhispr.com", true],
    ["https://api.openai.com", true],
    ["http://127.0.0.1:18900/health", false],
    ["file:///app/index.html", true],
  ]) {
    handler({ url }, (result) => assert.equal(result.cancel, expected));
  }
});

test("IPC QA denial happens before the original account/download handler", async () => {
  const registered = new Map();
  let calls = 0;
  const ipc = { handle: (name, listener) => registered.set(name, listener) };
  const restore = policy.installIpcPolicy(ipc);
  try {
    for (const name of [
      "auth-set-token",
      "cloud-reason",
      "cloud-api-request",
      "save-openai-key",
      "cleanup-app",
      "download-cuda-whisper-binary",
      "model-download",
      "open-external",
      "set-auto-start-enabled",
    ]) {
      ipc.handle(name, () => {
        calls++;
      });
      assert.throws(() => registered.get(name)({}), /FLOSI_QA_UNAVAILABLE/);
    }
    ipc.handle("transcribe-local-whisper", (_event, audio, options) => ({ audio, options }));
    const audio = Buffer.from("synthetic");
    const options = { model: "base", language: "es" };
    assert.deepEqual(registered.get("transcribe-local-whisper")({}, audio, options), {
      audio,
      options,
    });
    assert.equal(calls, 0);
  } finally {
    restore();
  }
});

test("write boundary protects reference files across sync, callback, promise and stream APIs", (t) => {
  const { paths, official } = fixture(t);
  preflight.prepareRoot(paths, []);
  runChild(
    `
    const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
    const root=process.env.TEST_QA_ROOT,official=process.env.TEST_OFFICIAL;
    const undo=require('./src/helpers/flosiQa/writeBoundary').installWriteBoundary(root);
    (async()=>{try {
      const external=path.join(official,'settings.json'),own=path.join(root,'private.txt');
      fs.writeFileSync(own,'owned');
      assert.throws(()=>fs.writeFileSync(external,'bad'),/WRITE_BLOCKED/);
      assert.throws(()=>fs.writeFile(external,'bad',()=>{}),/WRITE_BLOCKED/);
      await assert.rejects(fs.promises.writeFile(external,'bad'),/WRITE_BLOCKED/);
      assert.throws(()=>fs.createWriteStream(external),/WRITE_BLOCKED/);
      assert.throws(()=>fs.openSync(external,'r+'),/WRITE_BLOCKED/);
      await assert.rejects(fs.promises.open(external,'w'),/WRITE_BLOCKED/);
      assert.throws(()=>fs.rmSync(official,{recursive:true}),/WRITE_BLOCKED/);
      assert.throws(()=>fs.renameSync(own,external),/WRITE_BLOCKED/);
      assert.throws(()=>fs.renameSync(external,own),/WRITE_BLOCKED/);
      assert.throws(()=>fs.copyFileSync(external,path.join(root,'imported')),/WRITE_BLOCKED/);
      assert.throws(()=>fs.symlinkSync(official,path.join(root,'link')),/WRITE_BLOCKED/);
      const fd=fs.openSync(own,'a');fs.writeSync(fd,'!');fs.closeSync(fd);
      assert.equal(fs.readFileSync(own,'utf8'),'owned!');
      await fs.promises.writeFile(path.join(root,'async.txt'),'async');
    }finally{undo();}})().catch(e=>{console.error(e);process.exitCode=1});
  `,
    { TEST_QA_ROOT: paths.root, TEST_OFFICIAL: official }
  );
});

test("model path resolver never migrates the official cache in QA", (t) => {
  const { paths, official } = fixture(t);
  preflight.prepareRoot(paths, []);
  runChild(
    `
    const Module=require('node:module'),old=Module._load,assert=require('node:assert/strict');
    Module._load=function(name,...args){if(name==='electron')return {app:{getPath:()=>process.env.TEST_OFFICIAL}};return old.call(this,name,...args)};
    const model=require('./src/helpers/modelDirUtils');
    assert.equal(model.getCacheRoot(),require('./src/helpers/flosiQa/identity').getPaths().cache);
    assert.equal(require('./src/helpers/safeTempDir').getSafeTempDir(),require('./src/helpers/flosiQa/identity').getPaths().temp);
  `,
    { FLOSI_VARIANT: "qa", FLOSI_QA_ROOT: paths.root, TEST_OFFICIAL: official }
  );
});

test("real SQLite persistence and WAL remain private with the Node write boundary active", (t) => {
  const { paths, official } = fixture(t);
  preflight.prepareRoot(paths, []);
  runChild(
    `
    const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),Database=require('better-sqlite3');
    const root=process.env.TEST_QA_ROOT; const restore=require('./src/helpers/flosiQa/writeBoundary').installWriteBoundary(root);
    const db=new Database(path.join(root,'profile','transcriptions.db'));
    try{db.pragma('journal_mode=WAL');db.exec('CREATE TABLE transcripts(text TEXT)');db.prepare('INSERT INTO transcripts VALUES (?)').run('voz sintética');assert.equal(db.prepare('SELECT text FROM transcripts').get().text,'voz sintética');assert.ok(fs.existsSync(path.join(root,'profile','transcriptions.db-wal')));}finally{db.close();restore();}
  `,
    { TEST_QA_ROOT: paths.root, TEST_OFFICIAL: official }
  );
});

test("QA master key uses its own service and refuses official DPAPI fallback", (t) => {
  const { paths } = fixture(t);
  preflight.prepareRoot(paths, []);
  const entries = [];
  const memory = new Map();
  let dpapiDecrypt = 0;
  const cryptoModule = { exports: {} };
  const mockElectron = {
    app: { getPath: () => paths.userData },
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (text) => Buffer.from(text),
      decryptString: () => {
        dpapiDecrypt++;
        return "official-secret";
      },
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(repo, "src/helpers/secretCrypto.js"), "utf8"), {
    module: cryptoModule,
    Buffer,
    process: { env: { FLOSI_VARIANT: "qa" } },
    require(name) {
      if (name === "electron") return mockElectron;
      if (name === "./debugLogger") return { warn() {}, info() {} };
      if (name === "./flosiQa/identity") return identity;
      if (name === "@napi-rs/keyring")
        return {
          Entry: class {
            constructor(service, account) {
              this.id = `${service}/${account}`;
              entries.push(this.id);
            }
            getPassword() {
              return memory.get(this.id);
            }
            setPassword(value) {
              memory.set(this.id, value);
            }
          },
        };
      return require(name);
    },
  });
  const encrypted = cryptoModule.exports.encrypt("synthetic QA credential");
  assert.equal(cryptoModule.exports.decrypt(encrypted).value, "synthetic QA credential");
  assert.deepEqual(entries, ["Flosi-QA/qa-secrets-master-key-v1"]);
  assert.throws(
    () => cryptoModule.exports.decrypt(Buffer.from("official DPAPI blob")),
    /decryption failed/
  );
  assert.equal(dpapiDecrypt, 0);
});

test("QA preload initializes local settings once and preserves subsequent user choices", () => {
  const storage = new Map();
  let exposed;
  const context = {
    process: { argv: ["--flosi-qa"] },
    localStorage: {
      getItem: (key) => storage.get(key),
      setItem: (key, value) => storage.set(key, value),
    },
    require: () => ({
      contextBridge: {
        exposeInMainWorld: (_name, api) => {
          exposed = api;
        },
      },
      ipcRenderer: { sendSync: () => ({ variant: "qa" }) },
      webUtils: {},
    }),
  };
  const source = fs.readFileSync(path.join(repo, "preload.js"), "utf8");
  vm.runInNewContext(source, context);
  assert.equal(storage.get("transcriptionMode"), "local");
  assert.equal(storage.get("useCleanupModel"), "false");
  assert.equal(storage.get("isSignedIn"), "false");
  assert.equal(storage.get("authenticationSkipped"), "true");
  assert.equal(storage.get("skipAuth"), "true");
  storage.set("whisperModel", "small");
  vm.runInNewContext(source, { ...context });
  assert.equal(storage.get("whisperModel"), "small");
  assert.equal(typeof exposed.pasteText, "function");
});

test("download origins and hashes are explicit, including the original CUDA digest", () => {
  const pins = require("../../scripts/flosi-qa-artifacts.json");
  for (const file of [...pins.assets, pins.cuda, ...pins.models]) {
    verifiedHost(file.url);
    assert.match(file.sha256, /^[a-f0-9]{64}$/);
  }
  assert.equal(
    pins.cuda.sha256,
    "4bcf9f28bb1f725163442789015a600cdbccc4c40063de97d29f40b5855bb041"
  );
  assert.equal(pins.models.filter((f) => f.id === "base").length, 1);
  assert.throws(() => verifiedHost("https://github.com.evil.test/binary"), /Unverified/);
  assert.throws(() => verifiedHost("http://github.com/binary"), /Unverified/);
});

test("artifact modification is caught before inference startup", (t) => {
  const { paths } = fixture(t);
  preflight.prepareRoot(paths, []);
  const file = path.join(paths.cache, "fixture.bin");
  fs.writeFileSync(file, "fixture");
  fs.writeFileSync(
    path.join(paths.root, "artifacts.json"),
    JSON.stringify({
      schema: 1,
      baseline: preflight.BASELINE,
      files: [{ area: "data", path: path.relative(paths.root, file), sha256: hashFile(file) }],
    })
  );
  preflight.verifyArtifacts(repo, paths, "linux");
  fs.writeFileSync(file, "changed");
  assert.throws(() => preflight.verifyArtifacts(repo, paths, "linux"), /changed/);
});

test("path check rejects normalized traversal and file URLs outside QA", (t) => {
  const { paths, official } = fixture(t);
  preflight.prepareRoot(paths, []);
  const check = require("../../src/helpers/flosiQa/writeBoundary").createWriteCheck(paths.root);
  assert.throws(
    () => check(path.join(paths.root, "..", "OpenWhispr", "settings.json")),
    /WRITE_BLOCKED/
  );
  assert.throws(() => check(pathToFileURL(path.join(official, "settings.json"))), /WRITE_BLOCKED/);
});

test("hotkey preferences and download-status queries retain their original handlers", () => {
  const registered = new Map();
  const ipc = { handle: (channel, handler) => registered.set(channel, handler) };
  const restore = policy.installIpcPolicy(ipc);
  try {
    for (const channel of [
      "save-dictation-key",
      "save-voice-agent-key",
      "save-translation-key",
      "model-get-active-downloads",
      "get-cuda-whisper-status",
    ]) {
      ipc.handle(channel, (_event, value) => value);
      assert.equal(registered.get(channel)({}, "unchanged"), "unchanged");
    }
  } finally {
    restore();
  }
});

test("real application DatabaseManager writes only to the QA profile", (t) => {
  const { paths, official } = fixture(t);
  preflight.prepareRoot(paths, []);
  runChild(
    `
    const assert=require('node:assert/strict'),path=require('node:path'),Module=require('node:module');
    const old=Module._load;
    Module._load=function(name,...args){
      if(name==='electron')return {app:{getPath:()=>path.join(process.env.TEST_QA_ROOT,'profile'),isReady:()=>true}};
      if(name==='./debugLogger')return new Proxy({}, {get:()=>()=>{}});
      return old.call(this,name,...args);
    };
    const DatabaseManager=require('./src/helpers/database');
    const restore=require('./src/helpers/flosiQa/writeBoundary').installWriteBoundary(process.env.TEST_QA_ROOT);
    const manager=new DatabaseManager();
    try{
      assert.ok(manager.db,'real application database initialized');
      assert.equal(manager.db.pragma('database_list')[0].file,path.join(process.env.TEST_QA_ROOT,'profile','transcriptions.db'));
      assert.equal(manager.saveTranscription('synthetic QA persistence').success,true);
    }finally{manager.db?.close();restore();}
  `,
    { TEST_QA_ROOT: paths.root, TEST_OFFICIAL: official }
  );
});

test("runtime Node HTTP and fetch reach a private QA server and reject external destinations", async (t) => {
  const http = require("node:http");
  const server = http.createServer((_request, response) => response.end("local fixture"));
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(18920, "127.0.0.1", resolve);
  });
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const restore = policy.installNodeNetworkPolicy();
  try {
    const response = await fetch("http://127.0.0.1:18920/health");
    assert.equal(await response.text(), "local fixture");
    await assert.rejects(fetch("https://example.com"), (error) =>
      /NETWORK_BLOCKED/.test(String(error.cause))
    );
    assert.throws(() => require("node:https").get("https://example.com"), /NETWORK_BLOCKED/);
  } finally {
    restore();
  }
});

test("Chromium file requests cannot read the official reference directory", (t) => {
  const { paths, official } = fixture(t);
  let handler;
  policy.installSessionPolicy(
    {
      webRequest: {
        onBeforeRequest: (fn) => {
          handler = fn;
        },
      },
    },
    [paths.root]
  );
  handler({ url: pathToFileURL(path.join(official, "auth-token.bin")).href }, ({ cancel }) =>
    assert.equal(cancel, true)
  );
  handler({ url: pathToFileURL(path.join(paths.root, "fixture.wav")).href }, ({ cancel }) =>
    assert.equal(cancel, false)
  );
});

test("private tooling environment leaves the user's home and Windows profile selectors unchanged", (t) => {
  const { paths } = fixture(t);
  const source = {
    HOME: "synthetic home",
    APPDATA: "synthetic appdata",
    LOCALAPPDATA: "synthetic local",
    USERPROFILE: "synthetic profile",
    TEMP: "shared temp",
  };
  const scoped = require("../../scripts/flosi-qa").privateToolEnv(paths, source);
  for (const key of ["HOME", "APPDATA", "LOCALAPPDATA", "USERPROFILE"])
    assert.equal(scoped[key], source[key]);
  assert.equal(source.TEMP, "shared temp");
  assert.equal(scoped.TEMP, paths.temp);
  assert.ok(identity.contains(paths.cache, scoped.ELECTRON_CACHE));
  assert.ok(identity.contains(paths.cache, scoped.npm_config_cache));
});

test("fresh baseline checkout templates are accepted without reading dotenv", () => {
  preflight.assertEnvironment(normalEnv, repo);
});

test("dangling symbolic links cannot create files outside the private root", (t) => {
  const { paths, official } = fixture(t);
  preflight.prepareRoot(paths, []);
  const link = path.join(paths.cache, "dangling");
  fs.symlinkSync(
    path.join(official, "not-created"),
    link,
    process.platform === "win32" ? "junction" : "file"
  );
  assert.throws(() => preflight.assertNoLinks(link), /links/);
  assert.throws(
    () => require("../../src/helpers/flosiQa/writeBoundary").createWriteCheck(paths.root)(link),
    /links/
  );
  assert.equal(fs.existsSync(path.join(official, "not-created")), false);
});

test("Node cannot load ambient provider credentials or official state via its filesystem APIs", (t) => {
  const { paths, official } = fixture(t);
  preflight.prepareRoot(paths, []);
  runChild(
    `
    const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
    const root=process.env.TEST_QA_ROOT,official=process.env.TEST_OFFICIAL;
    const undo=require('./src/helpers/flosiQa/writeBoundary').installWriteBoundary(root,{readDenyRoots:[official]});
    (async()=>{try {
      const file=path.join(official,'auth-token.bin');
      assert.throws(()=>fs.readFileSync(file),/READ_BLOCKED/);
      assert.throws(()=>fs.createReadStream(file),/READ_BLOCKED/);
      assert.throws(()=>fs.openSync(file,'r'),/READ_BLOCKED/);
      await assert.rejects(fs.promises.readFile(file),/READ_BLOCKED/);
      const esm=await import('node:fs/promises');
      await assert.rejects(esm.writeFile(path.join(official,'settings.json'),'bad'),/WRITE_BLOCKED/);
    }finally{undo();}})().catch(e=>{console.error(e);process.exitCode=1});
  `,
    { TEST_QA_ROOT: paths.root, TEST_OFFICIAL: official }
  );
});

test("ordinary Electron startup cannot bypass the explicit mode in this checkout", () => {
  const guard = require("../../src/helpers/flosiQa/checkoutGuard");
  assert.throws(() => guard.assertExplicitQaMode(repo, {}), /Flosi QA checkout/);
  guard.assertExplicitQaMode(repo, normalEnv);
});

test("original startup/download/reset lifecycle is rejected before executing it", () => {
  const result = spawnSync(process.execPath, ["scripts/require-safe-entry.js"], {
    cwd: repo,
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /blocks the original/);
  const scripts = require("../../package.json").scripts;
  for (const name of [
    "prestart",
    "predev:main",
    "dev:main",
    "prebuild",
    "prepack",
    "predist",
    "clean",
    "download:embedding-model",
    "download:diarization-models",
  ])
    assert.ok(scripts[name].startsWith("node scripts/require-safe-entry.js && "), name);
});

test("checkout guard has no effect on an unmarked original checkout", (t) => {
  const { directory } = fixture(t);
  const guard = require("../../src/helpers/flosiQa/checkoutGuard");
  guard.assertExplicitQaMode(directory, {});
  guard.assertLegacyEntryAllowed(directory);
});

test("Tinfoil's native attested transport is refused before SDK import in QA", () => {
  runChild(
    `const assert=require('node:assert/strict');const client=require('./src/helpers/tinfoilSecureClient'); (async()=>{await assert.rejects(client.tinfoilSecureFetch('/v1/models'),/FLOSI_QA_UNAVAILABLE/);})().catch(e=>{console.error(e);process.exitCode=1});`,
    { FLOSI_VARIANT: "qa" }
  );
});

test("yt-dlp cannot run or update through the remote download interface in QA", () => {
  runChild(
    `const assert=require('node:assert/strict');const api=require('./src/helpers/urlAudioDownloader');(async()=>{for(const name of ['download','downloadViaProxy','maybeUpdateYtDlp']) await assert.rejects(api[name]('https://example.com/fixture.wav'),/FLOSI_QA_UNAVAILABLE/);})().catch(e=>{console.error(e);process.exitCode=1});`,
    { FLOSI_VARIANT: "qa", FLOSI_QA_ROOT: path.join(os.tmpdir(), "unused-flosi-no-download") }
  );
});

test("a changed renderer asset is rejected alongside changed model artifacts", (t) => {
  const { directory, paths } = fixture(t);
  preflight.prepareRoot(paths, []);
  const code = path.join(directory, "code");
  const file = path.join(code, "src", "dist", "index.html");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "synthetic renderer");
  fs.writeFileSync(
    path.join(paths.root, "artifacts.json"),
    JSON.stringify({
      schema: 1,
      baseline: preflight.BASELINE,
      files: [{ area: "renderer", path: path.relative(code, file), sha256: hashFile(file) }],
    })
  );
  preflight.verifyArtifacts(code, paths, "linux");
  fs.writeFileSync(file, "modified renderer");
  assert.throws(() => preflight.verifyArtifacts(code, paths, "linux"), /changed/);
});
