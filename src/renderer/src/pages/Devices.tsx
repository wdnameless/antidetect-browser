import { useEffect, useState } from 'react';
import { api, type DeviceItem } from '../api';
import { DevicesIcon } from '../icons';

export function Devices() {
  const [devices, setDevices] = useState<DeviceItem[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    void api.deviceList().then((res) => {
      if (res.code === 0) setDevices(res.data.list);
      else setError(res.msg);
    }).catch((err) => setError((err as Error).message));
  }, []);

  return (
    <div>
      <div className="page-header-actions">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <DevicesIcon size={20} style={{ color: 'var(--accent)' }} />
          <h2 style={{ fontSize: 16, fontWeight: 700 }}>Device &amp; OS Presets</h2>
        </div>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}

      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: '22%' }}>Preset Name</th>
              <th style={{ width: '18%' }}>Platform</th>
              <th style={{ width: '60%' }}>Configuration Details</th>
            </tr>
          </thead>
          <tbody>
            {devices.map((d) => (
              <tr key={d.device_id}>
                <td>
                  <strong style={{ fontSize: 13.5 }}>{d.name}</strong>
                </td>
                <td>
                  <span className="proxy-type-badge" style={{ color: d.platform === 'ios' || d.platform === 'android' ? 'var(--ok)' : 'var(--accent)' }}>
                    {d.platform.toUpperCase()}
                  </span>
                </td>
                <td>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {Object.entries(d.config || {}).map(([k, v]) => (
                      <span
                        key={k}
                        style={{
                          background: 'var(--panel-2)',
                          padding: '2px 8px',
                          borderRadius: 4,
                          fontSize: 11.5,
                          color: 'var(--text-secondary)',
                          fontFamily: typeof v === 'number' || typeof v === 'boolean' ? 'var(--font-mono)' : 'inherit',
                        }}
                      >
                        <strong style={{ color: 'var(--text-muted)' }}>{k}:</strong> {String(typeof v === 'object' ? JSON.stringify(v) : v)}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
