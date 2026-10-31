const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");
const net = require("node:net");
const { execFileSync, execFile } = require("node:child_process");
const { QA, PORTS, contains, assertRoot } = require("./identity");

const MIN_FREE_BYTES = 4 * 1024 ** 3;
const BASELINE = "323923f963987a50913fbd3ba21f4fdf7b122cbc";
const FORBIDDEN_ENV =
  /(?:API_KEY|ACCESS_KEY|SECRET|CREDENTIAL|AWS_(?:DEFAULT_PROFILE|CONFIG_FILE)|CLOUDSDK_(?:CONFIG|ACTIVE_CONFIG)|AUTH_TOKEN|BEARER_TOKEN|SESSION_TOKEN|CLIENT_ID|GITHUB_TOKEN|GH_TOKEN|HF_TOKEN|HUGGING_FACE_HUB_TOKEN|GOOGLE_APPLICATION_CREDENTIALS|AWS_PROFILE|AZURE_CONFIG_DIR|VITE_.*(?:URL|KEY|TOKEN)|OPENWHISPR_.*(?:URL|PORT|ROOT|DIR|PROTOCOL)|WHISPER_.*(?:URL|PATH)|LLAMA_.*(?:URL|PATH)|PARAKEET_.*(?:URL|PATH))/i;

const QA_PREFERENCE_KEYS = new Set(
  `LOCAL_TRANSCRIPTION_PROVIDER PARAKEET_MODEL DICTATION_LANGUAGE LOCAL_WHISPER_MODEL CLEANUP_PROVIDER LOCAL_CLEANUP_MODEL DICTATION_AGENT_PROVIDER LOCAL_DICTATION_AGENT_MODEL LLAMA_GPU_BACKEND LLAMA_VULKAN_ENABLED DICTATION_KEY VOICE_AGENT_KEY TRANSLATION_KEY MEETING_KEY ACTIVATION_MODE FLOATING_ICON_AUTO_HIDE PANEL_START_POSITION START_MINIMIZED UI_LANGUAGE WHISPER_CUDA_ENABLED WHISPER_VULKAN_ENABLED WHISPER_VULKAN_DEVICE WHISPER_GPU_FAILED WHISPER_GPU_FAILED_REASON_CUDA WHISPER_GPU_FAILED_REASON_VULKAN WHISPER_THREADS TRANSCRIPTION_GPU_UUID INTELLIGENCE_GPU_UUID OPENWHISPR_LOG_LEVEL`.split(
    " "
  )
);

function assertEnvironment(env, repo) {
  if (
    env.FLOSI_VARIANT !== "qa" ||
    env.NODE_ENV !== "flosi-qa" ||
    env.OPENWHISPR_CHANNEL !== "development"
  ) {
    throw new Error("Use the Flosi QA launcher; variant, NODE_ENV or channel is unsafe");
  }
  const unsafe = Object.keys(env).filter(
    (key) =>
      env[key] &&
      (FORBIDDEN_ENV.test(key) ||
        QA_PREFERENCE_KEYS.has(key) ||
        (key.startsWith("OPENWHISPR_") && key !== "OPENWHISPR_CHANNEL") ||
        /^(?:WHISPER_CPP_VERSION|LLAMA_CPP_VERSION|SHERPA_ONNX_VERSION|ONNXRUNTIME_NODE_INSTALL_CUDA)$/.test(
          key
        ))
  );

  if (unsafe.length)
    throw new Error(`Flosi QA refuses inherited service configuration: ${unsafe.join(", ")}`);
  if (
    env.NODE_TLS_REJECT_UNAUTHORIZED === "0" ||
    env.ELECTRON_DISABLE_SANDBOX ||
    env.NODE_OPTIONS ||
    env.ELECTRON_RUN_AS_NODE
  ) {
    throw new Error("Flosi QA refuses runtime/security overrides");
  }
  for (const dir of [repo, path.join(repo, "src")]) {
    if (
      fs
        .readdirSync(dir)
        .some((name) => name === ".env" || (name.startsWith(".env.") && name !== ".env.example"))
    ) {
      throw new Error("Flosi QA refuses checkout .env files; use a fresh dedicated checkout");
    }
  }
}

