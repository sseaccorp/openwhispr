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

async function responseFor(value, redirects = 0, signal) {
  if (redirects > 6) throw new Error("Too many QA download redirects");
  const url = verifiedHost(value);
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      { headers: { "User-Agent": "Flosi-QA-Preparation" }, signal },
      (response) => {
        if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
          response.resume();
          responseFor(new URL(response.headers.location, url), redirects + 1, signal).then(
            resolve,
            reject
          );
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

async function downloadPinned(record, destination, { signal } = {}) {
  signal?.throwIfAborted();
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
  const response = await responseFor(record.url, 0, signal);
  // Limit even a compromised source to the pinned size and hash.
  let received = 0;
  response.on("data", (chunk) => {
    received += chunk.length;
    if (received > record.size) response.destroy(new Error("QA download exceeds pinned size"));
  });
  await pipeline(response, fs.createWriteStream(part, { flags: "wx" }), { signal });
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

// The upstream packages are tar.bz2. Extract only regular files/directories,
// never links/devices; validate even skipped names before touching the disk.
async function extractPinnedTarBz2(
  archive,
  destination,
  { select = () => true, maxBytes = 1024 ** 3 } = {}
) {
  if (fs.existsSync(destination)) throw new Error("Existing staging directory preserved");
  fs.mkdirSync(destination, { recursive: true });
  let total = 0;
  const seen = new Set();
  const parser = new (require("tar").Parser)({
    strict: true,
    onReadEntry(entry) {
      let fd;
      try {
        const name = entry.path.replace(/\/$/, "");
        const target = path.resolve(destination, name);
        if (
          !name ||
          /[\\:]/.test(name) ||
          path.isAbsolute(name) ||
          !contains(destination, target) ||
          name.split("/").some((p) => p === "..")
        )
          throw new Error("Unsafe TAR path");
        if (!select(name)) {
          entry.resume();
          return;
        }
        if (!["File", "Directory"].includes(entry.type)) throw new Error("Unsafe TAR link/device");
        if (seen.has(name.toLowerCase())) throw new Error("Duplicate TAR entry");
        seen.add(name.toLowerCase());
        total += entry.size;
        if (!Number.isSafeInteger(total) || total > maxBytes)
          throw new Error("TAR exceeds extraction budget");
        if (entry.type === "Directory") fs.mkdirSync(target, { recursive: true });
        else {
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fd = fs.openSync(target, "wx", 0o600);
          entry.on("data", (chunk) => {
            try {
              fs.writeSync(fd, chunk);
            } catch (error) {
              parser.abort(error);
            }
          });
          const close = () => {
            parser.removeListener("error", close);
            if (fd !== undefined) {
              fs.closeSync(fd);
              fd = undefined;
            }
          };
          entry.once("end", close);
          parser.once("error", close);
        }
        entry.resume();
      } catch (error) {
        entry.resume();
        parser.abort(error);
      }
    },
  });
  await pipeline(fs.createReadStream(archive), require("unbzip2-stream")(), parser);
}

module.exports = { hashFile, verifiedHost, downloadPinned, extractPinnedZip, extractPinnedTarBz2 };
