import { useEffect, useState, useCallback } from 'react';
import { initApiKey, api, setApiKey } from './api';
import { LoginScreen } from './LoginScreen';
import { useI18n } from './i18n';
import { PRODUCT_NAME, TAGLINE_PRIMARY } from './brand';
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
import {
  ProfilesIcon,
  FolderIcon,
  ProxiesIcon,
  DevicesIcon,
  ExtensionsIcon,
  SettingsIcon,
  ShieldIcon,
  CloudIcon,
  UsersIcon,
  KeyIcon,
  TrashIcon,
  CookieIcon,
  FlowIcon,
  CalendarIcon,
} from './icons';
type Page = 'profiles' | 'groups' | 'proxies' | 'devices' | 'extensions' | 'email' | 'teams' | 'cloud' | 'diagnostics' | 'trash' | 'scripts' | 'catalog' | 'flows' | 'settings' | 'calendar';

interface NavItem {
  key: Page;
  label: string;
  icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
}

const NAV: NavItem[] = [
  { key: 'profiles', label: 'Profiles', icon: ProfilesIcon },
  { key: 'groups', label: 'Groups', icon: FolderIcon },
  { key: 'proxies', label: 'Proxies', icon: ProxiesIcon },
  { key: 'devices', label: 'Devices', icon: DevicesIcon },
  { key: 'extensions', label: 'Extensions', icon: ExtensionsIcon },
  { key: 'email', label: 'Email', icon: ShieldIcon },
  { key: 'diagnostics', label: 'Diagnostics', icon: KeyIcon },
  { key: 'trash', label: 'Trash', icon: TrashIcon },
  { key: 'flows', label: 'Flow Canvas', icon: FlowIcon },
  { key: 'calendar', label: 'Calendar', icon: CalendarIcon },
  { key: 'catalog', label: 'Catalog', icon: CookieIcon },
  { key: 'teams', label: 'Teams', icon: UsersIcon },
  { key: 'cloud', label: 'Cloud Sync', icon: CloudIcon },
  { key: 'settings', label: 'Settings', icon: SettingsIcon },
];

export function App() {
  const { t } = useI18n();
  const [ready, setReady] = useState(false);
  const [authenticated, setAuthenticated] = useState<boolean>(false);
  const [page, setPage] = useState<Page>('profiles');
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState('personal');
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => getStoredSidebarCollapsed());
  const [runningCount, setRunningCount] = useState<number>(0);
  const [syncConnected, setSyncConnected] = useState<boolean>(false);

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
    void initApiKey().then((token) => {
      if (token) {
        initSession(token);
      } else {
        setAuthenticated(false);
        setReady(true);
      }
    });
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
  if (!ready) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: '8px', color: 'var(--text-muted)' }}>
        <div>Loading {PRODUCT_NAME}...</div>
        <div style={{ fontSize: '12px', opacity: 0.7 }}>{TAGLINE_PRIMARY}</div>
      </div>
    );
  }

  if (!authenticated) {
    return <LoginScreen onSuccess={initSession} />;
  }

  const activeNav = NAV.find((n) => n.key === page);
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
        <div>
          <div className="brand" title={`${PRODUCT_NAME} PRO`}>
            <div className="brand-icon">
              <ShieldIcon size={20} />
            </div>
            <div className="brand-title">{PRODUCT_NAME}</div>
            <span className="brand-version">PRO</span>
          </div>

          <nav className="nav" aria-label="Main navigation">
            {NAV.map((item) => {
              const Icon = item.icon;
              const active = item.key === page;
              const isProfiles = item.key === 'profiles';
              const isCloud = item.key === 'cloud';
              const itemLabel = t(item.label);

              return (
                <button
                  key={item.key}
                  type="button"
                  className={`nav-item ${active ? 'active' : ''}`}
                  data-tooltip={itemLabel}
                  aria-label={itemLabel}
                  title={sidebarCollapsed ? itemLabel : undefined}
                  onClick={() => {
                    if (item.key !== 'profiles') setSelectedGroupId(null);
                    setPage(item.key);
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
          </nav>

          <div className="workspace-switcher-wrapper">
            <WorkspaceSwitcher active={workspace} onChange={changeWorkspace} />
          </div>
        </div>

        <div className="sidebar-footer">
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
        <header className="topbar">
          <h2 className="page-title">{activeNav ? t(activeNav.label) : 'Dashboard'}</h2>
        </header>

        <main className="content">
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
