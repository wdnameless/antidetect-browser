import { useEffect, useState } from 'react';
import { initApiKey } from './api';
import { Profiles } from './pages/Profiles';
import { Proxies } from './pages/Proxies';
import { Devices } from './pages/Devices';
import { Extensions } from './pages/Extensions';
import { Settings } from './pages/Settings';
import { Placeholder } from './pages/Placeholder';

type Page = 'profiles' | 'proxies' | 'fingerprints' | 'devices' | 'extensions' | 'settings';

const NAV: Array<{ key: Page; label: string }> = [
  { key: 'profiles', label: 'Profiles' },
  { key: 'proxies', label: 'Proxies' },
  { key: 'fingerprints', label: 'Fingerprints' },
  { key: 'devices', label: 'Devices' },
  { key: 'extensions', label: 'Extensions' },
  { key: 'settings', label: 'Settings' },
];

export function App() {
  const [ready, setReady] = useState(false);
  const [page, setPage] = useState<Page>('profiles');

  useEffect(() => {
    void initApiKey().finally(() => setReady(true));
  }, []);

  if (!ready) {
    return <div className="loading">Connecting to Local API…</div>;
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">Antidetect</div>
        <nav>
          {NAV.map((item) => (
            <button
              key={item.key}
              className={item.key === page ? 'nav-item active' : 'nav-item'}
              onClick={() => setPage(item.key)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">Local API :50325</div>
      </aside>
      <main className="content">
        {page === 'profiles' ? (
          <Profiles />
        ) : page === 'proxies' ? (
          <Proxies />
        ) : page === 'devices' ? (
          <Devices />
        ) : page === 'extensions' ? (
          <Extensions />
        ) : page === 'settings' ? (
          <Settings />
        ) : (
          <Placeholder page={page} />
        )}
      </main>
    </div>
  );
}
