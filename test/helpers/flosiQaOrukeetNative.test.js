// Opt-in Linux diagnostic with REAL original WS manager, sherpa binary and
// pinned weights. Only Electron paths/logging and binary discovery are adapted
// by the harness. This does not test the Windows firewall or Electron startup.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const { createHash } = require("node:crypto");
const utils = require("../../src/utils/serverUtils");
const pins = require("../../scripts/flosi-qa-orukeet-artifacts.json");
const { PORTS } = require("../../src/helpers/flosiQa/identity");

test(
  "real local Orukeet: execution, cancellation, recovery and owned-process shutdown",
  {
    skip: !process.env.FLOSI_ORUKEET_NATIVE_ROOT || process.platform !== "linux",
    timeout: 120000,
  },
  async (t) => {
    const root = path.resolve(process.env.FLOSI_ORUKEET_NATIVE_ROOT);
    const model = path.join(root, "data", "cache", "parakeet-models", pins.modelId);
    for (const file of pins.modelFiles)
      assert.equal(
        createHash("sha256")
          .update(fs.readFileSync(path.join(model, file.path)))
          .digest("hex"),
        file.sha256
      );
    const profile = path.join(root, "data", "profile");
    const temp = path.join(root, "data", "temp");
    const binary = path.join(root, "linux", "sherpa-onnx-offline-websocket-server");
    assert.equal(
      createHash("sha256").update(fs.readFileSync(binary)).digest("hex"),
      "a119ec9d7b156164ef02f097734f736932763ee3f8c1c8f975ea558b51b33dae"
    );
    assert.equal(
      createHash("sha256")
        .update(fs.readFileSync(path.join(root, "linux", "libonnxruntime.so")))
        .digest("hex"),
      "4b3607aebd1784b26b6f9b20e4bd974c7ab8287043e4d095cb7d2cb40b5e566e"
    );
    const pidPath = path.join(profile, "sidecar-pids", "parakeet.pid");
    const filename = require.resolve("../../src/helpers/parakeetWsServer");
    const localRequire = createRequire(filename);
    const module = { exports: {} };
    const sidecarFile = require.resolve("../../src/helpers/sidecarPidFile");
    const sidecar = { exports: {} };
    vm.runInNewContext(fs.readFileSync(sidecarFile, "utf8"), {
      module: sidecar,
      require: (name) =>
        name === "electron" ? { app: { getPath: () => profile } } : require(name),
    });
    vm.runInNewContext(
      fs.readFileSync(filename, "utf8"),
      {
        module,
        Buffer,
        process,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        require: (name) => {
          if (name === "./debugLogger") return { debug() {}, info() {}, error() {} };
          if (name === "./sidecarPidFile") return sidecar.exports;
          if (name === "./safeTempDir") return { getSafeTempDir: () => temp };
          if (name === "../utils/serverUtils")
            return {
              ...utils,
              resolveBinaryPath: () => binary,
              findAvailablePort: () => utils.findAvailablePort(...PORTS.parakeet),
            };
          return localRequire(name);
        },
      },
      { filename }
    );
    const server = new module.exports();
    t.after(async () => server.stop());
    const started = performance.now();
    await server.start(pins.modelId, model);
    const coldStartMs = performance.now() - started;
    const port = server.port;
    const pid = server.process.pid;
    assert.ok(port >= PORTS.parakeet[0] && port <= PORTS.parakeet[1]);
    assert.equal(fs.readFileSync(pidPath, "utf8"), String(pid));
    const wave = fs.readFileSync(path.join(root, "english-16k.wav"));
    // This deterministic diagnostic fixture is normalized by ffmpeg beforehand.
    let pcm;
    for (let offset = 12; offset + 8 <= wave.length;) {
      const length = wave.readUInt32LE(offset + 4);
      if (wave.toString("ascii", offset, offset + 4) === "data")
        pcm = wave.subarray(offset + 8, offset + 8 + length);
      offset += 8 + length + (length % 2);
    }
    assert.ok(pcm?.length);
    const samples = Buffer.alloc(pcm.length * 2);
    for (let i = 0; i < pcm.length / 2; i++)
      samples.writeFloatLE(pcm.readInt16LE(i * 2) / 32768, i * 4);
    const result = await server.transcribe(samples, 16000);
    assert.match(result.text, /local speech recognition test/i);
    // Exercise the original WAV/RMS/segmentation manager too. Only discovery,
    // logging and Electron path providers are facades, not audio/inference.
    const load = (file, replacements) => {
      const filename = require.resolve(file);
      const localRequire = createRequire(filename);
      const module = { exports: {} };
      vm.runInNewContext(
        fs.readFileSync(filename, "utf8"),
        {
          module,
          Buffer,
          process,
          setTimeout,
          clearTimeout,
          require: (name) => replacements[name] || localRequire(name),
        },
        { filename }
      );
      return module.exports;
    };
    const logger = { debug() {}, info() {}, warn() {}, error() {} };
    const ffmpeg = load("../../src/helpers/ffmpegUtils", { "./debugLogger": logger });
    const Manager = load("../../src/helpers/parakeetServer", {
      "./debugLogger": logger,
      "./ffmpegUtils": ffmpeg,
      "./modelDirUtils": { getModelsDirForService: () => path.dirname(model) },
      "./safeTempDir": { getSafeTempDir: () => temp },
      "./parakeetWsServer": module.exports,
    });
    const manager = new Manager();
    manager.wsServer = server;
    const managed = await manager.transcribe(wave, { modelName: pins.modelId });
    assert.equal(managed.text, result.text);
    const silentWave = Buffer.from(wave);
    silentWave.fill(0, wave.indexOf(pcm));
    const silence = await manager.transcribe(silentWave, { modelName: pins.modelId });
    assert.equal(silence.text, "");
    const controller = new AbortController();
    const cancelled = server.transcribe(samples, 16000, { signal: controller.signal });
    setTimeout(() => controller.abort(), 10);
    await assert.rejects(cancelled, /cancelled/i);
    const recovery = await server.transcribe(samples, 16000);
    assert.equal(recovery.text, result.text);
    const preAborted = new AbortController();
    preAborted.abort();
    await assert.rejects(
      server.transcribe(samples, 16000, { signal: preAborted.signal }),
      /cancelled/i
    );
    // The native server really listens on IPv4 ANY; a localhost client alone
    // must never be used as evidence of network isolation.
    const socketRow = fs
      .readFileSync("/proc/net/tcp", "utf8")
      .split("\n")
      .find((line) => line.includes(`00000000:${port.toString(16).toUpperCase()}`));
    assert.ok(socketRow, "expected unmodified IPv4 ANY listener");
    const pending = server.transcribe(samples, 16000);
    const rejected = assert.rejects(pending, /closed|connect|not running|ECONN/);
    await server.stop();
    await rejected;
    assert.equal(server.getStatus().running, false);
    assert.equal(fs.existsSync(pidPath), false);
    assert.equal(await utils.isPortAvailable(port), true);
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
    assert.throws(() => server.transcribe(samples, 16000), /not running/);
    t.diagnostic(
      JSON.stringify({
        coldStartMs,
        warmInferenceMs: result.elapsed,
        audioSeconds: samples.length / 4 / 16000,
        transcript: result.text,
        recoveryTranscriptMatches: true,
        cancellation: "passed",
        shutdown: "passed",
        listener: `0.0.0.0:${port}`,
        platform: process.platform,
        cpuProvider: true,
        originalWavManager: "passed",
        originalSilenceGate: "passed",
        windowsProtection: "NOT_TESTED",
      })
    );
  }
);
