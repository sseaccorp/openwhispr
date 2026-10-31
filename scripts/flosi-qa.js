#!/usr/bin/env node
// Unpackaged development launcher. It never builds an installer or invokes the
// upstream prestart/prebuild lifecycle, which downloads unrelated components.
const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync, execFileSync } = require("node:child_process");
const { QA, getPaths, protectedRoots, contains } = require("../src/helpers/flosiQa/identity");
const {
  BASELINE,
  assertEnvironment,
  prepareRoot,
  scanTree,
  windowsProcesses,
  assertProcesses,
  assertPortsFree,
  verifyArtifacts,
} = require("../src/helpers/flosiQa/preflight");
const { hashFile, downloadPinned, extractPinnedZip } = require("./flosi-qa-download");
const pins = require("./flosi-qa-artifacts.json");
const repo = path.resolve(__dirname, "..");

function command(file, args, env, log) {
  const fd = fs.openSync(log, "a");
  try {
    fs.writeSync(fd, `\n${path.basename(file)} ${args.join(" ")}\n`);
    const result = spawnSync(file, args, {
      cwd: repo,
      env,
      stdio: ["ignore", fd, fd],
      windowsHide: true,
    });
    if (result.error) throw result.error;
    if (result.status !== 0)
      throw new Error(`${path.basename(file)} failed (${result.status}); inspect ${log}`);
  } finally {
    fs.closeSync(fd);
  }
}

function privateToolEnv(paths, base = process.env) {
  return {
    ...base,
    NODE_USE_ENV_PROXY: base.NODE_USE_ENV_PROXY || "1",
    NO_PROXY: [base.NO_PROXY, "127.0.0.1", "::1", "localhost"].filter(Boolean).join(","),
    TEMP: paths.temp,
    TMP: paths.temp,
    npm_config_cache: path.join(paths.cache, "npm"),
    npm_config_devdir: path.join(paths.cache, "node-gyp"),
    ELECTRON_CACHE: path.join(paths.cache, "electron"),
    electron_config_cache: path.join(paths.cache, "electron"),
    ELECTRON_BUILDER_CACHE: path.join(paths.cache, "electron-builder"),
    XDG_CACHE_HOME: path.join(paths.cache, "xdg"),
    HF_HOME: path.join(paths.cache, "huggingface"),
    PSModuleAnalysisCachePath: path.join(paths.cache, "powershell-module-analysis"),
  };
}

function walkFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory() ? walkFiles(path.join(directory, e.name)) : [path.join(directory, e.name)]
    );
}

