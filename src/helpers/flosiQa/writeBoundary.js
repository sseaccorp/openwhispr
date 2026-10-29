// QA-only defence in depth for Node file writes, including future IPC exports.
// Native SQLite/Chromium/sidecars still require the isolated paths checked at
// startup. This is an application boundary, not an OS sandbox or race-proof ACL.
const fs = require("node:fs");
const { fileURLToPath } = require("node:url");
const { contains } = require("./identity");
const { assertNoLinks } = require("./preflight");

function createWriteCheck(root) {
  return function check(target) {
    if (target instanceof URL) target = fileURLToPath(target);
    if (Buffer.isBuffer(target)) target = target.toString();
    if (typeof target !== "string" || !contains(root, target))
      throw new Error("FLOSI_QA_WRITE_BLOCKED: destination is outside the private QA root");
    assertNoLinks(target);
  };
}

function installWriteBoundary(root, { readDenyRoots = [] } = {}) {
  const check = createWriteCheck(root);
  const undo = [];
  const fds = new Set();
  function replace(object, key, value) {
    const original = object[key];
    object[key] = value(original);
    undo.push(() => {
      object[key] = original;
    });
  }
  const mutations = {
    appendFile: [0],
    writeFile: [0],
    mkdir: [0],
    mkdtemp: [0],
    rm: [0],
    rmdir: [0],
    unlink: [0],
    rename: [0, 1],
    copyFile: [1],
    cp: [1],
    truncate: [0],
    chmod: [0],
    chown: [0],
    lchmod: [0],
    lchown: [0],
    utimes: [0],
    lutimes: [0],
  };
  const validate = (name, indices, args) => {
    for (const index of indices) {
      if (typeof args[index] === "number") {
        if (!fds.has(args[index]))
          throw new Error("FLOSI_QA_WRITE_BLOCKED: unowned file descriptor");
      } else check(args[index]);
    }
    // Copying is not an implicit migration mechanism in QA.
    if (name === "cp" || name === "copyFile") check(args[0]);
  };
  for (const [name, indices] of Object.entries(mutations)) {
    for (const key of [name, `${name}Sync`]) {
      if (typeof fs[key] === "function")
        replace(
          fs,
          key,
          (original) =>
            function (...args) {
              validate(name, indices, args);
              return original.apply(this, args);
            }
        );
    }
    if (typeof fs.promises[name] === "function")
      replace(
        fs.promises,
        name,
        (original) =>
          async function (...args) {
            validate(name, indices, args);
            return original.apply(this, args);
          }
      );
  }
  for (const name of ["symlink", "link"]) {
    for (const key of [name, `${name}Sync`])
      replace(fs, key, () => () => {
        throw new Error("FLOSI_QA_WRITE_BLOCKED: links are not permitted");
      });
    replace(fs.promises, name, () => async () => {
      throw new Error("FLOSI_QA_WRITE_BLOCKED: links are not permitted");
    });
  }
  function checkRead(target) {
    if (target instanceof URL) target = fileURLToPath(target);
    if (Buffer.isBuffer(target)) target = target.toString();
    if (typeof target === "string" && readDenyRoots.some((denied) => contains(denied, target)))
      throw new Error(
        "FLOSI_QA_READ_BLOCKED: official state or ambient credential files are unavailable"
      );
  }
  for (const name of ["readFile", "readFileSync", "createReadStream"])
    replace(
      fs,
      name,
      (original) =>
        function (target, ...rest) {
          checkRead(target);
          return original.call(this, target, ...rest);
        }
    );
  replace(
    fs.promises,
    "readFile",
    (original) =>
      async function (target, ...rest) {
        checkRead(target);
        return original.call(this, target, ...rest);
      }
  );
  const writable = (flags) =>
    typeof flags === "number"
      ? (flags &
          (fs.constants.O_WRONLY |
            fs.constants.O_RDWR |
            fs.constants.O_CREAT |
            fs.constants.O_TRUNC |
            fs.constants.O_APPEND)) !==
        0
      : /[wa+]/.test(flags);
  replace(
    fs,
    "openSync",
    (original) =>
      function (target, flags, ...rest) {
        checkRead(target);
        if (writable(flags)) check(target);
        const fd = original.call(this, target, flags, ...rest);
        if (writable(flags)) fds.add(fd);
        return fd;
      }
  );
  replace(
    fs,
    "open",
    (original) =>
      function (target, flags, ...rest) {
        checkRead(target);
        if (writable(flags)) check(target);
        const callback = rest.pop();
        return original.call(this, target, flags, ...rest, (error, fd) => {
          if (!error && writable(flags)) fds.add(fd);
          callback(error, fd);
        });
      }
  );
  replace(
    fs.promises,
    "open",
    (original) =>
      async function (target, flags, ...rest) {
        checkRead(target);
        if (writable(flags)) check(target);
        return original.call(this, target, flags, ...rest);
      }
  );
  replace(
    fs,
    "createWriteStream",
    (original) =>
      function (target, options) {
        check(target);
        if (options?.fd != null && !fds.has(options.fd))
          throw new Error("FLOSI_QA_WRITE_BLOCKED: unowned stream descriptor");
        return original.call(this, target, options);
      }
  );
  for (const name of [
    "write",
    "writeSync",
    "writev",
    "writevSync",
    "ftruncate",
    "ftruncateSync",
    "fchmod",
    "fchmodSync",
    "fchown",
    "fchownSync",
    "futimes",
    "futimesSync",
  ]) {
    replace(
      fs,
      name,
      (original) =>
        function (fd, ...rest) {
          if (fd !== 1 && fd !== 2 && !fds.has(fd))
            throw new Error("FLOSI_QA_WRITE_BLOCKED: unowned descriptor");
          return original.call(this, fd, ...rest);
        }
    );
  }
  replace(
    fs,
    "closeSync",
    (original) =>
      function (fd) {
        fds.delete(fd);
        return original.call(this, fd);
      }
  );
  replace(
    fs,
    "close",
    (original) =>
      function (fd, ...rest) {
        fds.delete(fd);
        return original.call(this, fd, ...rest);
      }
  );
  require("node:module").syncBuiltinESMExports();
  return () => {
    for (const restore of undo.reverse()) restore();
    require("node:module").syncBuiltinESMExports();
  };
}

module.exports = { createWriteCheck, installWriteBoundary };
