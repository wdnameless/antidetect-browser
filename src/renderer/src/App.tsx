import { useEffect, useRef, useState, useCallback } from 'react';
import { initApiKey, api, setApiKey } from './api';
import { LoginScreen } from './LoginScreen';
import { FirstRunDataDir } from './FirstRunDataDir';
import { useI18n } from './i18n';
import { PRODUCT_NAME, TAGLINE_PRIMARY } from './brand';
import {
  normalizeUpdateStatus,
  nextUpdateAction,
  presentUpdate,
  updateActionKey,
} from './updateStatus';
import type { UpdateStatus, UpdateStatusEventPayload } from './global';
import {
  SIDEBAR_COLLAPSED_KEY,
  getStoredSidebarCollapsed,
  persistSidebarCollapsed,
  computeRunningCount,
  isToggleShortcut
} from './sidebarLogic';
import { Profiles } from './pages/Profiles';
import { Groups } from './pages/Groups';
import { Calendar } from './pages/Calendar';
import { Proxies } from './pages/Proxies';
import { Devices } from './pages/Devices';
import { Extensions } from './pages/Extensions';
import { Settings } from './pages/Settings';
import { CloudSync } from './pages/CloudSync';
import { Teams } from './pages/Teams';
import { Diagnostics } from './pages/Diagnostics';
import { Trash } from './pages/Trash';
import { Scripts } from './pages/Scripts';
import { Catalog } from './pages/Catalog';
import { FlowCanvas } from './pages/FlowCanvas';
import { Email } from './pages/Email';
import { WorkspaceSwitcher } from './components/WorkspaceSwitcher';
import { AutomationPanel } from './components/AutomationPanel';
import {
  ProfilesIcon,
  FolderIcon,
  ProxiesIcon,
  DevicesIcon,
  ExtensionsIcon,
  SettingsIcon,
  BrandMark,
  CloudIcon,
  UsersIcon,
  KeyIcon,
  TrashIcon,
  CookieIcon,
  FlowIcon,
  CalendarIcon,
} from './icons';
type Page =
  | 'profiles'
  | 'groups'
  | 'proxies'
  | 'devices'
  | 'extensions'
  | 'email'
  | 'teams'
  | 'cloud'
  | 'diagnostics'
  | 'trash'
  | 'scripts'
  | 'catalog'
  | 'flows'
  | 'settings'
  | 'calendar';

export interface SubTab {
  key: Page;
  label: string;
}

export interface NavDestination {
  key: Page;
  label: string;
  icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
  group?: 'WORKSPACE' | 'LIBRARY' | 'SYSTEM';
  subTabs?: SubTab[];
}

/**
 * Sidebar grouping, mirroring the ShardX reference: one flat list divided by small
 * all-caps labels rather than nested collapsible sections. Order here is the render order.
 */
export const NAV_GROUPS: Array<{ id: string; label: string }> = [
  { id: 'WORKSPACE', label: 'WORKSPACE' },
  { id: 'LIBRARY', label: 'LIBRARY' },
  { id: 'SYSTEM', label: 'SYSTEM' },
];

export const NAV_DESTINATIONS: NavDestination[] = [
  // WORKSPACE
  {
    key: 'profiles',
    label: 'Profiles',
    icon: ProfilesIcon,
    group: 'WORKSPACE',
    subTabs: [
      { key: 'profiles', label: 'Profiles' },
      { key: 'groups', label: 'Groups' },
      { key: 'trash', label: 'Trash' },
    ],
  },
  {
    key: 'proxies',
    label: 'Proxies',
    icon: ProxiesIcon,
    group: 'WORKSPACE',
  },
  {
    key: 'flows',
    label: 'Automation',
    icon: FlowIcon,
    group: 'WORKSPACE',
    subTabs: [
      { key: 'flows', label: 'Flow Canvas' },
      { key: 'scripts', label: 'Scripts' },
    ],
  },
  // LIBRARY
  {
    key: 'devices',
    label: 'Fingerprints',
    icon: DevicesIcon,
    group: 'LIBRARY',
    subTabs: [
      { key: 'devices', label: 'Devices' },
      { key: 'extensions', label: 'Extensions' },
    ],
  },
  {
    key: 'email',
    label: 'Library',
    icon: CookieIcon,
    group: 'LIBRARY',
    subTabs: [
      { key: 'email', label: 'Email' },
      { key: 'calendar', label: 'Calendar' },
      { key: 'catalog', label: 'Catalog' },
    ],
  },
  // SYSTEM
  {
    key: 'cloud',
    label: 'Cloud',
    icon: CloudIcon,
    group: 'SYSTEM',
    subTabs: [
      { key: 'cloud', label: 'Cloud Sync' },
      { key: 'teams', label: 'Teams' },
    ],
  },
  {
    key: 'settings',
    label: 'Settings',
    icon: SettingsIcon,
    group: 'SYSTEM',
    subTabs: [
      { key: 'settings', label: 'Settings' },
      { key: 'diagnostics', label: 'Diagnostics' },
    ],
  },
];

