import { useEffect, useState } from 'react';
import { api, type DeviceItem } from '../api';
import { DevicesIcon } from '../icons';

export function Devices() {
  const [devices, setDevices] = useState<DeviceItem[]>([]);
  const [mobilePresets, setMobilePresets] = useState<Array<{ id: string; name: string; model: string; androidVersion: string; gpu: string }>>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    void Promise.all([api.deviceList(), api.mobilePresets()])
      .then(([dRes, mRes]) => {
        if (dRes.code === 0) setDevices(dRes.data.list);
        else setError(dRes.msg);
        if (mRes.code === 0) setMobilePresets(mRes.data.list);
      })
      .catch((err) => setError((err as Error).message));
  }, []);

  const getPlatformIcon = (platform: string) => {
    switch (platform) {
      case 'windows':
        return '💻';
      case 'macos':
        return '🍎';
      case 'android':
        return '📱';
      case 'ios':
        return '📱';
      case 'linux':
        return '🐧';
      default:
        return '🖥️';
    }
  };

  return (
    <div>
      <div className="page-header-actions">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <DevicesIcon size={22} style={{ color: 'var(--accent)' }} />
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 700 }}>Device &amp; Hardware Presets</h2>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
              Built-in device profiles and mobile phone pools for realistic hardware fingerprint spoofing.
            </p>
          </div>
        </div>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}

      {/* Main OS & Platform Presets */}
      <div style={{ marginBottom: 24 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: 'var(--text)' }}>
          Platform Presets
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {devices.map((d) => {
            const isMobile = d.config.mobile === true;
            return (
              <div
                key={d.device_id}
                className="panel"
                style={{
                  padding: '16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  border: '1px solid var(--border)',
                  background: 'var(--panel)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 20 }}>{getPlatformIcon(d.platform)}</span>
                    <strong style={{ fontSize: 14, color: 'var(--text)' }}>{d.name}</strong>
                  </div>
                  <span className={`badge ${isMobile ? 'badge-blue' : 'badge-gray'}`} style={{ textTransform: 'uppercase', fontSize: 10 }}>
                    {d.platform}
                  </span>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                  <span className="badge badge-gray" style={{ fontSize: 11 }}>
                    {isMobile ? 'Touch Enabled' : 'Mouse & Keyboard'}
                  </span>
                  {d.config.screen && typeof d.config.screen === 'object' ? (
                    <span className="badge badge-gray" style={{ fontSize: 11 }}>
                      📐 {(d.config.screen as { width: number; height: number }).width}×{(d.config.screen as { width: number; height: number }).height}
                    </span>
                  ) : null}
                  {d.config.mobile ? (
                    <span className="badge badge-blue" style={{ fontSize: 11 }}>
                      📲 30 Phone Pool
                    </span>
                  ) : (
                    <span className="badge badge-gray" style={{ fontSize: 11 }}>
                      🖥 Desktop Resolution
                    </span>
                  )}
                </div>

                <div style={{ fontSize: 11.5, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: 4 }}>
                  ID: {d.device_id}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Android Mobile Models Pool */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
              Android Smartphone Pool ({mobilePresets.length} Models)
            </h3>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
              When creating an Android profile, one of these models is deterministically attached to the fingerprint seed or fixed manually.
            </p>
          </div>
        </div>

        <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 40 }}>#</th>
                <th>Phone Model</th>
                <th style={{ width: 140 }}>Android Version</th>
                <th>GPU &amp; WebGL Renderer</th>
                <th style={{ width: 160 }}>Preset ID</th>
              </tr>
            </thead>
            <tbody>
              {mobilePresets.map((m, idx) => (
                <tr key={m.id}>
                  <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{idx + 1}</td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span>📱</span>
                      <div>
                        <strong style={{ fontSize: 13, color: 'var(--text)' }}>{m.name}</strong>
                        <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Model: {m.model}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className="badge badge-blue" style={{ fontSize: 11 }}>
                      Android {m.androidVersion}
                    </span>
                  </td>
                  <td>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{m.gpu}</span>
                  </td>
                  <td>
                    <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                      {m.id}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
