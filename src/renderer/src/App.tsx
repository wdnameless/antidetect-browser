import { useEffect, useState } from 'react';
import { initApiKey } from './api';
import { Profiles } from './pages/Profiles';
import { Proxies } from './pages/Proxies';
import { Devices } from './pages/Devices';
import { Extensions } from './pages/Extensions';
import { Settings } from './pages/Settings';
import {
  ProfilesIcon,
  ProxiesIcon,
  DevicesIcon,
  ExtensionsIcon,
  SettingsIcon,
  ShieldIcon,
} from './icons';

type Page = 'profiles' | 'proxies' | 'devices' | 'extensions' | 'settings';

interface NavItem {
  key: Page;
  label: string;
  icon: (props: { size?: number }) => JSX.Element;
}

const NAV: NavItem[] = [
  { key: 'profiles', label: 'Profiles', icon: ProfilesIcon },
  { key: 'proxies', label: 'Proxies', icon: ProxiesIcon },
  { key: 'devices', label: 'Devices', icon: DevicesIcon },
  { key: 'extensions', label: 'Extensions', icon: ExtensionsIcon },
  { key: 'settings', label: 'Settings', icon: SettingsIcon },
];

export function App() {
  const [page, setPage] = useState<Page>('profiles');
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
          <nav>
            {NAV.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.key}
                  className={`nav-item ${page === item.key ? 'active' : ''}`}
                  onClick={() => setPage(item.key)}
                >
                  <Icon size={17} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="sidebar-footer">
          <div className="api-status-pill">
            <div className="status-dot" />
            <span>Local API :50325 • Online</span>
          </div>
        </div>
      </aside>

      <div className="main-wrapper">
        <header className="topbar">
          <h2 className="page-title">{activeNav?.label || 'Dashboard'}</h2>
        </header>

        <main className="content">
          {page === 'profiles' ? (
            <Profiles />
          ) : page === 'proxies' ? (
            <Proxies />
          ) : page === 'devices' ? (
            <Devices />
          ) : page === 'extensions' ? (
            <Extensions />
          ) : (
            <Settings />
          )}
        </main>
      </div>
    </div>
  );
}