function copyNew(source, target) {
  if (fs.existsSync(target)) {
    if (hashFile(source) !== hashFile(target))
      throw new Error(`Refusing to replace existing artifact ${target}`);
    return;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
}

async function installPack(pack, paths, cuda = false) {
  const archive = path.join(paths.cache, "downloads", path.basename(new URL(pack.url).pathname));
  await downloadPinned(pack, archive);
  const staging = path.join(paths.temp, `extract-${pack.id}-${Date.now()}`);
  await extractPinnedZip(archive, staging);
  const files = walkFiles(staging);
  const binary = files.find((f) => path.basename(f) === pack.sourceBinary);
  if (!binary) throw new Error(`QA archive has no ${pack.sourceBinary}`);
  const destination = cuda
    ? path.join(paths.userData, "bin", "whisper-cuda")
    : path.join(repo, "resources", "bin");
  copyNew(binary, path.join(destination, pack.binary));
  for (const library of files.filter((f) => /\.dll$/i.test(f)))
    copyNew(library, path.join(destination, path.basename(library)));
  // Delete only the unique staging tree created by this operation.
  fs.rmSync(staging, { recursive: true });
  return [
    path.join(destination, pack.binary),
    ...files.filter((f) => /\.dll$/i.test(f)).map((f) => path.join(destination, path.basename(f))),
  ].map((file) => ({ path: path.relative(repo, file), sha256: hashFile(file) }));
}

function saveManifest(paths, sourceCommit, repository = repo) {
  const files = [
    ...walkFiles(path.join(repository, "src", "dist")).map((file) => ({
      area: "renderer",
      path: path.relative(repository, file),
      sha256: hashFile(file),
    })),
    ...walkFiles(path.join(repository, "resources", "bin")).map((file) => ({
      area: "repo",
      path: path.relative(repository, file),
      sha256: hashFile(file),
    })),
    ...[
      path.join(paths.cache, "whisper-models"),
      path.join(paths.cache, "models"),
      path.join(paths.userData, "bin"),
    ]
      .flatMap(walkFiles)
      .map((file) => ({
        area: "data",
        path: path.relative(paths.root, file),
        sha256: hashFile(file),
      })),
  ];
  const manifest = {
    schema: 1,
    baseline: BASELINE,
    sourceCommit,
    files,
    sources: pins,
    preparedAt: new Date().toISOString(),
  };
  const target = path.join(paths.root, "artifacts.json");
  fs.writeFileSync(`${target}.tmp`, JSON.stringify(manifest, null, 2), { flag: "wx" });
  fs.renameSync(`${target}.tmp`, target);
}

async function main() {
  const mode = process.argv[2];
  if (!["prepare", "addqwen", "check", "run", "report"].includes(mode))
    throw new Error(
      "Usage: node scripts/flosi-qa.js prepare|addqwen|check|run|report [--root PATH] [--cuda] [--local-ai]"
    );
  if (process.platform !== "win32" || process.arch !== "x64")
    throw new Error("The launcher requires Windows x64. Automated policy tests can run on Linux.");
  const rootIndex = process.argv.indexOf("--root");
  const env = {
    ...process.env,
    FLOSI_VARIANT: "qa",
    NODE_ENV: "flosi-qa",
    OPENWHISPR_CHANNEL: "development",
  };
  if (rootIndex !== -1) env.FLOSI_QA_ROOT = process.argv[rootIndex + 1];
  assertEnvironment(env, repo);
  if (process.version !== "v24.19.0")
    throw new Error("Reference QA requires Node.js 24.19.0; do not silently change the toolchain");
  const paths = getPaths(env);
  const home = require("node:os").homedir();
  const protectedPaths = protectedRoots({
    home,
    appData: process.env.APPDATA,
    localAppData: process.env.LOCALAPPDATA,
    programData: process.env.ProgramData || "C:\\ProgramData",
    systemDrive: `${process.env.SystemDrive || "C:"}\\`,
  });
  if (protectedPaths.some((target) => contains(target, repo) || contains(repo, target)))
    throw new Error("QA checkout overlaps a protected location");
  require("../src/helpers/flosiQa/preflight").assertNoLinks(repo);
  scanTree(path.join(repo, "resources"));
  const disk = prepareRoot(paths, [...protectedPaths, repo]);
  const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
  if (
    !/^https:\/\/github\.com\/sseaccorp\/openwhispr(?:\.git)?$/.test(
      git("remote", "get-url", "origin")
    )
  )
    throw new Error("QA checkout must use our fork");
  git("merge-base", "--is-ancestor", BASELINE, "HEAD");
  if (git("status", "--porcelain", "--untracked-files=no"))
    throw new Error(
      "Tracked checkout modifications detected; preserve them and use the reviewed QA commit"
    );
  if (contains(protectedPaths[0], repo) || repo.toLowerCase().includes("\\windows\\system32"))
    throw new Error("Unsafe checkout location");
  assertProcesses(windowsProcesses(), { repo });
  await assertPortsFree();
  const toolEnv = privateToolEnv(paths);
  const log = path.join(
    paths.logs,
    `prepare-${new Date().toISOString().replace(/[:.]/g, "-")}.log`
  );
  // npm.cmd is a shell script on Windows; execute npm's JS entry with Node.
  const npmCmd = execFileSync("where.exe", ["npm.cmd"], { encoding: "utf8" })
    .trim()
    .split(/\r?\n/)[0];
  const npmCli = path.join(path.dirname(npmCmd), "node_modules", "npm", "bin", "npm-cli.js");
  const npmVersion = execFileSync(process.execPath, [npmCli, "--version"], {
    encoding: "utf8",
    env: toolEnv,
  }).trim();
  if (npmVersion !== "11.17.0") throw new Error("Reference QA requires npm 11.17.0");
  const lockHash = hashFile(path.join(repo, "package-lock.json"));
  if (lockHash !== "9dfb56d340c4e7490ea88a0d819dd38ad273a788ea10ab0431d913369ea97a92")
    throw new Error("QA dependency lock differs from the audited baseline");
  if (mode === "prepare") {
    const cuda = process.argv.includes("--cuda");
    const localAi = process.argv.includes("--local-ai");
    // Conservative peak budgets include caches, extracted native runtime,
    // compilation scratch and a 4 GiB reserve; checked on BOTH volumes.
    const needed =
      ((cuda && localAi ? 18 : cuda || localAi ? 16 : 12) -
        (fs.existsSync(path.join(repo, "node_modules")) ? 7 : 0)) *
      1024 ** 3;
    const repoDisk = fs.statfsSync(repo);
    if (disk.freeBytes < needed || repoDisk.bavail * repoDisk.bsize < needed)
      throw new Error(
        `QA preparation requires ${needed / 1024 ** 3} GiB free on data and checkout volumes`
      );
    console.log(
      `Plan: Whisper base multilingual only (${pins.models[0].size} bytes), CPU helpers${cuda ? " + optional CUDA archive (773 MB, extracted budget reserved)" : ""}; minimum free ${needed / 1024 ** 3} GiB.${localAi ? " Optional local cleanup: original llama.cpp b9763 CPU + pinned Qwen3.5 2B Q4_K_M (1.40 GB)." : " No LLM download."} No Parakeet/all-model download.`
    );
    if (!fs.existsSync(path.join(repo, "node_modules")))
      command(process.execPath, [npmCli, "ci", "--no-audit", "--no-fund"], toolEnv, log);
    else
      console.log(
        "Existing dependencies preserved. Remove/rename only this dedicated checkout's node_modules yourself if installation was interrupted."
      );
    command(
      process.execPath,
      [path.join(repo, "node_modules", "electron-builder", "cli.js"), "install-app-deps"],
      toolEnv,
      log
    );
    for (const pack of pins.assets) await installPack(pack, paths);
    if (cuda) await installPack(pins.cuda, paths, true);
    for (const model of pins.models) {
      const destination =
        model.id === "base"
          ? path.join(paths.cache, "whisper-models", model.fileName)
          : path.join(repo, "resources", "bin", "whisper-vad", model.fileName);
      await downloadPinned(model, destination);
    }
    scanTree(path.join(repo, "resources", "bin"));
    command(process.execPath, [npmCli, "run", "build:renderer"], toolEnv, log);
    saveManifest(paths, git("rev-parse", "HEAD"));
    if (localAi)
      await require("./flosi-qa-qwen").addQwen(repo, paths, git("rev-parse", "HEAD"), {
        installPack,
        downloadPinned,
        saveManifest,
      });
  }
  if (mode === "addqwen")
    await require("./flosi-qa-qwen").addQwen(repo, paths, git("rev-parse", "HEAD"), {
      installPack,
      downloadPinned,
      saveManifest,
    });
  const qwenReceipt = fs.existsSync(path.join(paths.root, "local-dictation.json"))
    ? require("./flosi-qa-qwen").verifyQwen(repo, paths)
    : null;
  verifyArtifacts(repo, paths);
  const electronPackage = require(path.join(repo, "node_modules", "electron", "package.json"));
  if (electronPackage.version !== "41.10.7")
    throw new Error("Electron does not match the audited lock");
  const sqliteNative = path.join(
    repo,
    "node_modules",
    "better-sqlite3",
    "build",
    "Release",
    "better_sqlite3.node"
  );
  if (!fs.existsSync(sqliteNative) || !fs.existsSync(path.join(repo, "src", "dist", "index.html")))
    throw new Error("Run Prepare first: SQLite/frontend are absent");
  const electronExe = path.join(repo, "node_modules", "electron", "dist", "electron.exe");
  command(
    electronExe,
    [
      "--eval",
      `const D=require(${JSON.stringify(path.join(repo, "node_modules", "better-sqlite3"))});const db=new D(':memory:');if(db.prepare('SELECT 1 AS ok').get().ok!==1)process.exit(1);db.close();`,
    ],
    { ...toolEnv, ELECTRON_RUN_AS_NODE: "1" },
    log
  );
  const caps = execFileSync(
    path.join(repo, "resources", "bin", "windows-fast-paste.exe"),
    ["--capabilities"],
    { encoding: "utf8", env: toolEnv, windowsHide: true, timeout: 10000 }
  );
  if (!caps.includes("selection-copy-v1"))
    throw new Error("QA paste helper has an incompatible capability contract");
  const report = {
    identity: QA,
    commit: git("rev-parse", "HEAD"),
    baseline: BASELINE,
    lockHash,
    node: process.version,
    npm: npmVersion,
    electron: electronPackage.version,
    freeBytes: disk.freeBytes,
    localCleanup: qwenReceipt
      ? {
          model: qwenReceipt.model.id,
          sha256: qwenReceipt.model.sha256,
          size: qwenReceipt.model.size,
          runtime: qwenReceipt.runtime.version,
          backend: "cpu",
          prepared: true,
        }
      : { prepared: false },
    nativeWindowsFunctionalQA: "not_verified",
  };
  const reportFile = path.join(paths.logs, "environment.json");
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  if (mode !== "run") {
    console.log(JSON.stringify({ ...report, reportFile }, null, 2));
    return;
  }
  const fd = fs.openSync(path.join(paths.logs, `run-${Date.now()}.log`), "a");
  const child = spawn(electronExe, [repo, `--user-data-dir=${paths.sessionData}`], {
    cwd: paths.root,
    env: privateToolEnv(paths, env),
    stdio: ["ignore", fd, fd],
    windowsHide: false,
  });
  console.log(
    "Flosi QA started. Close it with tray > Quit; this launcher waits for its own child and does not kill other applications."
  );
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  fs.closeSync(fd);
  process.exitCode = code == null ? 1 : code;
}

if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { command, privateToolEnv, walkFiles, copyNew, installPack, saveManifest };
