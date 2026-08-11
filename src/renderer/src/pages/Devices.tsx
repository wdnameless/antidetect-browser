import { useCallback, useEffect, useState } from 'react';
import { api, type DeviceItem, type ProfileListItem } from '../api';

export function Devices() {
  const [devices, setDevices] = useState<DeviceItem[]>([]);
  const [profiles, setProfiles] = useState<ProfileListItem[]>([]);
  const [error, setError] = useState('');
  const [bindTarget, setBindTarget] = useState<{ deviceId: string; profileId: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [d, p] = await Promise.all([api.deviceList(), api.list()]);
      if (d.code === 0) setDevices(d.data.list);
      if (p.code === 0) setProfiles(p.data.list);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const bind = async () => {
    if (!bindTarget) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.profileUpdate({ user_id: bindTarget.profileId, device_id: bindTarget.deviceId });
      if (res.code !== 0) setError(res.msg);
      setBindTarget(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <header className="page-header">
        <h1>Devices</h1>
      </header>

      {error ? <div className="error">{error}</div> : null}

      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Platform</th>
            <th>Details</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {devices.length === 0 ? (
            <tr>
              <td colSpan={4} className="empty">
                No device presets.
              </td>
            </tr>
          ) : (
            devices.map((d) => (
              <tr key={d.device_id}>
                <td>{d.name}</td>
                <td>{d.platform}</td>
                <td className="mono">
                  {d.config.mobile
                    ? (() => {
                        const s = d.config.screen as { width?: number; height?: number; deviceScaleFactor?: number } | undefined;
                        return `mobile · ${s?.width ?? '?'}x${s?.height ?? '?'}@${s?.deviceScaleFactor ?? 1}x`;
                      })()
                    : `${String(d.config.platform ?? '')} ${String(d.config.platformVersion ?? '')} · ${String(d.config.hardwareConcurrency ?? '?')} cores`}
                </td>
                <td className="actions">
                  <button
                    onClick={() =>
                      setBindTarget({ deviceId: d.device_id, profileId: profiles[0]?.user_id ?? '' })
                    }
                  >
                    Bind to profile
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {bindTarget ? (
        <div className="panel">
          <div className="form-row">
            <span>Bind device to profile:</span>
            <select
              value={bindTarget.profileId}
              onChange={(e) => setBindTarget({ ...bindTarget, profileId: e.target.value })}
            >
              {profiles.map((pr) => (
                <option key={pr.user_id} value={pr.user_id}>
                  {pr.name ?? pr.user_id}
                </option>
              ))}
            </select>
            <button className="primary" onClick={() => void bind()} disabled={busy}>
              Bind
            </button>
            <button onClick={() => setBindTarget(null)}>Cancel</button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
