"use strict";

/**
 * Electron main process for Klyraudio.
 *
 * The window only loads the loopback UI. The local Python service is started
 * before the window navigates, monitored while the app runs, and terminated on
 * quit. Navigation to remote origins is blocked; explicit HTTPS links open in
 * the user's default browser.
 */

const path = require("node:path");
const { app, BrowserWindow, ipcMain, session, shell } = require("electron");
const { BackendManager } = require("./backend.cjs");

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const devServerUrl = app.isPackaged ? null : (process.env.KLYRAUDIO_WEB_URL || "").trim() || null;
const skipBackend = process.env.KLYRAUDIO_SKIP_BACKEND === "1";
const isDev = !app.isPackaged;

let mainWindow = null;
let backend = null;
let quitting = false;
let booting = false;

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function pageShell(title, body, script = "") {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'" />
    <meta name="color-scheme" content="dark" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root { color-scheme: dark; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: radial-gradient(circle at 30% 20%, #16213a, #0b0d12 60%);
        color: #e8ecf4;
        font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
      }
      main { width: min(680px, calc(100vw - 48px)); padding: 32px; }
      .brand { letter-spacing: 0.32em; text-transform: uppercase; color: #8aa0c8; font-size: 12px; }
      h1 { margin: 12px 0 8px; font-size: 26px; font-weight: 600; }
      p { color: #aab6cd; line-height: 1.6; }
      pre {
        max-height: 220px;
        overflow: auto;
        padding: 14px;
        border-radius: 10px;
        background: #0a0c11;
        border: 1px solid #26314a;
        color: #c4cde0;
        font-size: 12px;
        white-space: pre-wrap;
      }
      button {
        margin-top: 18px;
        padding: 10px 18px;
        border-radius: 8px;
        border: 1px solid #3d5a8f;
        background: #1d2b47;
        color: #eaf0ff;
        font-size: 14px;
        cursor: pointer;
      }
      button:hover { background: #26395e; }
      .hint { font-size: 13px; color: #7d8aa3; }
    </style>
  </head>
  <body>
    <main>${body}</main>
    ${script ? `<script>${script}</script>` : ""}
  </body>
</html>`;
}

function splashPage() {
  return pageShell(
    "Starting Klyraudio",
    `<div class="brand">Klyraudio</div>
     <h1>Starting the local studio</h1>
     <p>The local service is starting on this computer. Audio, prompts, and projects stay on your device.</p>
     <p class="hint">This usually takes a few seconds.</p>`,
  );
}

function errorPage(message, logs) {
  const logText = logs.length > 0 ? escapeHtml(logs.join("\n")) : "No service output was captured.";
  return pageShell(
    "Klyraudio could not start",
    `<div class="brand">Klyraudio</div>
     <h1>The local service did not start</h1>
     <p>${escapeHtml(message)}</p>
     <p class="hint">Check that Python and the API dependencies are installed, then try again. If another service uses port 8765, stop it first.</p>
     <pre>${logText}</pre>
     <button id="retry" type="button">Retry</button>`,
    `document.getElementById("retry").addEventListener("click", function () {
       this.disabled = true;
       this.textContent = "Restarting…";
       window.klyraudioDesktop.restartService().catch(function () {
         this.disabled = false;
         this.textContent = "Retry";
       }.bind(this));
     });`,
  );
}

function sendStatus(status) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("desktop:service-status", status);
  }
}

function isAllowedNavigation(target) {
  try {
    const allowed = new URL(devServerUrl || backend?.getStatus().url || "http://127.0.0.1:8765");
    const next = new URL(target);
    return next.origin === allowed.origin;
  } catch {
    return false;
  }
}

function hardenSession() {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler(() => false);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 980,
    minHeight: 640,
    show: false,
    backgroundColor: "#0b0d12",
    title: "Klyraudio",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      webviewTag: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, target) => {
    if (isAllowedNavigation(target)) return;
    event.preventDefault();
    if (/^https:\/\//i.test(target)) {
      void shell.openExternal(target);
    }
  });

  mainWindow.webContents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });

  void mainWindow.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(splashPage())}`,
  );
  return mainWindow;
}

async function loadApplication() {
  if (!mainWindow) return;
  const status = backend?.getStatus();
  const target = devServerUrl || status?.url;
  if (!target) throw new Error("The local service URL is not available.");
  await mainWindow.loadURL(target);
}

async function showError(error) {
  if (!mainWindow) return;
  const message = error instanceof Error ? error.message : String(error);
  const logs = backend ? backend.getLogs() : [];
  await mainWindow.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(errorPage(message, logs))}`,
  );
}

async function boot() {
  if (booting) return;
  booting = true;
  try {
    if (!skipBackend && backend) {
      await backend.start();
    }
    await loadApplication();
  } catch (caught) {
    await showError(caught);
  } finally {
    booting = false;
  }
}

function installIpc() {
  ipcMain.handle("service:status", () => backend?.getStatus() ?? { state: "stopped" });
  ipcMain.handle("service:restart", async () => {
    if (!backend) return { state: "stopped" };
    try {
      const status = await backend.restart();
      if (status.state === "ready") {
        await loadApplication();
      } else {
        await showError(new Error(status.error || "The local service did not restart."));
      }
      return status;
    } catch (caught) {
      await showError(caught);
      return backend.getStatus();
    }
  });
}

function installAppLifecycle() {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    return;
  }

  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.on("before-quit", (event) => {
    if (!backend || quitting || backend.getStatus().state === "stopped") return;
    event.preventDefault();
    quitting = true;
    void backend.stop().finally(() => app.quit());
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("activate", () => {
    if (mainWindow) return;
    createWindow();
    if (skipBackend || backend?.getStatus().state === "ready") {
      void loadApplication().catch((caught) => void showError(caught));
    } else if (backend?.getStatus().state === "error") {
      void showError(new Error(backend.getStatus().error || "The local service is unavailable."));
    } else {
      void boot();
    }
  });
}

async function main() {
  if (process.platform === "win32") {
    app.setAppUserModelId("app.klyraudio.desktop");
  }

  backend = new BackendManager({
    repoRoot,
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    preferredPort: Number(process.env.KLYRAUDIO_PORT || 8765),
    allowPortFallback: app.isPackaged,
  });
  backend.on("status", sendStatus);

  installIpc();
  installAppLifecycle();

  await app.whenReady();
  hardenSession();
  createWindow();
  await boot();
}

void main().catch((error) => {
  console.error("Klyraudio failed to start:", error);
  app.quit();
});
