"use strict";

/**
 * Development launcher: starts the Vite dev server, waits for it, then starts
 * Electron pointed at the dev URL. Electron owns the Python service in
 * development too, so quit behavior matches the packaged app.
 */

const { spawn } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");

const desktopRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(desktopRoot, "..", "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const viteUrl = "http://127.0.0.1:5173";
const vitePort = 5173;

/**
 * Node refuses to spawn .cmd shims without a shell on Windows. When this script
 * runs from an npm script, `npm_execpath` points at npm's JavaScript entry
 * point, so we can run it through the current Node binary instead of a shell.
 */
function spawnNpm(args, options) {
  const npmCli = process.env.npm_execpath;
  if (npmCli && npmCli.toLowerCase().endsWith(".js")) {
    return spawn(process.execPath, [npmCli, ...args], options);
  }
  return spawn(npmCommand, args, {
    ...options,
    shell: process.platform === "win32",
  });
}

let vite = null;
let electron = null;
let shuttingDown = false;

function killTree(child) {
  if (!child || child.killed || child.exitCode !== null) return;
  try {
    if (process.platform === "win32" && child.pid) {
      spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
        windowsHide: true,
        stdio: "ignore",
      });
    } else {
      child.kill("SIGTERM");
    }
  } catch {
    // Best effort cleanup.
  }
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  killTree(electron);
  killTree(vite);
  setTimeout(() => process.exit(code), 300);
}

function waitForPort(port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect({ host: "127.0.0.1", port });
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() > deadline) {
          reject(new Error(`Vite did not start on port ${port} in time.`));
          return;
        }
        setTimeout(attempt, 250);
      });
    };
    attempt();
  });
}

async function main() {
  vite = spawnNpm(["run", "dev", "--workspace", "@klyraudio/web"], {
    cwd: repoRoot,
    stdio: "inherit",
    windowsHide: true,
  });
  vite.once("exit", (code) => {
    if (!shuttingDown) {
      console.error(`Vite exited with code ${code ?? "null"}.`);
      shutdown(code || 1);
    }
  });

  await waitForPort(vitePort);
  console.log(`Vite is ready at ${viteUrl}. Starting Electron…`);

  let electronBinary;
  try {
    electronBinary = require("electron");
  } catch {
    throw new Error("Electron is not installed. Run npm install at the repository root.");
  }

  const environment = { ...process.env, KLYRAUDIO_WEB_URL: viteUrl };
  delete environment.ELECTRON_RUN_AS_NODE;
  electron = spawn(electronBinary, ["."], {
    cwd: desktopRoot,
    env: environment,
    stdio: "inherit",
    windowsHide: false,
  });
  electron.once("exit", (code) => {
    shutdown(code || 0);
  });
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  shutdown(1);
});
