import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Frameless Window Configuration (electron/main.ts)', () => {
  const mainTsPath = path.resolve(__dirname, '../../electron/main.ts');
  const mainTsContent = fs.readFileSync(mainTsPath, 'utf-8');

  it('BrowserWindow is configured with frame: false', () => {
    // Assert BrowserWindow configuration contains frame: false
    expect(mainTsContent).toMatch(/new\s+BrowserWindow\s*\(\s*\{[\s\S]*?frame:\s*false/);
  });

  it('removes native application menu (Menu.setApplicationMenu(null))', () => {
    // Assert that Menu.setApplicationMenu(null) is called
    expect(mainTsContent).toMatch(/Menu\.setApplicationMenu\s*\(\s*null\s*\)/);
  });

  it('registers all three window control IPC handlers: minimize, toggle-maximize, close', () => {
    expect(mainTsContent).toMatch(/ipcMain\.on\s*\(\s*['"]window:minimize['"]/);
    expect(mainTsContent).toMatch(/ipcMain\.on\s*\(\s*['"]window:toggle-maximize['"]/);
    expect(mainTsContent).toMatch(/ipcMain\.on\s*\(\s*['"]window:close['"]/);
  });

  it('preserves close-to-tray behavior guarding on tray existing', () => {
    // The close handler must guard with !isQuitting && tray and call win.hide()
    expect(mainTsContent).toMatch(/win\.on\s*\(\s*['"]close['"][\s\S]*?!isQuitting\s*&&\s*tray[\s\S]*?win\.hide\(\)/);
  });

  it('toggle-maximize handles both maximize and unmaximize', () => {
    expect(mainTsContent).toMatch(/isMaximized\(\)[\s\S]*?unmaximize\(\)[\s\S]*?maximize\(\)/);
  });
});

describe('Preload Bridge Window Controls (electron/preload.ts)', () => {
  const preloadTsPath = path.resolve(__dirname, '../../electron/preload.ts');
  const preloadContent = fs.readFileSync(preloadTsPath, 'utf-8');

  it('exposes window controls on antidetect namespace in preload.ts', () => {
    expect(preloadContent).toMatch(/window:\s*\{/);
    expect(preloadContent).toMatch(/minimize:\s*\(\s*\)\s*:\s*void\s*=>\s*ipcRenderer\.send\(['"]window:minimize['"]\)/);
    expect(preloadContent).toMatch(/toggleMaximize:\s*\(\s*\)\s*:\s*void\s*=>\s*ipcRenderer\.send\(['"]window:toggle-maximize['"]\)/);
    expect(preloadContent).toMatch(/close:\s*\(\s*\)\s*:\s*void\s*=>\s*ipcRenderer\.send\(['"]window:close['"]\)/);
  });
});
