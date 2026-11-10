"use strict";

/**
 * Lifecycle management for the local Klyraudio Python service.
 *
 * The desktop shell owns one backend process. It picks a free loopback port,
 * starts the service with a restricted environment, waits for a health check
 * before the window loads the UI, monitors the process while the app is open,
 * and restarts it after repeated health failures.
 */

const { EventEmitter } = require("node:events");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

const LOOPBACK_HOST = "127.0.0.1";
const DEFAULT_PORT = 8765;
const STARTUP_TIMEOUT_MS = 45000;
const MONITOR_INTERVAL_MS = 5000;
const MAX_RESTART_ATTEMPTS = 3;
const LOG_LINES = 80;

function resolveBackendRoot({ isPackaged, resourcesPath, repoRoot }) {
  if (isPackaged) {
    return path.join(resourcesPath, "services", "api");
  }
  return path.join(repoRoot, "services", "api");
}

function resolveWebDir({ isPackaged, resourcesPath, repoRoot }) {
  if (isPackaged) {
    return path.join(resourcesPath, "web");
  }
  return path.join(repoRoot, "apps", "web", "dist");
}

function pythonCandidates({ platform, repoRoot }) {
  if (platform === "win32") {
    return [
      path.join(repoRoot, ".venv", "Scripts", "python.exe"),
      path.join(repoRoot, "venv", "Scripts", "python.exe"),
      "python",
      "py",
    ];
  }
  return [
    path.join(repoRoot, ".venv", "bin", "python3"),
    path.join(repoRoot, ".venv", "bin", "python"),
    "python3",
    "python",
  ];
}

/**
 * Pick the interpreter that runs the local service. An explicit
 * KLYRAUDIO_PYTHON override wins so packaged builds can point at a user-managed
 * installation.
 */
function resolvePythonCommand({
  platform = process.platform,
  repoRoot,
  env = process.env,
  exists = fs.existsSync,
} = {}) {
  const override = (env.KLYRAUDIO_PYTHON || "").trim();
  if (override) {
    return { command: override, args: [], source: "KLYRAUDIO_PYTHON" };
  }
  const candidates = pythonCandidates({ platform, repoRoot });
  for (const candidate of candidates) {
    if (!candidate.includes(path.sep)) {
      return { command: candidate, args: [], source: "PATH" };
    }
    if (exists(candidate)) {
      return { command: candidate, args: [], source: "project" };
    }
  }
  return {
    command: platform === "win32" ? "python" : "python3",
    args: [],
    source: "PATH",
  };
}

function isPortFree(port, host = LOOPBACK_HOST) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen({ port, host, exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

function ephemeralPort(host = LOOPBACK_HOST) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen({ port: 0, host, exclusive: true }, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function findAvailablePort(preferred = DEFAULT_PORT, host = LOOPBACK_HOST) {
  if (Number.isInteger(preferred) && preferred > 0 && (await isPortFree(preferred, host))) {
    return preferred;
  }
  return ephemeralPort(host);
}

function requestHealth(baseUrl, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const request = http.get(`${baseUrl}/api/health`, { timeout: timeoutMs }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        if (body.length < 8192) body += chunk;
      });
      response.on("end", () => {
        if (response.statusCode !== 200) {
          resolve(null);
          return;
        }
        try {
          const payload = JSON.parse(body);
          resolve(payload && payload.status === "ok" ? payload : null);
        } catch {
          resolve(null);
        }
      });
    });
    request.on("timeout", () => request.destroy());
    request.on("error", () => resolve(null));
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function appendLog(lines, chunk) {
  const text = String(chunk);
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().length === 0) continue;
    lines.push(line);
  }
  if (lines.length > LOG_LINES) {
    lines.splice(0, lines.length - LOG_LINES);
  }
}

