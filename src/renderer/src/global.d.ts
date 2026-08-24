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
    };
  }
}
