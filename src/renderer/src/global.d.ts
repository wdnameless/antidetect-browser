export {};

export type UpdateStatus =
  | { state: 'checking' }
  | { state: 'available'; info: UpdateInfo }
  | { state: 'not-available'; info: UpdateInfo }
  | { state: 'downloading'; percent: number; bytesPerSecond: number; transferred: number; total: number }
  | { state: 'downloaded'; info: UpdateInfo }
  | { state: 'error'; message: string };

export interface UpdateInfo {
  version?: string;
  files?: Array<{ url?: string }>;
  releaseDate?: string;
  releaseNotes?: string;
}

declare global {
  interface Window {
    antidetect?: {
      getApiKey: () => Promise<string>;
      data: {
        getDir: () => Promise<string>;
        setDir: () => Promise<{ ok: boolean; dir: string }>;
        prepareDir: () => Promise<{ ok: boolean; dir: string }>;
        migrateDir: (target: string, migrateData: boolean) => Promise<{ ok: boolean; dir: string; migrated?: boolean; error?: string }>;
        setDirPath: (dir: string) => Promise<{ ok: boolean; dir: string }>;
        openDir: () => Promise<string>;
      };
      logs?: {
        openDir: () => Promise<string>;
      };
      update: {
        check: () => Promise<void>;
        download: () => Promise<void>;
        quitAndInstall: () => Promise<void>;
        onStatus: (cb: (status: UpdateStatus) => void) => () => void;
      };
      /**
       * Frameless window controls. Present only in the Electron shell — a browser
       * client has no such bridge, so the renderer must detect it before rendering
       * any control rather than showing dead buttons.
       */
      window?: {
        minimize: () => void;
        toggleMaximize: () => void;
        close: () => void;
      };
    };
  }
}
