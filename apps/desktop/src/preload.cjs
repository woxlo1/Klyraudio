"use strict";

/**
 * The renderer runs untrusted web content from the loopback UI, so the preload
 * exposes a tiny, explicit API instead of Node.js or Electron internals.
 */

const { contextBridge, ipcRenderer } = require("electron");

const listeners = new Set();

ipcRenderer.on("desktop:service-status", (_event, status) => {
  for (const listener of listeners) {
    try {
      listener(status);
    } catch {
      // A broken renderer listener must not break the others.
    }
  }
});

contextBridge.exposeInMainWorld("klyraudioDesktop", {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  getServiceStatus: () => ipcRenderer.invoke("service:status"),
  restartService: () => ipcRenderer.invoke("service:restart"),
  onServiceStatus: (listener) => {
    if (typeof listener !== "function") return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
});
