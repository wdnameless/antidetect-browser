import { useEffect, useState } from 'react';
import { api, type DeviceItem, type ProfileListItem } from '../api';
import { DevicesIcon, CopyIcon, CheckIcon, SearchIcon } from '../icons';
import { useI18n } from '../i18n';

export function Devices() {
  const { t } = useI18n();
  const [devices, setDevices] = useState<DeviceItem[]>([]);
  const [profiles, setProfiles] = useState<ProfileListItem[]>([]);
  const [mobilePresets, setMobilePresets] = useState<Array<{ id: string; name: string; model: string; androidVersion: string; gpu: string }>>([]);
  const [error, setError] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [phoneSearch, setPhoneSearch] = useState('');
  // Apply-to-profile flow: 'preset' binds device_id; 'phone' binds device_id=dev_android + mobile_model_id
  const [applyTarget, setApplyTarget] = useState<{ kind: 'preset' | 'phone'; id: string; label: string } | null>(null);
  const [applyProfileId, setApplyProfileId] = useState('');
  const [applyBusy, setApplyBusy] = useState(false);
  const [applyMsg, setApplyMsg] = useState('');

  useEffect(() => {
    void Promise.all([api.deviceList(), api.mobilePresets(), api.list()])
      .then(([dRes, mRes, pRes]) => {
        if (dRes.code === 0) setDevices(dRes.data.list);
        else setError(dRes.msg);
        if (mRes.code === 0) setMobilePresets(mRes.data.list);
        if (pRes.code === 0) setProfiles(pRes.data.list);
      })
      .catch((err) => setError((err as Error).message));
  }, []);

  const copyId = (id: string): void => {
    void navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const applyToProfile = async (): Promise<void> => {
    if (!applyTarget || !applyProfileId) return;
    setApplyBusy(true);
    setApplyMsg('');
    try {
      const body =
        applyTarget.kind === 'preset'
          ? { user_id: applyProfileId, device_id: applyTarget.id }
          : { user_id: applyProfileId, device_id: 'dev_android', mobile_model_id: applyTarget.id };
      const res = await api.profileUpdate(body);
      if (res.code === 0) {
        setApplyMsg('');
        setApplyTarget(null);
        setApplyProfileId('');
      } else {
        setApplyMsg(res.msg);
      }
    } catch (err) {
      setApplyMsg((err as Error).message);
    } finally {
      setApplyBusy(false);
    }
  };

  const filteredPhones = mobilePresets.filter((m) => {
    if (!phoneSearch.trim()) return true;
    const q = phoneSearch.toLowerCase();
    return m.name.toLowerCase().includes(q) || m.model.toLowerCase().includes(q) || m.id.toLowerCase().includes(q);
  });

  return (
    <div>
      <div className="page-header-actions">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <DevicesIcon size={22} style={{ color: 'var(--text-secondary)' }} />
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 700 }}>{t('Device & Hardware Presets')}</h2>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
              {t('Built-in device profiles and mobile phone pools for realistic hardware fingerprint spoofing.')}
            </p>
          </div>
        </div>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}

      {/* Platform Presets */}
      <div style={{ marginBottom: 24 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: 'var(--text)' }}>
          {t('Platform Presets')}
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
          {devices.map((d) => (
            <div
              key={d.device_id}
              className="panel"
              style={{
                padding: '14px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                border: '1px solid var(--border)',
                background: 'var(--panel)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <strong style={{ fontSize: 14, color: 'var(--text)' }}>{d.name}</strong>
                <span className="badge badge-gray" style={{ textTransform: 'uppercase', fontSize: 10 }}>
                  {d.platform}
                </span>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                <span className="badge badge-gray" style={{ fontSize: 11 }}>
                  {d.config.mobile === true ? t('Touch Enabled') : t('Mouse & Keyboard')}
                </span>
                {d.config.screen && typeof d.config.screen === 'object' ? (
                  <span className="badge badge-gray" style={{ fontSize: 11 }}>
                    {(d.config.screen as { width: number; height: number }).width}×
                    {(d.config.screen as { width: number; height: number }).height}
                  </span>
                ) : null}
                {d.config.mobile === true ? (
                  <span className="badge badge-gray" style={{ fontSize: 11 }}>
                    {t('Phone Pool')}: {mobilePresets.length}
                  </span>
                ) : null}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                  {d.device_id}
                </span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => copyId(d.device_id)}
                    title={t('Copy preset ID — paste it as device_id when creating/updating a profile')}
                  >
                    {copiedId === d.device_id ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
                    <span>{copiedId === d.device_id ? t('Copied!') : t('Copy ID')}</span>
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      setApplyTarget({ kind: 'preset', id: d.device_id, label: d.name });
                      setApplyProfileId('');
                      setApplyMsg('');
                    }}
                  >
                    {t('Apply to Profile')}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Apply-to-profile inline panel */}
      {applyTarget ? (
        <div className="panel" style={{ marginBottom: 20, padding: '14px 16px', borderColor: 'rgba(255,255,255,0.2)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <strong style={{ fontSize: 13.5 }}>
              {t('Apply')} «{applyTarget.label}» {t('to a profile')}
            </strong>
            <button type="button" className="btn btn-sm" onClick={() => setApplyTarget(null)}>✕</button>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              className="select-input"
              style={{ minWidth: 260 }}
              value={applyProfileId}
              onChange={(e) => setApplyProfileId(e.target.value)}
            >
              <option value="">{t('Select profile…')}</option>
              {profiles.map((p) => (
                <option key={p.user_id} value={p.user_id}>
                  {p.name || p.user_id}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn primary"
              onClick={() => void applyToProfile()}
              disabled={applyBusy || !applyProfileId}
            >
              {applyBusy ? t('Saving...') : t('Apply')}
            </button>
            {applyMsg ? <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{applyMsg}</span> : null}
          </div>
          <p className="hint" style={{ marginTop: 8 }}>
            {applyTarget.kind === 'phone'
              ? t('The profile will run as this exact phone (Android preset + fixed model).')
              : t('The profile will emulate this platform (UA, screen, input, cores).')}
          </p>
        </div>
      ) : null}

      {/* Android Smartphone Pool */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
          <div>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
              {t('Android Smartphone Pool')} ({mobilePresets.length} {t('models')})
            </h3>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
              {t('When creating an Android profile, one of these models is deterministically attached to the fingerprint seed or fixed manually.')}
            </p>
          </div>
          <div className="search-box" style={{ width: 260 }}>
            <SearchIcon size={14} />
            <input
              placeholder={t('Search phone…')}
              value={phoneSearch}
              onChange={(e) => setPhoneSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 40 }}>#</th>
                <th>{t('Phone Model')}</th>
                <th style={{ width: 130 }}>Android</th>
                <th>GPU</th>
                <th style={{ width: 150 }}>Preset ID</th>
                <th style={{ width: 190, textAlign: 'right' }}>{t('Actions')}</th>
              </tr>
            </thead>
            <tbody>
              {filteredPhones.map((m, idx) => (
                <tr key={m.id}>
                  <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{idx + 1}</td>
                  <td>
                    <strong style={{ fontSize: 13, color: 'var(--text)' }}>{m.name}</strong>
                    <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{m.model}</div>
                  </td>
                  <td>
                    <span className="badge badge-gray" style={{ fontSize: 11 }}>
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
                  <td>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => copyId(m.id)}
                        title={t('Copy preset ID')}
                      >
                        {copiedId === m.id ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
                        <span>{copiedId === m.id ? t('Copied!') : t('Copy ID')}</span>
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => {
                          setApplyTarget({ kind: 'phone', id: m.id, label: m.name });
                          setApplyProfileId('');
                          setApplyMsg('');
                        }}
                      >
                        {t('Apply to Profile')}
                      </button>
                    </div>
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