class BackendManager extends EventEmitter {
  constructor({
    repoRoot,
    isPackaged = false,
    resourcesPath = process.resourcesPath || "",
    env = process.env,
    preferredPort = DEFAULT_PORT,
    startupTimeoutMs = STARTUP_TIMEOUT_MS,
    monitorIntervalMs = MONITOR_INTERVAL_MS,
    allowPortFallback = true,
    python,
    spawnImpl = spawn,
    healthCheck = requestHealth,
    portFinder = findAvailablePort,
  } = {}) {
    super();
    this.repoRoot = repoRoot;
    this.isPackaged = isPackaged;
    this.resourcesPath = resourcesPath;
    this.env = env;
    this.preferredPort = preferredPort;
    this.startupTimeoutMs = startupTimeoutMs;
    this.monitorIntervalMs = monitorIntervalMs;
    this.allowPortFallback = allowPortFallback;
    this.python = python;
    this.spawnImpl = spawnImpl;
    this.healthCheck = healthCheck;
    this.portFinder = portFinder;
    this.child = null;
    this.monitor = null;
    this.starting = null;
    this.stopping = false;
    this.restartAttempts = 0;
    this.logs = [];
    this.status = {
      state: "stopped",
      host: LOOPBACK_HOST,
      port: null,
      url: null,
      error: null,
      restarts: 0,
    };
  }

  getStatus() {
    return { ...this.status };
  }

  getLogs() {
    return [...this.logs];
  }

  backendRoot() {
    return resolveBackendRoot({
      isPackaged: this.isPackaged,
      resourcesPath: this.resourcesPath,
      repoRoot: this.repoRoot,
    });
  }

  webDir() {
    return resolveWebDir({
      isPackaged: this.isPackaged,
      resourcesPath: this.resourcesPath,
      repoRoot: this.repoRoot,
    });
  }

  _setStatus(patch) {
    this.status = { ...this.status, ...patch };
    this.emit("status", this.getStatus());
  }

  _appendLog(chunk) {
    appendLog(this.logs, chunk);
    this.emit("log", String(chunk));
  }

