"use strict";

/**
 * Packaging smoke check for the electron-builder `--dir` output.
 *
 * `npm run build --workspace @klyraudio/desktop` produces an unpacked app
 * under `release/`. This script verifies that the result contains the
 * executable and every resource the desktop shell needs at runtime: the
 * archived application sources, the built web UI, and the local Python
 * service package. CI runs it on every platform so a packaging regression
 * fails the build instead of shipping a broken bundle.
 *
 * Usage: node scripts/verify-package.cjs [--release-dir <path>]
 */

const fs = require("node:fs");
const path = require("node:path");

const desktopPackage = require("../package.json");

const productName = desktopPackage.build.productName;

/**
 * Directory names electron-builder writes for `--dir` builds. The build
 * architecture becomes a suffix, so `win-unpacked` (x64) and `mac-arm64`
 * (arm64) both match. Temporary directories from universal builds keep a
 * `-temp` suffix, which the character class rejects.
 */
const UNPACKED_DIRECTORY_PATTERNS = {
  win32: /^win(-[a-z0-9]+)?-unpacked$/,
  linux: /^linux(-[a-z0-9]+)?-unpacked$/,
  darwin: /^mac(-[a-z0-9]+)?$/,
};

/** The executable inside each platform's unpacked app root. */
const EXECUTABLE_PATHS = {
  win32: [`${productName}.exe`],
  // electron-builder lowercases the sanitized product name on Linux.
  linux: [productName.toLowerCase()],
  darwin: ["Contents", "MacOS", productName],
};

/**
 * Paths inside the unpacked resources that must exist: the archived sources,
 * the built web UI, and the local service package.
 */
const REQUIRED_RESOURCES = [
  "app.asar",
  path.join("web", "index.html"),
  path.join("services", "api", "klyraudio_api", "__init__.py"),
];

/**
 * Locate the unpacked build for a platform inside an electron-builder output
 * directory. Throws when the build is missing or ambiguous.
 */
function findUnpackedDirectory({
  platform,
  releaseDir,
  readdirSync = fs.readdirSync,
}) {
  const pattern = UNPACKED_DIRECTORY_PATTERNS[platform];
  if (!pattern) {
    throw new Error(`Unsupported platform "${platform}".`);
  }
  const candidates = readdirSync(releaseDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && pattern.test(entry.name))
    .map((entry) => path.join(releaseDir, entry.name))
    .sort();
  if (candidates.length === 0) {
    throw new Error(
      `No unpacked ${platform} build found in ${releaseDir}. Run ` +
        `"npm run build --workspace @klyraudio/desktop" first.`,
    );
  }
  if (candidates.length > 1) {
    const names = candidates.map((dir) => path.basename(dir)).join(", ");
    throw new Error(`Expected one unpacked ${platform} build, found ${names}.`);
  }
  return candidates[0];
}

/**
 * Verify that an electron-builder `--dir` output contains the executable and
 * every required resource. Returns the resolved layout.
 */
function verifyPackageLayout({
  platform = process.platform,
  releaseDir,
  readdirSync = fs.readdirSync,
  existsSync = fs.existsSync,
}) {
  const unpackedDir = findUnpackedDirectory({ platform, releaseDir, readdirSync });
  const appRoot =
    platform === "darwin" ? path.join(unpackedDir, `${productName}.app`) : unpackedDir;
  const resourcesDir =
    platform === "darwin"
      ? path.join(appRoot, "Contents", "Resources")
      : path.join(unpackedDir, "resources");
  const executable = path.join(appRoot, ...EXECUTABLE_PATHS[platform]);

  const missing = [];
  if (!existsSync(executable)) {
    missing.push(path.relative(releaseDir, executable));
  }
  for (const resource of REQUIRED_RESOURCES) {
    if (!existsSync(path.join(resourcesDir, resource))) {
      missing.push(path.relative(releaseDir, path.join(resourcesDir, resource)));
    }
  }
  if (missing.length > 0) {
    throw new Error(`Packaged build is missing: ${missing.join(", ")}.`);
  }
  return { unpackedDir, appRoot, resourcesDir };
}

function parseArguments(argv) {
  const options = { releaseDir: path.resolve(__dirname, "..", "release") };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--release-dir" && argv[index + 1]) {
      options.releaseDir = path.resolve(argv[index + 1]);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argv[index]}`);
    }
  }
  return options;
}

function main(argv) {
  const { releaseDir } = parseArguments(argv);
  const layout = verifyPackageLayout({ releaseDir });
  console.log(`Verified the ${process.platform} packaged build at ${layout.appRoot}.`);
  console.log("Executable, application archive, web UI, and service package found.");
}

module.exports = {
  EXECUTABLE_PATHS,
  REQUIRED_RESOURCES,
  findUnpackedDirectory,
  parseArguments,
  verifyPackageLayout,
};

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
