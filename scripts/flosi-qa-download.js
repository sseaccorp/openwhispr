const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");
const { hashFile } = require("../src/helpers/flosiQa/preflight");
const { pipeline } = require("node:stream/promises");
const { contains } = require("../src/helpers/flosiQa/identity");

function verifiedHost(value) {
  const url = new URL(value);
  const allowed = [
    "github.com",
    "release-assets.githubusercontent.com",
    "objects.githubusercontent.com",
    "huggingface.co",
    "cdn-lfs.huggingface.co",
  ];
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (!allowed.includes(url.hostname) && !url.hostname.endsWith(".hf.co"))
  )
    throw new Error("Unverified QA download origin");
  return url;
}

async function responseFor(value, redirects = 0) {
  if (redirects > 6) throw new Error("Too many QA download redirects");
  const url = verifiedHost(value);
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      { headers: { "User-Agent": "Flosi-QA-Preparation" } },
      (response) => {
        if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
          response.resume();
          responseFor(new URL(response.headers.location, url), redirects + 1).then(resolve, reject);
        } else if (response.statusCode !== 200) {
          response.resume();
          reject(
            new Error(
              `QA download HTTP ${response.statusCode} from ${url.hostname}; no security bypass permitted`
            )
          );
        } else resolve(response);
      }
    );
    request.setTimeout(30000, () => request.destroy(new Error("QA download timed out")));
    request.once("error", reject);
  });
}

async function downloadPinned(record, destination) {
  verifiedHost(record.url);
  if (
    !/^[a-f0-9]{64}$/.test(record.sha256) ||
    !Number.isSafeInteger(record.size) ||
    record.size <= 0
  )
    throw new Error("Invalid pinned QA artifact");
  if (fs.existsSync(destination)) {
    if (fs.statSync(destination).size !== record.size || hashFile(destination) !== record.sha256)
      throw new Error("Existing artifact differs; preserve it and investigate, no overwrite");
    return;
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const part = `${destination}.part`;
  if (fs.existsSync(part))
    throw new Error("An incomplete QA download exists; inspect and rename it before retrying");
  const response = await responseFor(record.url);
  // Limit even a compromised source to the pinned size and hash.
  let received = 0;
  response.on("data", (chunk) => {
    received += chunk.length;
    if (received > record.size) response.destroy(new Error("QA download exceeds pinned size"));
  });
  await pipeline(response, fs.createWriteStream(part, { flags: "wx" }));
  if (received !== record.size || hashFile(part) !== record.sha256)
    throw new Error("QA artifact integrity check failed; retained .part for investigation");
  fs.renameSync(part, destination);
}

async function extractPinnedZip(archive, destination) {
  const unzipper = require("unzipper");
  const directory = await unzipper.Open.file(archive);
  let total = 0;
  for (const entry of directory.files) {
    if (entry.path.includes("\\") || entry.path.includes(":")) throw new Error("Unsafe ZIP entry");
    const target = path.resolve(destination, entry.path);
    if (
      !contains(destination, target) ||
      ((entry.externalFileAttributes >>> 16) & 0o170000) === 0o120000
    )
      throw new Error("Unsafe ZIP traversal/link");
    total += entry.uncompressedSize;
  }
  if (total > 4 * 1024 ** 3) throw new Error("QA extraction exceeds disk budget");
  if (fs.existsSync(destination))
    throw new Error("Existing staging directory was preserved; inspect it before retrying");
  fs.mkdirSync(destination, { recursive: true });
  await directory.extract({ path: destination });
}

module.exports = { hashFile, verifiedHost, downloadPinned, extractPinnedZip };