function assertNoLinks(target) {
  let current = path.resolve(target);
  for (;;) {
    try {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink > 1))
        throw new Error("Flosi QA refuses links/junctions or hard-linked files");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

function scanTree(root) {
  assertNoLinks(root);
  if (!fs.existsSync(root)) return;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    assertNoLinks(target);
    if (entry.isDirectory()) scanTree(target);
  }
}

// Expand existing Windows aliases (including 8.3 names) before comparing
// protected roots. For a new directory, canonicalize the nearest parent.
function canonicalPath(target) {
  let current = path.resolve(target);
  const missing = [];
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) throw new Error("Cannot resolve QA path ancestry");
    missing.unshift(path.basename(current));
    current = parent;
  }
  return path.join(fs.realpathSync.native(current), ...missing);
}

function prepareRoot(
  paths,
  protectedPaths,
  { platform = process.platform, minFreeBytes = MIN_FREE_BYTES } = {}
) {
  assertRoot(paths.root, protectedPaths, platform);
  for (
    let parent = path.dirname(paths.root);
    parent !== path.dirname(parent);
    parent = path.dirname(parent)
  ) {
    if (fs.existsSync(path.join(parent, "flosi-qa.json")))
      throw new Error("MVP root must not be nested inside any earlier QA profile");
  }
  assertNoLinks(paths.root);
  assertRoot(canonicalPath(paths.root), protectedPaths.map(canonicalPath), platform);
  let existing = path.dirname(paths.root);
  while (!fs.existsSync(existing)) existing = path.dirname(existing);
  const disk = fs.statfsSync(existing);
  if (disk.bavail * disk.bsize < minFreeBytes)
    throw new Error("Flosi QA needs at least 4 GiB free before launch; preparation needs more");
  if (
    fs.existsSync(paths.root) &&
    fs.readdirSync(paths.root).length &&
    !fs.existsSync(paths.marker)
  ) {
    throw new Error("Flosi QA refuses a nonempty unmarked root; nothing was migrated or deleted");
  }
  if (fs.existsSync(paths.marker)) {
    const marker = JSON.parse(fs.readFileSync(paths.marker, "utf8"));
    if (
      marker.variant !== QA.variant ||
      marker.appId !== QA.appId ||
      marker.schema !== QA.schema ||
      marker.purpose !== QA.purpose ||
      marker.root !== paths.root
    ) {
      throw new Error("Flosi QA root identity does not match");
    }
  }
  scanTree(paths.root);
  fs.mkdirSync(paths.root, { recursive: true });
  if (platform === "win32") assertWindowsDirectoryAcl(paths.root);
  if (!fs.existsSync(paths.marker))
    fs.writeFileSync(paths.marker, JSON.stringify({ ...QA, root: paths.root }, null, 2), {
      flag: "wx",
      mode: 0o600,
    });
  for (const [key, value] of Object.entries(paths)) {
    if (key !== "marker") fs.mkdirSync(value, { recursive: true });
  }
  const probe = path.join(paths.temp, `preflight-${process.pid}.tmp`);
  fs.writeFileSync(probe, "Flosi QA write probe", { flag: "wx" });
  fs.unlinkSync(probe);
  const envFile = path.join(paths.userData, ".env");
  if (fs.existsSync(envFile)) {
    const parsed = require("dotenv").parse(fs.readFileSync(envFile));
    if (Object.keys(parsed).some((key) => !QA_PREFERENCE_KEYS.has(key)))
      throw new Error("Flosi QA profile contains unsupported configuration or credentials");
  }
  for (const forbidden of [
    "auth-token.bin",
    "account-scope-binding.json",
    "managed-enterprise-config.json",
    "workspace-policy.json",
  ]) {
    if (fs.existsSync(path.join(paths.userData, forbidden)))
      throw new Error(`Flosi QA refuses account data: ${forbidden}`);
  }
  const secretDir = path.join(paths.userData, "secure-keys");
  if (
    fs.existsSync(secretDir) &&
    fs
      .readdirSync(secretDir)
      .some((name) => name.endsWith(".enc") && name !== "flosi-qa-master-key-backup.enc")
  ) {
    throw new Error("Flosi QA refuses stored API credentials");
  }
  return { freeBytes: disk.bavail * disk.bsize, root: paths.root };
}

