const fs = require("node:fs");
const path = require("node:path");
const { QA, isQa, getPaths, protectedRoots } = require("./identity");
const {
  assertEnvironment,
  prepareRoot,
  assertProcesses,
  windowsProcesses,
  windowsProcessesAsync,
  assertPortsFree,
  verifyArtifacts,
} = require("./preflight");

function verifyElectronPaths(app, paths) {
  const actual = {};
  for (const key of ["userData", "sessionData", "temp", "logs", "crashDumps"]) {
    actual[key] = app.getPath(key);
    if (path.relative(paths[key], actual[key]) !== "")
      throw new Error(`Flosi QA Electron path was not applied: ${key}`);
  }
  return actual;
}

function initialize(electron) {
  if (!process.env.FLOSI_VARIANT) return null;
  if (!isQa()) throw new Error("Unknown Flosi variant; production is not implemented");
  const { app, ipcMain, session, dialog } = electron;
  if (process.platform !== "win32" || process.arch !== "x64" || app.isPackaged)
    throw new Error(
      "Flosi QA currently supports only unpackaged Windows x64; use unit tests on other platforms"
    );
  const repo = path.resolve(__dirname, "..", "..", "..");
  assertEnvironment(process.env, repo);
  if (
    process.argv.some((arg) =>
      /^(?:--no-sandbox|--disable-web-security|--ignore-certificate-errors)(?:=|$)/.test(arg)
    )
  )
    throw new Error("Flosi QA refuses insecure command-line flags");
  const paths = getPaths();
  const protectedPaths = protectedRoots({
    home: app.getPath("home"),
    appData: app.getPath("appData"),
    localAppData: process.env.LOCALAPPDATA,
    programData: process.env.ProgramData || "C:\\ProgramData",
    systemDrive: `${process.env.SystemDrive || "C:"}\\`,
  });
  const initialReport = prepareRoot(paths, [...protectedPaths, repo]);
  if (!process.versions.electron?.startsWith("41.10.7") || process.versions.modules !== "145")
    throw new Error("Flosi QA requires the locked Electron 41.10.7 / ABI 145");
  verifyArtifacts(repo, paths);
  assertProcesses(windowsProcesses(), { repo });

  app.setName(QA.name);
  app.setAppUserModelId(QA.appId);
  for (const key of ["userData", "sessionData", "temp", "logs", "crashDumps"])
    app.setPath(key, paths[key]);
  app.setAppLogsPath(paths.logs);
  const electronPaths = verifyElectronPaths(app, paths);
  // Process-local only. No HOME/USERPROFILE/APPDATA/LOCALAPPDATA changes.
  process.env.TEMP = paths.temp;
  process.env.TMP = paths.temp;
  process.env.HF_HOME = path.join(paths.cache, "huggingface");
  process.env.HF_HUB_CACHE = path.join(process.env.HF_HOME, "hub");
  process.env.HUGGINGFACE_HUB_CACHE = process.env.HF_HUB_CACHE;
  process.env.TRANSFORMERS_CACHE = path.join(paths.cache, "transformers");
  process.env.TORCH_HOME = path.join(paths.cache, "torch");
  process.env.CUDA_CACHE_PATH = path.join(paths.cache, "cuda");
  process.env.PSModuleAnalysisCachePath = path.join(paths.cache, "powershell-module-analysis");
  process.env.XDG_CACHE_HOME = path.join(paths.cache, "xdg");
  if (fs.existsSync(path.join(paths.root, "orukeet.json")))
    require("./orukeet").verifyOrukeet(repo, paths);
  process.env.LOCAL_TRANSCRIPTION_PROVIDER = "whisper";
  process.env.LOCAL_WHISPER_MODEL = "base";
  process.chdir(paths.root);

  const { installWriteBoundary } = require("./writeBoundary");
  const { installIpcPolicy, installNodeNetworkPolicy, installSessionPolicy } = require("./policy");
  installWriteBoundary(paths.root, {
    readDenyRoots: [
      ...protectedPaths,
      path.join(app.getPath("home"), ".aws"),
      path.join(app.getPath("home"), ".azure"),
      path.join(app.getPath("home"), ".config", "gcloud"),
    ],
  });
  installIpcPolicy(ipcMain);
  installNodeNetworkPolicy();
  const configureSession = (target) =>
    installSessionPolicy(target, [
      path.join(repo, "src"),
      path.join(repo, "resources"),
      paths.root,
    ]);
  app.on("session-created", configureSession);
  app.on("web-contents-created", (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.on("will-navigate", (event, url) => {
      if (!url.startsWith("file://")) event.preventDefault();
    });
  });
  ipcMain.on("flosi-qa-config", (event) => {
    event.returnValue = { variant: QA.variant };
  });
  let collisionTimer;
  let collisionCheckPending = false;
  app.once("before-quit", () => clearInterval(collisionTimer));
  return {
    paths,
    async preflight() {
      configureSession(session.defaultSession);
      await assertPortsFree();
      assertProcesses(windowsProcesses(), { repo });
      fs.writeFileSync(
        path.join(paths.logs, "preflight.json"),
        JSON.stringify(
          {
            ...initialReport,
            electronPaths,
            modelCache: paths.cache,
            appId: QA.appId,
            electron: process.versions.electron,
            nativeWindowsFunctionalQA: "not_verified",
            time: new Date().toISOString(),
          },
          null,
          2
        )
      );
      // If the official app starts later, release our hooks by quitting QA.
      // Never reap/kill a process merely because its name or stale PID matches.
      collisionTimer = setInterval(async () => {
        if (collisionCheckPending) return;
        collisionCheckPending = true;
        try {
          const ownTree = await windowsProcessesAsync();
          const descendants = new Set([process.pid]);
          for (let i = 0; i < ownTree.length; i++)
            for (const p of ownTree)
              if (descendants.has(Number(p.ParentProcessId))) descendants.add(Number(p.ProcessId));
          assertProcesses(
            ownTree.filter((p) => !descendants.has(Number(p.ProcessId))),
            { repo }
          );
        } catch (error) {
          clearInterval(collisionTimer);
          electron.globalShortcut.unregisterAll();
          dialog.showErrorBox("Flosi QA paused", error.message);
          app.quit();
        } finally {
          collisionCheckPending = false;
        }
      }, 5000);
      collisionTimer.unref();
    },
  };
}

module.exports = { initialize, verifyElectronPaths };