  async start() {
    if (this.status.state === "ready") return this.getStatus();
    if (this.starting) return this.starting;

    this.starting = this._start().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  async _start() {
    this.stopping = false;
    this._setStatus({ state: "starting", error: null, url: null, port: null });

    const backendRoot = this.backendRoot();
    const entry = path.join(backendRoot, "klyraudio_api", "__main__.py");
    if (!fs.existsSync(entry)) {
      const error = new Error(
        `The local service was not found at ${backendRoot}. Install the API dependencies or set KLYRAUDIO_PYTHON.`,
      );
      this._setStatus({ state: "error", error: error.message });
      throw error;
    }

    const python =
      this.python ||
      resolvePythonCommand({
        platform: process.platform,
        repoRoot: this.repoRoot,
        env: this.env,
      });
    const preferredFree = await isPortFree(this.preferredPort, LOOPBACK_HOST);
    if (!preferredFree && !this.allowPortFallback) {
      const error = new Error(
        `Port ${this.preferredPort} is already in use. Stop the other process and retry.`,
      );
      this._setStatus({ state: "error", error: error.message });
      throw error;
    }
    const port = preferredFree
      ? this.preferredPort
      : await this.portFinder(this.preferredPort, LOOPBACK_HOST);
    const url = `http://${LOOPBACK_HOST}:${port}`;
    const pythonPath = [backendRoot, this.env.PYTHONPATH].filter(Boolean).join(path.delimiter);
    const args = [
      ...python.args,
      "-m",
      "klyraudio_api",
      "--host",
      LOOPBACK_HOST,
      "--port",
      String(port),
    ];
    const environment = {
      ...this.env,
      PYTHONPATH: pythonPath,
      PYTHONUNBUFFERED: "1",
      KLYRAUDIO_HOST: LOOPBACK_HOST,
      KLYRAUDIO_PORT: String(port),
    };
    const webDir = this.webDir();
    if (fs.existsSync(path.join(webDir, "index.html"))) {
      environment.KLYRAUDIO_WEB_DIR = webDir;
    }

    this._appendLog(`Starting ${python.command} ${args.join(" ")}`);
    let child;
    try {
      child = this.spawnImpl(python.command, args, {
        cwd: this.repoRoot,
        env: environment,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (caught) {
      const error = new Error(`Could not start the local service: ${caught.message}`);
      this._setStatus({ state: "error", error: error.message });
      throw error;
    }
    this.child = child;
    let exitInfo = null;
    child.stdout?.on("data", (chunk) => this._appendLog(chunk));
    child.stderr?.on("data", (chunk) => this._appendLog(chunk));
    child.once("error", (caught) => {
      exitInfo = { error: caught };
      this._appendLog(`Service process error: ${caught.message}`);
    });
    child.once("exit", (code, signal) => {
      exitInfo = { code, signal };
      this.child = null;
      this._appendLog(`Service exited (code=${code ?? "null"}, signal=${signal ?? "none"})`);
      if (!this.stopping && this.status.state !== "error") {
        this._setStatus({
          state: "error",
          error: "The local service stopped unexpectedly. Restart it to continue.",
        });
      }
    });

    const deadline = Date.now() + this.startupTimeoutMs;
    while (Date.now() < deadline) {
      if (exitInfo) break;
      const health = await this.healthCheck(url);
      if (health) {
        this.restartAttempts = 0;
        this._setStatus({ state: "ready", port, url, error: null });
        this._startMonitor();
        return this.getStatus();
      }
      await delay(250);
    }

    await this._terminateChild();
    const detail = exitInfo?.error?.message || "The health check did not respond in time.";
    const error = new Error(`The local service did not become ready. ${detail}`);
    this._setStatus({ state: "error", error: error.message, url });
    throw error;
  }

  _startMonitor() {
    this._stopMonitor();
    this.monitor = setInterval(() => {
      void this._checkHealth();
    }, this.monitorIntervalMs);
    this.monitor.unref?.();
  }

  _stopMonitor() {
    if (this.monitor) {
      clearInterval(this.monitor);
      this.monitor = null;
    }
  }

  async _checkHealth() {
    if (this.status.state !== "ready" || this.checkingHealth) return;
    this.checkingHealth = true;
    try {
      const health = await this.healthCheck(this.status.url);
      if (health) {
        this.failures = 0;
        return;
      }
      this.failures = (this.failures || 0) + 1;
      if (this.failures < 3) return;
      this.failures = 0;
      this._setStatus({
        state: "restarting",
        error: "The local service stopped responding. Restarting it now.",
      });
      await this._restartAfterFailure();
    } finally {
      this.checkingHealth = false;
    }
  }

  async _restartAfterFailure() {
    this._stopMonitor();
    this.restartAttempts += 1;
    if (this.restartAttempts > MAX_RESTART_ATTEMPTS) {
      await this._terminateChild();
      this._setStatus({
        state: "error",
        error: "The local service could not be restarted. Close and reopen Klyraudio.",
      });
      return;
    }
    await this._terminateChild();
    this.stopping = false;
    try {
      await this._start();
      this._setStatus({ restarts: this.restartAttempts });
    } catch {
      // _start reports the error state and the logs hold the details.
    }
  }

  async _terminateChild() {
    const child = this.child;
    this.child = null;
    if (!child || child.killed || child.exitCode !== null) return;
    const exited = new Promise((resolve) => {
      const timer = setTimeout(resolve, 5000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
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
      // The process may already be gone.
    }
    await exited;
    if (child.exitCode === null && child.pid) {
      try {
        child.kill("SIGKILL");
      } catch {
        // Best effort only.
      }
    }
  }

  async stop() {
    this.stopping = true;
    this._stopMonitor();
    await this._terminateChild();
    this._setStatus({ state: "stopped", url: null, port: null, error: null });
    return this.getStatus();
  }

  async restart() {
    await this.stop();
    this.restartAttempts = 0;
    return this.start();
  }
}

module.exports = {
  BackendManager,
  DEFAULT_PORT,
  LOOPBACK_HOST,
  appendLog,
  findAvailablePort,
  isPortFree,
  pythonCandidates,
  requestHealth,
  resolveBackendRoot,
  resolvePythonCommand,
  resolveWebDir,
};
