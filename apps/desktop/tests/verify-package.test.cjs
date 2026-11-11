"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  findUnpackedDirectory,
  parseArguments,
  verifyPackageLayout,
} = require("../scripts/verify-package.cjs");

const productName = "Klyraudio";
const linuxExecutableName = require("../package.json").build.linux.executableName;

function temporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "klyraudio-package-"));
}

function writeLayout(root, platform, { omit = [] } = {}) {
  const executablePaths = {
    win32: [path.join(root, "win-unpacked", `${productName}.exe`)],
    linux: [path.join(root, "linux-unpacked", linuxExecutableName)],
    darwin: [
      path.join(root, "mac-arm64", `${productName}.app`, "Contents", "MacOS", productName),
    ],
  };
  const resourcesRoots = {
    win32: path.join(root, "win-unpacked", "resources"),
    linux: path.join(root, "linux-unpacked", "resources"),
    darwin: path.join(root, "mac-arm64", `${productName}.app`, "Contents", "Resources"),
  };
  const files = [
    ...executablePaths[platform],
    path.join(resourcesRoots[platform], "app.asar"),
    path.join(resourcesRoots[platform], "web", "index.html"),
    path.join(resourcesRoots[platform], "services", "api", "klyraudio_api", "__init__.py"),
  ];
  for (const file of files) {
    if (omit.some((missing) => file === missing)) continue;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "");
  }
}

test("verifyPackageLayout accepts a Windows unpacked build", () => {
  const root = temporaryDirectory();
  const releaseDir = path.join(root, "release");
  fs.mkdirSync(releaseDir);
  writeLayout(releaseDir, "win32");

  const layout = verifyPackageLayout({ platform: "win32", releaseDir });
  assert.equal(layout.appRoot, path.join(releaseDir, "win-unpacked"));
  assert.equal(layout.resourcesDir, path.join(releaseDir, "win-unpacked", "resources"));
});

test("verifyPackageLayout accepts a Linux unpacked build with the configured binary name", () => {
  const root = temporaryDirectory();
  const releaseDir = path.join(root, "release");
  fs.mkdirSync(releaseDir);
  writeLayout(releaseDir, "linux");

  const layout = verifyPackageLayout({ platform: "linux", releaseDir });
  assert.equal(layout.appRoot, path.join(releaseDir, "linux-unpacked"));
  assert.equal(layout.resourcesDir, path.join(releaseDir, "linux-unpacked", "resources"));
});

test("verifyPackageLayout accepts a macOS app bundle and reads its Resources", () => {
  const root = temporaryDirectory();
  const releaseDir = path.join(root, "release");
  fs.mkdirSync(releaseDir);
  writeLayout(releaseDir, "darwin");

  const layout = verifyPackageLayout({ platform: "darwin", releaseDir });
  assert.equal(layout.unpackedDir, path.join(releaseDir, "mac-arm64"));
  assert.equal(layout.appRoot, path.join(releaseDir, "mac-arm64", "Klyraudio.app"));
  assert.equal(
    layout.resourcesDir,
    path.join(releaseDir, "mac-arm64", "Klyraudio.app", "Contents", "Resources"),
  );
});

test("verifyPackageLayout reports missing executable and resources by name", () => {
  const root = temporaryDirectory();
  const releaseDir = path.join(root, "release");
  fs.mkdirSync(releaseDir);
  writeLayout(releaseDir, "win32", {
    omit: [
      path.join(releaseDir, "win-unpacked", "Klyraudio.exe"),
      path.join(releaseDir, "win-unpacked", "resources", "web", "index.html"),
    ],
  });

  assert.throws(
    () => verifyPackageLayout({ platform: "win32", releaseDir }),
    /missing: .*Klyraudio\.exe, .*index\.html/,
  );
});

test("findUnpackedDirectory rejects an empty release directory", () => {
  const releaseDir = temporaryDirectory();
  assert.throws(
    () => findUnpackedDirectory({ platform: "win32", releaseDir }),
    /No unpacked win32 build found/,
  );
});

test("findUnpackedDirectory rejects ambiguous unpacked builds", () => {
  const releaseDir = temporaryDirectory();
  fs.mkdirSync(path.join(releaseDir, "win-unpacked"));
  fs.mkdirSync(path.join(releaseDir, "win-arm64-unpacked"));
  assert.throws(
    () => findUnpackedDirectory({ platform: "win32", releaseDir }),
    /Expected one unpacked win32 build, found win-arm64-unpacked, win-unpacked/,
  );
});

test("findUnpackedDirectory ignores temporary directories from universal builds", () => {
  const releaseDir = temporaryDirectory();
  fs.mkdirSync(path.join(releaseDir, "mac-arm64-temp"));
  assert.throws(
    () => findUnpackedDirectory({ platform: "darwin", releaseDir }),
    /No unpacked darwin build found/,
  );
});

test("findUnpackedDirectory rejects unsupported platforms", () => {
  const releaseDir = temporaryDirectory();
  assert.throws(
    () => findUnpackedDirectory({ platform: "sunos", releaseDir }),
    /Unsupported platform "sunos"/,
  );
});

test("parseArguments defaults to the desktop release directory", () => {
  const options = parseArguments([]);
  assert.equal(path.basename(options.releaseDir), "release");
  assert.equal(path.basename(path.dirname(options.releaseDir)), "desktop");
});

test("parseArguments resolves a release directory override", () => {
  const options = parseArguments(["--release-dir", path.join("some", "dir")]);
  assert.equal(options.releaseDir, path.resolve(path.join("some", "dir")));
  assert.throws(() => parseArguments(["--release-dir"]), /Unknown argument/);
  assert.throws(() => parseArguments(["--verbose"]), /Unknown argument/);
});