function getActiveDestination(currentPage: Page): NavDestination {
  const dest = NAV_DESTINATIONS.find(
    (d) => d.key === currentPage || d.subTabs?.some((st) => st.key === currentPage)
  );
  return dest || NAV_DESTINATIONS[0];
}

export function App() {
  const { t } = useI18n();
  // The frameless window controls belong to the Electron shell. A browser client
  // has no bridge, so we detect it once rather than rendering dead buttons.
  const hasNativeWindow = typeof window !== 'undefined' && Boolean(window.antidetect?.window);
  const [ready, setReady] = useState(false);
  const [authenticated, setAuthenticated] = useState<boolean>(false);
  const [firstRunDir, setFirstRunDir] = useState<string | null>(null);
  const [page, setPage] = useState<Page>('profiles');
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState('personal');
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => getStoredSidebarCollapsed());
  const [runningCount, setRunningCount] = useState<number>(0);
  const [syncConnected, setSyncConnected] = useState<boolean>(false);
  const activeDest = getActiveDestination(page);
  const [kernelUpdateState, setKernelUpdateState] = useState<UpdateStatus | null>(null);
  /**
   * Whether the operator has asked for the update, which is what authorises the flow to run to
   * completion without further clicks. Set by the footer control; never set by an automatic
   * check, so a background check can never start a download behind the operator's back.
   */
  const [updateFlowActive, setUpdateFlowActive] = useState<boolean>(false);
  // Reported by the backend, not hardcoded: the footer used to claim "v0.6.0" while the
  // service answered "0.0.1" to /status, so neither number could be trusted after a bump.
  const [appVersion, setAppVersion] = useState<string>('');
  const [hasRunUpdateCheck, setHasRunUpdateCheck] = useState<boolean>(false);

  useEffect(() => {
    api.status()
      .then((res) => {
        const v = res.data?.version;
        if (typeof v === 'string' && v.length > 0 && v !== 'unknown') setAppVersion(v);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    // The shell emits `update:status` with a payload shaped { state, message, info, progress }
    // (see UpdateStatusEvent in src-tauri/src/updater.rs). The translation to the UI's own
    // vocabulary lives in `updateStatus.ts` because `Settings.tsx` renders the same states and
    // the two had drifted: this listener dropped `download-progress`, so progress could never
    // appear, and Settings switched on strings the shell never sends at all.
    const apiObj = window.antidetect as (typeof window.antidetect & {
      onUpdateStatus?: (cb: (s: UpdateStatusEventPayload) => void) => () => void;
    }) | undefined;
    const unsub = apiObj?.onUpdateStatus?.((s) => {
      setHasRunUpdateCheck(true);
      setKernelUpdateState(normalizeUpdateStatus(s));
    });
    return () => unsub?.();
  }, []);

  /**
   * Drive the whole update from the footer control: check → download → install.
   *
   * The pill used to call only `update.check()`, so it reported "Update available" and stopped —
   * `download()` and `quitAndInstall()` existed only behind buttons in Settings, which is not
   * where an operator looks when they wonder whether they are current. Clicking the control is
   * the consent; from there the flow runs to completion on its own.
   *
   * Only the most recent dispatch is remembered: StrictMode re-runs effects on the same state,
   * and the shell re-emits `download-progress` many times per second, so an unguarded effect
   * would fetch the artefact twice and then try to install it twice. A new offer carries a new
   * version, which changes the key and makes the flow actionable again.
   */
  const lastDispatchRef = useRef<string>('');
  useEffect(() => {
    if (!updateFlowActive) return;
    const action = nextUpdateAction(kernelUpdateState);
    if (!action) return;
    const key = updateActionKey(action, kernelUpdateState);
    if (lastDispatchRef.current === key) return;
    lastDispatchRef.current = key;

    const apiObj = window.antidetect as (typeof window.antidetect & {
      update?: { download?: () => Promise<void>; quitAndInstall?: () => Promise<void> };
    }) | undefined;
    if (action === 'download') {
      void apiObj?.update?.download?.();
    } else {
      void apiObj?.update?.quitAndInstall?.();
    }
  }, [updateFlowActive, kernelUpdateState]);


  const openDocs = (e: React.MouseEvent) => {
    e.preventDefault();
    const url = 'https://github.com/wdnameless/antidetect-browser/tree/main/docs';
    const apiObj = window.antidetect as (typeof window.antidetect & {
      openExternal?: (u: string) => void;
    }) | undefined;
    if (apiObj?.openExternal) {
      apiObj.openExternal(url);
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  const initSession = useCallback((token: string) => {
    setApiKey(token);
    setAuthenticated(true);
    api.teamsList()
      .then((res) => {
        if (res.code === 0 && res.data.active_workspace) setWorkspace(res.data.active_workspace);
      })
      .catch(() => undefined);
    setReady(true);
  }, []);

  useEffect(() => {
    // ISSUE 1: Local use is unauthenticated by design.
    // The credential gate exists for cloud sync / remote panel access.
    // Query the panel auth-state: if no password is configured (hasPassword === false),
    // do not gate behind LoginScreen. If hasPassword === true, credentials are required.
    let mounted = true;
    async function startupAuth() {
      let hasPassword = false;
      try {
        const authRes = await api.authState();
        if (authRes?.code === 0 && authRes.data) {
          hasPassword = Boolean(authRes.data.hasPassword);
        }
      } catch {
        // If the backend or endpoint is unreachable, fall back to checking if token exists
      }

      const token = await initApiKey();
      if (!mounted) return;

      /**
       * Ask whether the data location has ever been chosen, before anything else runs.
       *
       * This sits ahead of the credential gate on purpose: the folder decides where the
       * profiles, kernel and even the login database live, so asking it after the operator
       * has signed in (or created a password) would be asking about data that already exists.
       * A failed check must NOT block startup — an unreachable endpoint is not a reason to
       * hide the app; the operator can still set the folder later in Settings.
       */
      try {
        const fr = await api.firstRunData();
        if (!mounted) return;
        if (fr.data?.needed) {
          setFirstRunDir(fr.data.defaultDir ?? '');
          setReady(true);
          return;
        }
      } catch {
        // Endpoint unavailable or key not yet accepted: fall through to normal startup.
      }

      if (token) {
        initSession(token);
      } else if (!hasPassword) {
        // Local instance with no configured credentials:
        // Allow entry directly without blocking on login screen.
        initSession('');
      } else {
        // Credentials configured: strictly enforce LoginScreen gate
        setAuthenticated(false);
        setReady(true);
      }
    }
    void startupAuth();
    return () => {
      mounted = false;
    };
  }, [initSession]);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      persistSidebarCollapsed(next);
      return next;
    });
  }, []);

  // Keyboard shortcut Ctrl/Cmd+B
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isToggleShortcut(e)) {
        e.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleSidebar]);

  // Fetch running profiles count & sync status
  useEffect(() => {
    if (!ready) return;
    api.list()
      .then((res) => {
        const list = res.data?.list;
        if (Array.isArray(list)) {
          setRunningCount(computeRunningCount(list));
        }
      })
      .catch(() => undefined);

    api.syncStatus()
      .then((res) => {
        if (res.data?.connected) setSyncConnected(true);
      })
      .catch(() => undefined);
  }, [ready, page]);

  const changeWorkspace = (ws: string) => {
    setWorkspace(ws);
    void api.workspaceSetActive(ws).catch(() => undefined);
  };

  // Footer version line. The state → text mapping lives in `updateStatus.ts` so the footer and
  // Settings cannot drift apart again (they had: the footer dropped `download-progress`, and
  // Settings switched on strings the shell never sent, leaving its panel empty).
  const updateView = presentUpdate(kernelUpdateState, hasRunUpdateCheck);
  const updateTitle = t(updateView.titleKey);
  const updateLabel =
    updateView.percent !== null
      ? `${t(updateView.labelKey)} ${updateView.percent}%`
      : t(updateView.labelKey);

  if (!ready) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: '8px', color: 'var(--text-muted)' }}>
        <div>Loading {PRODUCT_NAME}...</div>
        <div style={{ fontSize: '12px', opacity: 0.7 }}>{TAGLINE_PRIMARY}</div>
      </div>
    );
  }

  if (firstRunDir !== null) {
    return (
      <FirstRunDataDir
        defaultDir={firstRunDir}
        onDone={() => {
          /**
           * The location is recorded, but the backend resolved `DATA_DIR` when it started,
           * so it only takes effect on the next launch. Restart rather than leaving the
           * operator in an app whose data still lives in the folder they just moved away
           * from — the shell re-executes and the sidecar is torn down through the normal
           * exit path (graceful shutdown, then kill), so nothing is orphaned.
           */
          void window.antidetect?.data?.restart?.();
          setFirstRunDir(null);
        }}
      />
    );
  }

  if (!authenticated) {
    return <LoginScreen onSuccess={initSession} />;
  }

  const activeNav = NAV_DESTINATIONS.find((n) => n.key === page);
  const handleSelectGroupAndGoToProfiles = (groupId: string) => {
    setSelectedGroupId(groupId);
    setPage('profiles');
  };

  return (
    <div className="app">
      <aside
        className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}
        aria-label="Navigation sidebar"
      >
        <div className="sidebar-content">
          <div className="brand" title={`${PRODUCT_NAME} PRO`}>
            <div className="brand-icon">
              <BrandMark size={20} />
            </div>
            <div className="brand-title">{PRODUCT_NAME}</div>
            <span className="brand-version">PRO</span>
          </div>

          <nav className="nav" aria-label="Main navigation">
            {NAV_GROUPS.map((group) => {
              const groupItems = NAV_DESTINATIONS.filter((d) => d.group === group.id);
              if (groupItems.length === 0) return null;
              return (
                <div key={group.id} className="nav-group">
                  <div className="nav-group-label">{t(group.label)}</div>
                  <div className="nav-group-items">
                    {groupItems.map((dest) => {
                      const Icon = dest.icon;
                      const isDestActive =
                        page === dest.key || dest.subTabs?.some((st) => st.key === page);
                      const isProfiles = dest.key === 'profiles';
                      const isCloud = dest.key === 'cloud';
                      const itemLabel = t(dest.label);

                      return (
                        <button
                          key={dest.key}
                          type="button"
                          className={`nav-item ${isDestActive ? 'active' : ''}`}
                          data-tooltip={itemLabel}
                          aria-label={itemLabel}
                          title={sidebarCollapsed ? itemLabel : undefined}
                          onClick={() => {
                            if (dest.key !== 'profiles') setSelectedGroupId(null);
                            setPage(dest.key);
                          }}
                        >
                          <div className="nav-item-icon-wrapper">
                            <Icon size={16} />
                            {isCloud && syncConnected && <span className="sync-dot" title="Cloud connected" />}
                            {isProfiles && runningCount > 0 && sidebarCollapsed && (
                              <span className="nav-badge" title={`${runningCount} ${t('running')}`}>
                                {runningCount}
                              </span>
                            )}
                          </div>
                          <span className="nav-label">{itemLabel}</span>
                          {isProfiles && runningCount > 0 && !sidebarCollapsed && (
                            <span className="nav-badge">{runningCount}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </nav>

          <div className="workspace-switcher-wrapper">
            <WorkspaceSwitcher active={workspace} onChange={changeWorkspace} />
          </div>
        </div>

        <div className="sidebar-footer">
          <AutomationPanel />
          {!sidebarCollapsed && (
            /*
             * The version line is the update control.
             *
             * It used to be a passive label reading "Not checked", then a check-only button:
             * clicking it reported "Update available" and stopped, because `download()` and
             * `quitAndInstall()` lived only behind buttons in Settings. Clicking here now
             * authorises the whole flow — check → download → install → relaunch — and the
             * effect above advances each step as the shell reports it. A state that cannot
             * proceed (up to date, error) simply stops there and says so.
             *
             * Rendered as a button, not a div with onClick, so it is keyboard reachable and
             * announced as interactive.
             */
            <button
              type="button"
              className="sidebar-version"
              data-testid="check-updates"
              title={updateTitle}
              aria-label={t('Check for updates')}
              onClick={() => {
                const apiObj = window.antidetect as (typeof window.antidetect & {
                  update?: { check?: () => Promise<void> };
                }) | undefined;
                if (!apiObj?.update?.check) {
                  // No shell bridge (a browser-served client): say so rather than appearing
                  // to do nothing.
                  setHasRunUpdateCheck(true);
                  setUpdateFlowActive(false);
                  setKernelUpdateState({
                    state: 'error',
                    message: 'Updates are only available in the desktop application.',
                  });
                  return;
                }
                setHasRunUpdateCheck(true);
                setUpdateFlowActive(true);
                setKernelUpdateState({ state: 'checking' });
                void apiObj.update.check();
              }}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                textAlign: 'left',
                width: '100%',
                font: 'inherit',
                color: 'inherit',
              }}
            >
              <strong style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>
                {appVersion ? `${PRODUCT_NAME} v${appVersion}` : PRODUCT_NAME}
              </strong>
              <div style={{ marginTop: 2 }}>{updateLabel}</div>
            </button>
          )}

          <button
            type="button"
            className="sidebar-toggle-btn"
            onClick={toggleSidebar}
            title={t('Toggle sidebar (Ctrl+B)')}
            aria-label={sidebarCollapsed ? t('Expand sidebar') : t('Collapse sidebar')}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {sidebarCollapsed ? (
                /* Arrow pointing right to expand */
                <polyline points="9 18 15 12 9 6" />
              ) : (
                /* Arrow pointing left to collapse */
                <polyline points="15 18 9 12 15 6" />
              )}
            </svg>
          </button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar" data-tauri-drag-region="">
          <h2 className="page-title">{activeNav ? t(activeNav.label) : 'Dashboard'}</h2>
          {hasNativeWindow ? (
            <div className="window-controls">
              <button
                type="button"
                className="window-control"
                onClick={() => window.antidetect?.window?.minimize()}
                aria-label={t('Minimize')}
                title={t('Minimize')}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                  <path d="M0 5h10" stroke="currentColor" strokeWidth="1" />
                </svg>
              </button>
              <button
                type="button"
                className="window-control"
                onClick={() => window.antidetect?.window?.toggleMaximize()}
                aria-label={t('Maximize')}
                title={t('Maximize')}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                  <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" />
                </svg>
              </button>
              <button
                type="button"
                className="window-control window-control-close"
                onClick={() => window.antidetect?.window?.close()}
                aria-label={t('Close')}
                title={t('Close')}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                  <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth="1" />
                </svg>
              </button>
            </div>
          ) : null}
        </header>

        <main className="content">
          {activeDest.subTabs && activeDest.subTabs.length > 0 ? (
            <nav
              className="subtabs"
              aria-label="Sub navigation"
              style={{
                display: 'flex',
                gap: 'var(--space-1)',
                borderBottom: '1px solid var(--border)',
                paddingBottom: 'var(--space-2)',
                marginBottom: 'var(--space-4)',
              }}
            >
              {activeDest.subTabs.map((st) => {
                const isTabActive = page === st.key;
                return (
                  <button
                    key={st.key}
                    type="button"
                    className={`btn ${isTabActive ? 'btn-primary' : 'btn-ghost'}`}
                    style={{
                      height: 'var(--control-h-sm)',
                      fontSize: 'var(--text-sm)',
                      padding: '0 var(--space-3)',
                    }}
                    onClick={() => {
                      if (st.key !== 'profiles') setSelectedGroupId(null);
                      setPage(st.key);
                    }}
                  >
                    {t(st.label)}
                  </button>
                );
              })}
            </nav>
          ) : null}
          {page === 'profiles' ? (
            <Profiles initialGroupId={selectedGroupId} />
          ) : page === 'groups' ? (
            <Groups onSelectGroup={handleSelectGroupAndGoToProfiles} />
          ) : page === 'proxies' ? (
            <Proxies />
          ) : page === 'devices' ? (
            <Devices />
          ) : page === 'extensions' ? (
            <Extensions />
          ) : page === 'email' ? (
            <Email />
          ) : page === 'diagnostics' ? (
            <Diagnostics />
          ) : page === 'trash' ? (
            <Trash />
          ) : page === 'scripts' ? (
            <Scripts />
          ) : page === 'catalog' ? (
            <Catalog />
          ) : page === 'teams' ? (
            <Teams />
          ) : page === 'cloud' ? (
            <CloudSync />
          ) : page === 'flows' ? (
            <FlowCanvas />
          ) : page === 'calendar' ? (
            <Calendar />
          ) : (
            <Settings />
          )}
        </main>
      </div>
    </div>
  );
}
