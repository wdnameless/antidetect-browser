export { AntidetectClient } from './client.js';
export { ApiError } from './errors.js';
export {
  ensureEngine,
  getDefaultEngineDir,
  PINNED_KERNEL_VERSION,
  KERNEL_RELEASE_TAG,
  KERNEL_REPO,
  PINNED_KERNEL_ASSETS,
  EngineAcquireError,
} from './engine.js';
export type { EnsureEngineOptions, KernelAssetInfo } from './engine.js';
export {
  launchStandaloneProfile,
  buildStandaloneArgs,
  waitForDevToolsActivePort,
} from './standalone.js';
export type {
  StandaloneFingerprintConfig,
  StandaloneLaunchConfig,
  StandaloneProfileInstance,
} from './standalone.js';
export type {
  ClientConfig,
  ApiResponse,
  BrowserStartData,
  ProfileItem,
  ProfileListFilter,
  ProfileListResult,
  CreateProfileParams,
  UpdateProfileParams,
  TemporaryProfileParams,
  ProxyItem,
  CreateProxyParams,
  UpdateProxyParams,
  ProxyCheckResult,
  DiagnosticReport,
} from './types.js';
