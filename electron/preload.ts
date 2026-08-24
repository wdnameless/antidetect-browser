import { contextBridge, ipcRenderer } from 'electron';

export interface UpdateInfo {
  version?: string;
  files?: Array<{ url?: string }>;
  releaseDate?: string;
  releaseNotes?: string;
}

contextBridge.exposeInMainWorld('antidetect', {
  getApiKey: (): Promise<string> => ipcRenderer.invoke('antidetect:getApiKey'),
  data: {
    getDir: (): Promise<string> => ipcRenderer.invoke('data:get-dir'),
    setDir: (): Promise<{ ok: boolean; dir: string }> => ipcRenderer.invoke('data:set-dir'),
    openDir: (): Promise<string> => ipcRenderer.invoke('data:open-dir'),
  },
  logs: {
    openDir: (): Promise<string> => ipcRenderer.invoke('logs:open-dir'),
  },
  update: {
    check: (): Promise<void> => ipcRenderer.invoke('update:check'),
    download: (): Promise<void> => ipcRenderer.invoke('update:download'),
    quitAndInstall: (): Promise<void> => ipcRenderer.invoke('update:quit-and-install'),
    onStatus: (cb: (status: UpdateStatus) => void): (() => void) => {
      const listener = (_e: Electron.IpcRendererEvent, status: UpdateStatus): void => cb(status);
      ipcRenderer.on('update:status', listener);
      return () => ipcRenderer.removeListener('update:status', listener);
    },
  },
});

export type UpdateStatus =
  | { state: 'checking' }
  | { state: 'available'; info: UpdateInfo }
  | { state: 'not-available'; info: UpdateInfo }
  | { state: 'downloading'; percent: number; bytesPerSecond: number; transferred: number; total: number }
  | { state: 'downloaded'; info: UpdateInfo }
  | { state: 'error'; message: string };