function windowsProcesses() {
  const powershell = path.win32.join(
    process.env.SystemRoot || "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe"
  );
  const output = execFileSync(
    powershell,
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "$ErrorActionPreference='Stop'; @(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine) | ConvertTo-Json -Compress",
    ],
    { encoding: "utf8", windowsHide: true, timeout: 15000, maxBuffer: 8 * 1024 ** 2 }
  );
  return JSON.parse(output.replace(/^\uFEFF/, ""));
}

function windowsProcessesAsync() {
  const powershell = path.win32.join(
    process.env.SystemRoot || "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe"
  );
  return new Promise((resolve, reject) =>
    execFile(
      powershell,
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "$ErrorActionPreference='Stop'; @(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine) | ConvertTo-Json -Compress",
      ],
      { encoding: "utf8", windowsHide: true, timeout: 15000, maxBuffer: 8 * 1024 ** 2 },
      (error, output) => {
        if (error) return reject(new Error("Flosi QA cannot recheck process collisions"));
        try {
          resolve(JSON.parse(output.replace(/^\uFEFF/, "")));
        } catch {
          reject(new Error("Flosi QA process observation is invalid"));
        }
      }
    )
  );
}

function assertWindowsDirectoryAcl(root) {
  const powershell = path.win32.join(
    process.env.SystemRoot || "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe"
  );
  // The path is passed as a child environment selector, never interpolated as code.
  const script =
    "$ErrorActionPreference='Stop'; $drive=[IO.DriveInfo]::new([IO.Path]::GetPathRoot($env:FLOSI_ACL_TARGET)); if($drive.DriveType -ne [IO.DriveType]::Fixed){throw 'Use a local fixed drive'}; $id=[Security.Principal.WindowsIdentity]::GetCurrent(); $p=[Security.Principal.WindowsPrincipal]::new($id); if($p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Run QA without elevation'}; $acl=Get-Acl -LiteralPath $env:FLOSI_ACL_TARGET; $allowed=@($id.User.Value,'S-1-5-18','S-1-5-32-544','S-1-3-0'); foreach($rule in $acl.Access){$sid=$rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value; if($rule.AccessControlType -eq 'Allow' -and ($rule.FileSystemRights -band [Security.AccessControl.FileSystemRights]'Write,Delete,DeleteSubdirectoriesAndFiles,ChangePermissions,TakeOwnership') -and $sid -notin $allowed){throw 'QA directory grants write access to another principal'}}; if($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $id.User.Value){throw 'QA directory is not owned by the current user'}";
  try {
    execFileSync(powershell, ["-NoProfile", "-NonInteractive", "-Command", script], {
      env: { ...process.env, FLOSI_ACL_TARGET: root },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      timeout: 15000,
    });
  } catch {
    throw new Error(
      "Flosi QA requires a private directory owned by the current user and a non-elevated session; ACLs were not modified"
    );
  }
}

function assertProcesses(processes, { ownPid = process.pid, launcherPid = process.ppid, repo }) {
  const conflict = processes.find((p) => {
    const pid = Number(p.ProcessId);
    if (pid === ownPid || pid === launcherPid) return false;
    const name = String(p.Name || "");
    if (
      /open.?whispr|whisper-server|llama-server|sherpa-onnx|qdrant|windows-(?:key|mic|fast-paste|system-audio|text-monitor)|meeting-aec|yt-dlp|ffmpeg/i.test(
        name
      )
    )
      return true;
    if (/electron/i.test(name)) {
      // Children of this new main are safe; another Electron remains ambiguous.
      return Number(p.ParentProcessId) !== ownPid;
    }
    return (
      /node/i.test(name) &&
      String(p.CommandLine || "").includes(repo) &&
      !contains(repo, String(p.ExecutablePath || ""))
    );
  });
  if (conflict)
    throw new Error(
      `Close the conflicting application normally before Flosi QA: ${conflict.Name} (PID ${conflict.ProcessId}). No process was terminated.`
    );
}

