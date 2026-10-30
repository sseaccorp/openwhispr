// A firewall-only update must not download models, rebuild the renderer or
// bless changed artifacts. Preserve the existing validated inventory verbatim.
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { verifyArtifacts } = require("../src/helpers/flosiQa/preflight");
const PARENT = "a22615dd527e0cfab4e393bbd17abfcc3d3c417c";
const FILES = new Set([
  "scripts/flosi-qa-orukeet-firewall.ps1",
  "scripts/lib/flosi-qa-firewall.ps1",
  "scripts/flosi-qa-firewall-refresh.js",
  "scripts/flosi-qa.js",
  "scripts/flosi-qa.ps1",
]);

function assertFirewallOnlyChanges(files) {
  for (const file of files)
    if (!FILES.has(file) && !/^(?:docs|test)\//.test(file))
      throw new Error(`RefreshFirewall refuses a product/runtime change: ${file}`);
}

function refreshFirewallArtifacts(
  repo,
  paths,
  {
    git = (...args) =>
      execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", windowsHide: true }).trim(),
    protect = () => require("../src/helpers/flosiQa/orukeet").verifyOrukeet(repo, paths),
  } = {}
) {
  const target = path.join(paths.root, "artifacts.json");
  const before = fs.readFileSync(target);
  const previous = verifyArtifacts(repo, paths, "provisioning");
  const current = git("rev-parse", "HEAD");
  if (![previous.sourceCommit, current].every((commit) => /^[a-f0-9]{40}$/.test(commit)))
    throw new Error("Invalid QA source identity");
  git("merge-base", "--is-ancestor", PARENT, previous.sourceCommit);
  git("merge-base", "--is-ancestor", previous.sourceCommit, current);
  const changed = git("diff", "--name-only", previous.sourceCommit, current)
    .split(/\r?\n/)
    .filter(Boolean);
  assertFirewallOnlyChanges(changed);
  protect(); // Requires all fixed Orukeet files AND current effective rules.
  if (previous.sourceCommit === current) return previous;
  if (!fs.readFileSync(target).equals(before))
    throw new Error("QA inventory changed during verification; preserved");
  const backup = path.join(paths.logs, `artifacts-before-firewall-${randomUUID()}.json`);
  fs.writeFileSync(backup, before, { flag: "wx", mode: 0o600 });
  const next = {
    ...previous,
    sourceCommit: current,
    firewallRefreshedAt: new Date().toISOString(),
  };
  const temporary = `${target}.firewall-${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(next, null, 2), { flag: "wx", mode: 0o600 });
  fs.renameSync(temporary, target);
  return next;
}

module.exports = { PARENT, assertFirewallOnlyChanges, refreshFirewallArtifacts };
