import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { autoUpdater } from 'electron-updater';
import { attachSecureUpdater } from '../src/main/security/updaterIntegration';
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
  // Settings (settings.json) live in userData; the data directory itself is
  // user-configurable and persisted in settings.json (see src/main/config.ts).
  process.env.ANTIDETECT_SETTINGS_DIR = app.getPath('userData');
  const { getApiKey, getDataDir, setDataDir } = await import('../src/main/config');
  const { startService } = await import('../src/main/index');
  await startService();
  ipcMain.handle('antidetect:getApiKey', () => getApiKey());

  // Secret protection: proxy passwords/keys are encrypted at rest via DPAPI
  // (electron.safeStorage) when available; the backend falls back to a
  // "plain:" marker when running standalone outside Electron.
  try {
    const { safeStorage } = await import('electron');
    if (safeStorage.isEncryptionAvailable()) {
      const { setSecretCipher } = await import('../src/main/util/secretStore');
      setSecretCipher({
        encrypt: (s) => safeStorage.encryptString(s),
        decrypt: (b) => safeStorage.decryptString(b),
      });
    }
  } catch {
    // encryption unavailable — secrets fall back to the "plain:" marker
  }

  // Data directory management (profiles, kernel, extensions, DB).
  ipcMain.handle('data:get-dir', () => getDataDir());
  ipcMain.handle('data:set-dir', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const result = await dialog.showOpenDialog(win, {
      title: 'Select data folder (profiles, cache, kernel)',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, dir: getDataDir() };
    }
    const dir = result.filePaths[0];
    setDataDir(dir);
    return { ok: true, dir };
  });
  // Step 1 of a folder change: pick a folder WITHOUT applying it.
  ipcMain.handle('data:prepare-dir', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const result = await dialog.showOpenDialog(win, {
      title: 'Select new data folder (profiles, cache, kernel)',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, dir: getDataDir() };
    }
    return { ok: true, dir: result.filePaths[0] };
  });
  // Step 2: stop browsers, copy ALL data (db, profiles, extensions, backups,
  // kernel) to the target folder, persist the choice. Old folder is kept as a
  // backup. A restart applies the new folder.
  ipcMain.handle('data:migrate-dir', async (_evt, payload: unknown) => {
    const target = typeof (payload as { target?: unknown })?.target === 'string' ? (payload as { target: string }).target.trim() : '';
    const migrateData = (payload as { migrateData?: boolean })?.migrateData !== false;
    const { getDataDir: cur, setDataDir: setCur } = await import('../src/main/config');
    const oldDir = cur();
    if (!target || path.resolve(target) === path.resolve(oldDir)) {
      return { ok: false, dir: oldDir, error: 'same or invalid folder' };
    }
    try {
      const { stopAll } = await import('../src/main/launcher/chromium');
      const { flushDb, closeDb, initDb } = await import('../src/main/db');
      const { seedDevices } = await import('../src/main/devices/deviceManager');

      await stopAll();
      flushDb();
      closeDb(); // release file handles so the copy is consistent

      try {
        if (migrateData) {
          await fs.promises.mkdir(target, { recursive: true });
          await fs.promises.cp(oldDir, target, {
            recursive: true,
            force: false, // never overwrite anything already in the target
            errorOnExist: false,
            filter: (src) => {
              const base = path.basename(src);
              return !base.endsWith('.tmp') && base !== 'service.lock' && !base.endsWith('.restore-tmp');
            },
          });
        } else {
          await fs.promises.mkdir(target, { recursive: true });
        }
        setCur(target);
      } finally {
        // Re-open the DB at the OLD location so the app keeps working until restart.
        await initDb();
        seedDevices();
      }
      return { ok: true, dir: target, migrated: migrateData };
    } catch (err) {
      // make sure the DB is usable again at the old location after any failure
      try {
        const { initDb } = await import('../src/main/db');
        const { seedDevices } = await import('../src/main/devices/deviceManager');
        await initDb();
        seedDevices();
      } catch {
        // ignore
      }
      return { ok: false, dir: oldDir, error: (err as Error).message };
    }
  });
  ipcMain.handle('data:set-dir-path', (_evt, dirPath: unknown) => {
    const dir = typeof dirPath === 'string' ? dirPath.trim() : '';
    if (!dir || !fs.existsSync(dir) || !fs.existsSync(path.join(dir, 'antidetect.db'))) {
      return { ok: false, dir: getDataDir() };
    }
    setDataDir(dir);
    return { ok: true, dir };
  });
  ipcMain.handle('data:open-dir', () => {
    const dir = getDataDir();
    if (fs.existsSync(dir)) void shell.openPath(dir);
    return dir;
  });

  ipcMain.handle('logs:open-dir', async () => {
    const { LOG_DIR } = await import('../src/main/util/logger');
    fs.mkdirSync(LOG_DIR, { recursive: true });
    await shell.openPath(LOG_DIR);
    return LOG_DIR;
  });
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

  // Wire secure runtime supply-chain verification into autoUpdater
  attachSecureUpdater(autoUpdater, {
    currentInstalledVersion: app.getVersion(),
    onVerificationFailure: (result) => {
      sendToRenderers('update:status', {
        state: 'error',
        message: `Security verification failed: ${result.reason} - ${result.error ?? 'Refused by supply chain policy'}`,
      });
    },
  });

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

// Graceful shutdown: stop all running browser profiles and flush the DB
// before quitting.
app.on('before-quit', () => {
  void (async () => {
    try {
      const { stopAll } = await import('../src/main/launcher/chromium');
      stopAll();
    } catch {
      // ignore
    }
    try {
      const { flushDb } = await import('../src/main/db');
      flushDb();
    } catch {
      // ignore
    }
  })();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
