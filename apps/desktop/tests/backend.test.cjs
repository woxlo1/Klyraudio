"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  BackendManager,
  findAvailablePort,
  isPortFree,
  resolveBackendRoot,
  resolvePythonCommand,
  resolveWebDir,
} = require("../src/backend.cjs");

function temporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "klyraudio-desktop-"));
}

function fakeChild() {
  const child = new EventEmitter();
  child.pid = 4242;
  child.killed = false;
  child.exitCode = null;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {
    child.killed = true;
    return true;
  };
  return child;
}

test("resolveBackendRoot and resolveWebDir follow development and packaged layouts", () => {
  const repoRoot = path.join("C:", "work", "Klyraudio");
  assert.equal(
    resolveBackendRoot({ isPackaged: false, resourcesPath: "", repoRoot }),
    path.join(repoRoot, "services", "api"),
  );
  assert.equal(
    resolveBackendRoot({ isPackaged: true, resourcesPath: "C:\\Program Files\\Klyraudio", repoRoot }),
    path.join("C:\\Program Files\\Klyraudio", "services", "api"),
  );
  assert.equal(
    resolveWebDir({ isPackaged: false, resourcesPath: "", repoRoot }),
    path.join(repoRoot, "apps", "web", "dist"),
  );
  assert.equal(
    resolveWebDir({ isPackaged: true, resourcesPath: "/opt/klyraudio", repoRoot }),
    path.join("/opt/klyraudio", "web"),
  );
});

test("resolvePythonCommand honours the environment override first", () => {
  const result = resolvePythonCommand({
    platform: "win32",
    repoRoot: "C:\\missing",
    env: { KLYRAUDIO_PYTHON: "C:\\Python312\\python.exe" },
    exists: () => false,
  });
  assert.deepEqual(result, {
    command: "C:\\Python312\\python.exe",
    args: [],
    source: "KLYRAUDIO_PYTHON",
  });
});

test("resolvePythonCommand prefers a project virtualenv when it exists", () => {
  const repoRoot = path.join(os.tmpdir(), "klyraudio-repo");
  const expected = path.join(repoRoot, ".venv", "bin", "python3");
  const result = resolvePythonCommand({
    platform: "linux",
    repoRoot,
    env: {},
    exists: (candidate) => candidate === expected,
  });
  assert.deepEqual(result, { command: expected, args: [], source: "project" });
});

test("findAvailablePort keeps the preferred port when it is free", async () => {
  const server = net.createServer();
  await new Promise((resolve) => server.listen({ host: "127.0.0.1", port: 0 }, resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  assert.equal(await isPortFree(port), true);
  assert.equal(await findAvailablePort(port), port);
});

test("findAvailablePort falls back when the preferred port is occupied", async (t) => {
  const server = net.createServer();
  await new Promise((resolve) => server.listen({ host: "127.0.0.1", port: 0 }, resolve));
  t.after(() => server.close());
  const busyPort = server.address().port;
  assert.equal(await isPortFree(busyPort), false);
  const selected = await findAvailablePort(busyPort);
  assert.notEqual(selected, busyPort);
  assert.ok(selected > 0);
});

test("BackendManager refuses a busy port when fallback is disabled", async (t) => {
  const server = net.createServer();
  await new Promise((resolve) => server.listen({ host: "127.0.0.1", port: 0 }, resolve));
  t.after(() => server.close());
  const busyPort = server.address().port;

  const manager = new BackendManager({
    repoRoot: path.resolve(__dirname, "..", "..", ".."),
    preferredPort: busyPort,
    allowPortFallback: false,
    spawnImpl: () => fakeChild(),
    healthCheck: async () => ({ status: "ok" }),
  });

  await assert.rejects(manager.start(), /already in use/);
  assert.equal(manager.getStatus().state, "error");
});

test("BackendManager reports ready after the health check succeeds", async () => {
  const repoRoot = path.resolve(__dirname, "..", "..", "..");
  const child = fakeChild();
  const manager = new BackendManager({
    repoRoot,
    preferredPort: 18765,
    portFinder: async () => 18765,
    spawnImpl: () => child,
    healthCheck: async () => ({ status: "ok", local_only: true }),
  });

  const status = await manager.start();
  assert.equal(status.state, "ready");
  assert.equal(status.url, "http://127.0.0.1:18765");
  assert.ok(manager.getLogs().some((line) => line.includes("Starting")));

  child.exitCode = 0;
  const stopped = await manager.stop();
  assert.equal(stopped.state, "stopped");
});

test("BackendManager explains a missing service entry point", async () => {
  const manager = new BackendManager({
    repoRoot: temporaryDirectory(),
    spawnImpl: () => fakeChild(),
  });
  await assert.rejects(manager.start(), /local service was not found/);
  assert.equal(manager.getStatus().state, "error");
});
