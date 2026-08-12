import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { autoUpdater } from 'electron-updater';

const isDev = process.env.NODE_ENV === 'development';

// electron-updater logs through its own logger; keep it quiet unless verbose.
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

/**
 * Module system note: the Electron main process and the Node backend (src/main)
 * are compiled to CommonJS (see tsconfig.main.json). The React renderer is ESM
 * handled by Vite. Backend modules are imported dynamically AFTER setting
 * ANTIDETECT_DATA_DIR so the backend never depends on Electron at import time
 * and can also run standalone via `npm run service`.
 */
async function bootstrap(): Promise<void> {
  process.env.ANTIDETECT_DATA_DIR = app.getPath('userData');
  const { getApiKey } = await import('../src/main/config');
  const { startService } = await import('../src/main/index');
  await startService();
  ipcMain.handle('antidetect:getApiKey', () => getApiKey());
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'Antidetect Browser',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    void win.loadURL('http://localhost:5173');
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

// ---------------------------------------------------------------------------
// Auto-update (electron-updater + GitHub Releases)
// ---------------------------------------------------------------------------

function sendToRenderers(channel: string, payload?: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload);
  }
}

function updaterEnabled(): boolean {
  // Updates only make sense for installed (packaged) builds; dev runs use the local checkout.
  return app.isPackaged;
}

function initAutoUpdater(): void {
  if (!updaterEnabled()) return;
  if (!process.env.GH_TOKEN && !process.env.GITHUB_TOKEN) {
    // Public repo: releases are public, no token needed to download updates.
  }
  autoUpdater.on('checking-for-update', () => sendToRenderers('update:status', { state: 'checking' }));
  autoUpdater.on('update-available', (info) =>
    sendToRenderers('update:status', { state: 'available', info })
  );
  autoUpdater.on('update-not-available', (info) =>
    sendToRenderers('update:status', { state: 'not-available', info })
  );
  autoUpdater.on('error', (err) =>
    sendToRenderers('update:status', { state: 'error', message: err?.message ?? String(err) })
  );
  autoUpdater.on('download-progress', (progress) =>
    sendToRenderers('update:status', {
      state: 'downloading',
      percent: progress.percent,
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total,
    })
  );
  autoUpdater.on('update-downloaded', (info) =>
    sendToRenderers('update:status', { state: 'downloaded', info })
  );

  ipcMain.handle('update:check', () => {
    void autoUpdater.checkForUpdates().catch((err) => {
      sendToRenderers('update:status', { state: 'error', message: err?.message ?? String(err) });
    });
  });
  ipcMain.handle('update:download', () => {
    void autoUpdater.downloadUpdate().catch((err) => {
      sendToRenderers('update:status', { state: 'error', message: err?.message ?? String(err) });
    });
  });
  ipcMain.handle('update:quit-and-install', () => {
    // isSilent = true (/S flag on NSIS installer), isForceRun = true (relaunch app immediately after update)
    autoUpdater.quitAndInstall(true, true);
  });
}

app.whenReady().then(async () => {
  await bootstrap();
  createWindow();
  initAutoUpdater();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch((err) => {
  console.error('[antidetect] bootstrap failed', err);
});

// Graceful shutdown: stop all running browser profiles before quitting.
app.on('before-quit', () => {
  void (async () => {
    try {
      const { stopAll } = await import('../src/main/launcher/chromium');
      stopAll();
    } catch {
      // ignore
    }
  })();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