async function assertPortsFree(
  ports = Object.values(PORTS).flatMap(([start, end]) =>
    Array.from({ length: end - start + 2 }, (_, i) => start + i)
  )
) {
  for (const port of ports) {
    await new Promise((resolve, reject) => {
      const server = net.createServer();
      server.once("error", () =>
        reject(new Error(`Flosi QA loopback port ${port} is occupied or unavailable`))
      );
      server.listen({ host: "127.0.0.1", port, exclusive: true }, () => server.close(resolve));
    });
  }
}

function hashFile(file) {
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(file, "r");
  try {
    const buffer = Buffer.alloc(1024 * 1024);
    let bytes;
    while ((bytes = fs.readSync(fd, buffer, 0, buffer.length, null)))
      hash.update(buffer.subarray(0, bytes));
    return hash.digest("hex");
  } finally {
    fs.closeSync(fd);
  }
}

function verifyArtifacts(repo, paths, platform = process.platform) {
  const manifestPath = path.join(paths.root, "artifacts.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (
    manifest.schema !== 1 ||
    manifest.baseline !== BASELINE ||
    !Array.isArray(manifest.files) ||
    !manifest.files.length
  )
    throw new Error("Run Flosi QA Prepare: artifact manifest missing or invalid");
  for (const file of manifest.files) {
    if (!["repo", "renderer", "data"].includes(file.area))
      throw new Error("Unknown QA artifact area");
    const absolute =
      file.area === "data" ? path.resolve(paths.root, file.path) : path.resolve(repo, file.path);
    const allowedRoot =
      file.area === "repo"
        ? path.join(repo, "resources", "bin")
        : file.area === "renderer"
          ? path.join(repo, "src", "dist")
          : paths.root;
    // ffmpeg and Electron are locked npm dependencies rather than sidecars.
    if (!contains(allowedRoot, absolute)) throw new Error("Unsafe artifact path in QA manifest");
    assertNoLinks(absolute);
    const hash = hashFile(absolute);
    if (hash !== file.sha256) throw new Error(`QA artifact changed: ${file.path}`);
  }
  if (platform === "win32") {
    const sourceCommit = execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], {
      encoding: "utf8",
      windowsHide: true,
    }).trim();
    if (
      manifest.sourceCommit !== sourceCommit ||
      !manifest.files.some(
        (file) => file.area === "renderer" && path.basename(file.path) === "index.html"
      )
    )
      throw new Error("QA source/frontend changed; run Prepare for the reviewed commit again");
    const names = manifest.files.map((f) => path.basename(f.path));
    for (const name of [
      "whisper-server-win32-x64.exe",
      "windows-key-listener.exe",
      "windows-fast-paste.exe",
      "ggml-base.bin",
      "ggml-silero-v5.1.2.bin",
    ]) {
      if (!names.includes(name)) throw new Error(`Required QA artifact absent: ${name}`);
    }
    if (!fs.existsSync(path.join(repo, "node_modules", "ffmpeg-static", "ffmpeg.exe")))
      throw new Error("Locked ffmpeg dependency is absent");
  }
  return manifest;
}

module.exports = {
  BASELINE,
  MIN_FREE_BYTES,
  FORBIDDEN_ENV,
  assertEnvironment,
  assertNoLinks,
  scanTree,
  prepareRoot,
  windowsProcesses,
  windowsProcessesAsync,
  assertWindowsDirectoryAcl,
  assertProcesses,
  assertPortsFree,
  verifyArtifacts,
  hashFile,
};
