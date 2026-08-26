import { useEffect, useState } from 'react';
import { initApiKey } from './api';
import { useI18n } from './i18n';
import { Profiles } from './pages/Profiles';
import { Groups } from './pages/Groups';
import { Proxies } from './pages/Proxies';
import { Devices } from './pages/Devices';
import { Extensions } from './pages/Extensions';
import { Settings } from './pages/Settings';
import { CloudSync } from './pages/CloudSync';
import {
  ProfilesIcon,
  FolderIcon,
  ProxiesIcon,
  DevicesIcon,
  ExtensionsIcon,
  SettingsIcon,
  ShieldIcon,
  CloudIcon,
} from './icons';

type Page = 'profiles' | 'groups' | 'proxies' | 'devices' | 'extensions' | 'cloud' | 'settings';

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
  { key: 'cloud', label: 'Cloud Sync', icon: CloudIcon },
  { key: 'settings', label: 'Settings', icon: SettingsIcon },
];

export function App() {
  const { t } = useI18n();
  const [page, setPage] = useState<Page>('profiles');
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void initApiKey().then(() => setReady(true));
  }, []);

  if (!ready) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--text-muted)' }}>
        Loading Antidetect...
      </div>
    );
  }

  const activeNav = NAV.find((n) => n.key === page);
  const handleSelectGroupAndGoToProfiles = (groupId: string) => {
    setSelectedGroupId(groupId);
    setPage('profiles');
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <div>
          <div className="brand">
            <div className="brand-icon">
              <ShieldIcon size={20} />
            </div>
            <div className="brand-title">Antidetect</div>
            <span className="brand-version">PRO</span>
          </div>

          <nav className="nav">
            {NAV.map((item) => {
              const Icon = item.icon;
              const active = item.key === page;
              return (
                <button
                  key={item.key}
                  type="button"
                  className={`nav-item ${active ? 'active' : ''}`}
                  onClick={() => {
                    if (item.key !== 'profiles') setSelectedGroupId(null);
                    setPage(item.key);
                  }}
                >
                  <Icon size={16} />
                  <span>{t(item.label)}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="sidebar-footer">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--text-muted)' }}>
            <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)' }} />
            <span>Local Core: 127.0.0.1</span>
          </div>
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
          ) : page === 'cloud' ? (
            <CloudSync />
          ) : (
            <Settings />
          )}
        </main>
      </div>
    </div>
  );
}
