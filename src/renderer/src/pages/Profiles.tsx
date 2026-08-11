import { useCallback, useEffect, useState } from 'react';
import {
  api,
  type ProfileListItem,
  type ExtensionItem,
  type GroupItem,
  type ProxyItem,
  type DeviceItem,
} from '../api';

export function Profiles() {
  const [profiles, setProfiles] = useState<ProfileListItem[]>([]);
  const [groups, setGroups] = useState<GroupItem[]>([]);
  const [proxies, setProxies] = useState<ProxyItem[]>([]);
  const [devices, setDevices] = useState<DeviceItem[]>([]);
  const [extensions, setExtensions] = useState<ExtensionItem[]>([]);
  const [selectedGroupFilter, setSelectedGroupFilter] = useState<string>('');

  const [error, setError] = useState('');
  const [endpoint, setEndpoint] = useState<{ id: string; ws: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // New Profile / Batch Modals
  const [newProfileName, setNewProfileName] = useState('');
  const [newProfileGroup, setNewProfileGroup] = useState('');
  const [newProfileProxy, setNewProfileProxy] = useState('');
  const [newProfileDevice, setNewProfileDevice] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);

  const [showBatch, setShowBatch] = useState(false);
  const [batchCount, setBatchCount] = useState('5');
  const [batchPrefix, setBatchPrefix] = useState('profile');
  const [batchGroup, setBatchGroup] = useState('');

  const [showCsv, setShowCsv] = useState(false);
  const [csvText, setCsvText] = useState('');

  // Groups Management Modal
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [editingGroup, setEditingGroup] = useState<{ id: string; name: string } | null>(null);

  // Profile Edit Modal
  const [editingProfile, setEditingProfile] = useState<{
    id: string;
    name: string;
    group_id: string;
    proxy_id: string;
  } | null>(null);

  // Management Drawer (Cookies, Fingerprint, Extensions)
  const [manage, setManage] = useState<{ id: string; tab: 'cookies' | 'fingerprint' | 'extensions' } | null>(null);
  const [cookiesText, setCookiesText] = useState('');
  const [fpConfig, setFpConfig] = useState('');
  const [extSel, setExtSel] = useState<string[]>([]);

  const loadGroups = useCallback(async () => {
    try {
      const res = await api.groupList();
      if (res.code === 0) setGroups(res.data.list);
    } catch {
      // ignore
    }
  }, []);

  const loadProxies = useCallback(async () => {
    try {
      const res = await api.proxyList();
      if (res.code === 0) setProxies(res.data.list);
    } catch {
      // ignore
    }
  }, []);

  const loadDevices = useCallback(async () => {
    try {
      const res = await api.deviceList();
      if (res.code === 0) setDevices(res.data.list);
    } catch {
      // ignore
    }
  }, []);

  const loadExtensions = useCallback(async () => {
    try {
      const res = await api.extensionList();
      if (res.code === 0) setExtensions(res.data.list);
    } catch {
      // ignore
    }
  }, []);

  const loadProfiles = useCallback(async () => {
    try {
      const res = await api.list(selectedGroupFilter || undefined);
      if (res.code === 0) {
        setProfiles(res.data.list);
      } else {
        setError(res.msg);
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }, [selectedGroupFilter]);

  useEffect(() => {
    void loadProfiles();
    void loadGroups();
    void loadProxies();
    void loadDevices();
    void loadExtensions();
  }, [loadProfiles, loadGroups, loadProxies, loadDevices, loadExtensions]);

  const createSingleProfile = async () => {
    setBusy(true);
    setError('');
    try {
      const name = newProfileName.trim() || undefined;
      const grp = newProfileGroup || undefined;
      const px = newProfileProxy || undefined;
      const dev = newProfileDevice || undefined;
      const res = await api.create(name, grp, px, dev);
      if (res.code === 0) {
        setShowCreateModal(false);
        setNewProfileName('');
        setNewProfileGroup('');
        setNewProfileProxy('');
        setNewProfileDevice('');
        await loadProfiles();
        await loadGroups();
      } else {
        setError(res.msg);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveProfileEdit = async () => {
    if (!editingProfile) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.profileUpdate({
        user_id: editingProfile.id,
        name: editingProfile.name.trim() || undefined,
        group_id: editingProfile.group_id || null,
        proxy_id: editingProfile.proxy_id || null,
      });
      if (res.code === 0) {
        setEditingProfile(null);
        await loadProfiles();
        await loadGroups();
      } else {
        setError(res.msg);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleRandomizeFingerprint = async (id: string) => {
    setBusy(true);
    setError('');
    try {
      const res = await api.randomizeFingerprint(id);
      if (res.code === 0) {
        await loadProfiles();
      } else {
        setError(res.msg);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.groupCreate(newGroupName.trim());
      if (res.code === 0) {
        setNewGroupName('');
        await loadGroups();
      } else {
        setError(res.msg);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleUpdateGroup = async () => {
    if (!editingGroup || !editingGroup.name.trim()) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.groupUpdate(editingGroup.id, editingGroup.name.trim());
      if (res.code === 0) {
        setEditingGroup(null);
        await loadGroups();
      } else {
        setError(res.msg);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteGroup = async (groupId: string) => {
    if (!confirm('Are you sure you want to delete this group? Profiles in this group will be unassigned.')) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.groupDelete(groupId);
      if (res.code === 0) {
        if (selectedGroupFilter === groupId) setSelectedGroupFilter('');
        await loadGroups();
        await loadProfiles();
      } else {
        setError(res.msg);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const start = async (id: string) => {
    setBusy(true);
    setError('');
    try {
      const res = await api.start(id);
      if (res.code === 0) {
        setEndpoint({ id, ws: res.data.ws.puppeteer });
        await loadProfiles();
      } else {
        setError(res.msg);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const stop = async (id: string) => {
    setBusy(true);
    setError('');
    try {
      const res = await api.stop(id);
      if (res.code === 0) {
        if (endpoint?.id === id) setEndpoint(null);
        await loadProfiles();
      } else {
        setError(res.msg);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const createBatch = async () => {
    setBusy(true);
    setError('');
    try {
      const count = Number(batchCount) || 5;
      const res = await api.batchCreate({
        count,
        name_prefix: batchPrefix || 'profile',
      });
      if (res.code === 0) {
        if (batchGroup && res.data.user_ids?.length) {
          for (const uid of res.data.user_ids) {
            await api.profileUpdate({ user_id: uid, group_id: batchGroup });
          }
        }
        setShowBatch(false);
        await loadProfiles();
        await loadGroups();
      } else {
        setError(res.msg);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const importCsv = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await api.importCsv(csvText);
      if (res.code === 0) {
        setShowCsv(false);
        setCsvText('');
        await loadProfiles();
        await loadGroups();
      } else {
        setError(res.msg);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const openManage = async (id: string, tab: 'cookies' | 'fingerprint' | 'extensions') => {
    setError('');
    setManage({ id, tab });
    setCookiesText('');
    setFpConfig('');
    setExtSel([]);
    if (tab === 'extensions') {
      const res = await api.profileExtensions(id);
      if (res.code === 0) setExtSel(res.data.extension_ids);
    }
  };

  const saveCookies = async () => {
    if (!manage) return;
    setBusy(true);
    setError('');
    try {
      let cookies: Array<Record<string, unknown>>;
      try {
        cookies = JSON.parse(cookiesText);
      } catch {
        setError('Invalid JSON for cookies');
        setBusy(false);
        return;
      }
      const res = await api.cookiesImport(manage.id, cookies);
      if (res.code !== 0) setError(res.msg);
      setManage(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveFingerprint = async () => {
    if (!manage) return;
    setBusy(true);
    setError('');
    try {
      let cfg: Record<string, unknown>;
      try {
        cfg = JSON.parse(fpConfig);
      } catch {
        setError('Invalid JSON for fingerprint config');
        setBusy(false);
        return;
      }
      const res = await api.profileUpdateFingerprint(manage.id, cfg);
      if (res.code !== 0) setError(res.msg);
      setManage(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveExtensions = async () => {
    if (!manage) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.profileBindExtensions(manage.id, extSel);
      if (res.code !== 0) setError(res.msg);
      setManage(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const getGroupName = (groupId: string | null): string => {
    if (!groupId) return 'No group';
    const g = groups.find((item) => item.id === groupId);
    return g ? g.name : 'Unknown group';
  };

  return (
    <section>
      <header className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <h1>Profiles</h1>
          <select
            value={selectedGroupFilter}
            onChange={(e) => setSelectedGroupFilter(e.target.value)}
            style={{ padding: '6px 12px', borderRadius: 6, background: 'var(--panel-2)', color: 'var(--text)' }}
          >
            <option value="">All Groups ({groups.reduce((acc, g) => acc + g.profile_count, 0)})</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} ({g.profile_count})
              </option>
            ))}
          </select>
        </div>
        <div className="actions">
          <button onClick={() => setShowGroupModal(true)}>Manage Groups</button>
          <button onClick={() => setShowBatch((v) => !v)}>Batch create</button>
          <button onClick={() => setShowCsv((v) => !v)}>Import CSV</button>
          <button className="primary" onClick={() => setShowCreateModal(true)} disabled={busy}>
            + New profile
          </button>
        </div>
      </header>

      {error ? <div className="error">{error}</div> : null}

      {endpoint ? (
        <div className="endpoint">
          <span>Active CDP:</span>
          <code>{endpoint.ws}</code>
          <p className="hint">
            Подключите ваши автоматизации (Puppeteer/Playwright/Selenium) к этому WebSocket-адресу.
          </p>
        </div>
      ) : null}

      {/* New Profile Modal */}
      {showCreateModal ? (
        <div className="panel">
          <h3>Create New Profile</h3>
          <div className="form-row">
            <input
              placeholder="Profile Name (e.g. Work-Account-1)"
              value={newProfileName}
              onChange={(e) => setNewProfileName(e.target.value)}
              style={{ minWidth: 220 }}
            />
            <select value={newProfileGroup} onChange={(e) => setNewProfileGroup(e.target.value)}>
              <option value="">No Group</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
            <select value={newProfileProxy} onChange={(e) => setNewProfileProxy(e.target.value)}>
              <option value="">No Proxy (Direct)</option>
              {proxies.map((p) => (
                <option key={p.proxy_id} value={p.proxy_id}>
                  {p.type.toUpperCase()}://{p.host}:{p.port} ({p.country || 'no location'})
                </option>
              ))}
            </select>
            <select value={newProfileDevice} onChange={(e) => setNewProfileDevice(e.target.value)}>
              <option value="">Default Preset (Windows)</option>
              {devices.map((d) => (
                <option key={d.device_id} value={d.device_id}>
                  {d.name} ({d.platform})
                </option>
              ))}
            </select>
          </div>
          <div className="form-row" style={{ marginTop: 12 }}>
            <button className="primary" onClick={() => void createSingleProfile()} disabled={busy}>
              Create Profile
            </button>
            <button onClick={() => setShowCreateModal(false)}>Cancel</button>
          </div>
        </div>
      ) : null}

      {/* Edit Profile Modal */}
      {editingProfile ? (
        <div className="panel">
          <h3>Edit Profile ({editingProfile.id})</h3>
          <div className="form-row">
            <input
              placeholder="Profile Name"
              value={editingProfile.name}
              onChange={(e) => setEditingProfile({ ...editingProfile, name: e.target.value })}
              style={{ minWidth: 240 }}
            />
            <select
              value={editingProfile.group_id}
              onChange={(e) => setEditingProfile({ ...editingProfile, group_id: e.target.value })}
            >
              <option value="">No Group</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
            <select
              value={editingProfile.proxy_id}
              onChange={(e) => setEditingProfile({ ...editingProfile, proxy_id: e.target.value })}
            >
              <option value="">No Proxy</option>
              {proxies.map((p) => (
                <option key={p.proxy_id} value={p.proxy_id}>
                  {p.type.toUpperCase()}://{p.host}:{p.port}
                </option>
              ))}
            </select>
          </div>
          <div className="form-row" style={{ marginTop: 12 }}>
            <button className="primary" onClick={() => void saveProfileEdit()} disabled={busy}>
              Save Changes
            </button>
            <button
              onClick={() => void handleRandomizeFingerprint(editingProfile.id)}
              disabled={busy}
              title="Regenerate random seed and canvas/WebGL/audio fingerprint"
            >
              🎲 Randomize Fingerprint
            </button>
            <button onClick={() => setEditingProfile(null)}>Cancel</button>
          </div>
        </div>
      ) : null}

      {/* Manage Groups Modal */}
      {showGroupModal ? (
        <div className="panel">
          <div className="form-row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
            <h3>Manage Profile Groups</h3>
            <button onClick={() => setShowGroupModal(false)}>Close</button>
          </div>

          <div className="form-row" style={{ marginBottom: 16 }}>
            <input
              placeholder="New group name"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
            />
            <button className="primary" onClick={() => void handleCreateGroup()} disabled={busy || !newGroupName.trim()}>
              + Create Group
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {groups.map((g) => (
              <div
                key={g.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  background: 'var(--panel-2)',
                  padding: '8px 12px',
                  borderRadius: 6,
                }}
              >
                {editingGroup?.id === g.id ? (
                  <div className="form-row">
                    <input
                      value={editingGroup.name}
                      onChange={(e) => setEditingGroup({ ...editingGroup, name: e.target.value })}
                    />
                    <button className="primary" onClick={() => void handleUpdateGroup()} disabled={busy}>
                      Save
                    </button>
                    <button onClick={() => setEditingGroup(null)}>Cancel</button>
                  </div>
                ) : (
                  <span>
                    <strong>{g.name}</strong> ({g.profile_count} profiles)
                  </span>
                )}

                {editingGroup?.id !== g.id ? (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => setEditingGroup({ id: g.id, name: g.name })}>Rename</button>
                    <button onClick={() => void handleDeleteGroup(g.id)} disabled={busy}>
                      Delete
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
            {groups.length === 0 ? <span className="hint">No groups created yet.</span> : null}
          </div>
        </div>
      ) : null}

      {showBatch ? (
        <div className="panel">
          <div className="form-row">
            <input
              placeholder="count"
              value={batchCount}
              onChange={(e) => setBatchCount(e.target.value)}
              style={{ width: 80 }}
            />
            <input
              placeholder="name prefix"
              value={batchPrefix}
              onChange={(e) => setBatchPrefix(e.target.value)}
            />
            <select value={batchGroup} onChange={(e) => setBatchGroup(e.target.value)}>
              <option value="">No Group</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
            <button className="primary" onClick={() => void createBatch()} disabled={busy}>
              Create batch
            </button>
          </div>
        </div>
      ) : null}

      {showCsv ? (
        <div className="panel">
          <p className="hint">
            CSV format: <code>name,proxy_type,proxy_host,proxy_port,proxy_user,proxy_pass</code>
          </p>
          <textarea
            placeholder="acc1,http,1.2.3.4,8080,usr,pass&#10;acc2,socks5,5.6.7.8,1080"
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            rows={4}
            style={{ width: '100%', fontFamily: 'monospace' }}
          />
          <div className="form-row" style={{ marginTop: 8 }}>
            <button className="primary" onClick={() => void importCsv()} disabled={busy}>
              Import CSV
            </button>
          </div>
        </div>
      ) : null}

      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Group</th>
            <th>ID</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {profiles.length === 0 ? (
            <tr>
              <td colSpan={5} className="empty">
                No profiles found. Click "+ New profile" to create one.
              </td>
            </tr>
          ) : (
            profiles.map((p) => (
              <tr key={p.user_id}>
                <td>
                  <strong>{p.name || 'Unnamed Profile'}</strong>
                </td>
                <td>
                  <span
                    style={{
                      background: p.group_id ? 'var(--panel-2)' : 'transparent',
                      padding: '2px 8px',
                      borderRadius: 4,
                      fontSize: 12,
                      color: p.group_id ? 'var(--accent)' : 'var(--muted)',
                    }}
                  >
                    {getGroupName(p.group_id)}
                  </span>
                </td>
                <td>
                  <code>{p.user_id}</code>
                </td>
                <td>
                  <span className={`badge ${p.status}`}>{p.status}</span>
                </td>
                <td>
                  {p.status === 'running' ? (
                    <button onClick={() => void stop(p.user_id)} disabled={busy}>
                      Stop
                    </button>
                  ) : (
                    <button className="primary" onClick={() => void start(p.user_id)} disabled={busy}>
                      Start
                    </button>
                  )}
                  <button
                    onClick={() =>
                      setEditingProfile({
                        id: p.user_id,
                        name: p.name || '',
                        group_id: p.group_id || '',
                        proxy_id: '',
                      })
                    }
                  >
                    Edit
                  </button>
                  <button onClick={() => void handleRandomizeFingerprint(p.user_id)} title="Randomize Fingerprint Seed">
                    🎲
                  </button>
                  <button onClick={() => void openManage(p.user_id, 'cookies')}>Cookies</button>
                  <button onClick={() => void openManage(p.user_id, 'fingerprint')}>Fingerprint</button>
                  <button onClick={() => void openManage(p.user_id, 'extensions')}>Extensions</button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {manage ? (
        <div className="panel">
          <div className="form-row">
            <strong>Profile {manage.id}</strong>
            <button onClick={() => setManage(null)}>Close</button>
          </div>
          {manage.tab === 'cookies' ? (
            <>
              <textarea
                placeholder='[{"name":"a","value":"b","domain":"example.com","path":"/"}]'
                value={cookiesText}
                onChange={(e) => setCookiesText(e.target.value)}
                rows={5}
                style={{ width: '100%', fontFamily: 'monospace' }}
              />
              <div className="form-row" style={{ marginTop: 8 }}>
                <button className="primary" onClick={() => void saveCookies()} disabled={busy}>
                  Import cookies
                </button>
              </div>
            </>
          ) : manage.tab === 'fingerprint' ? (
            <>
              <p className="hint">
                JSON overrides for fingerprint (platform, brand, hardwareConcurrency, timezone, lang).
              </p>
              <textarea
                placeholder='{"platform":"windows","hardwareConcurrency":8}'
                value={fpConfig}
                onChange={(e) => setFpConfig(e.target.value)}
                rows={4}
                style={{ width: '100%', fontFamily: 'monospace' }}
              />
              <div className="form-row" style={{ marginTop: 8 }}>
                <button className="primary" onClick={() => void saveFingerprint()} disabled={busy}>
                  Save fingerprint overrides
                </button>
              </div>
            </>
          ) : (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, margin: '8px 0' }}>
                {extensions.map((e) => (
                  <label key={e.extension_id}>
                    <input
                      type="checkbox"
                      checked={extSel.includes(e.extension_id)}
                      onChange={(evt) =>
                        setExtSel((prev) =>
                          evt.target.checked
                            ? [...prev, e.extension_id]
                            : prev.filter((x) => x !== e.extension_id)
                        )
                      }
                    />
                    {e.name}
                  </label>
                ))}
                {extensions.length === 0 ? <span className="hint">No extensions imported.</span> : null}
              </div>
              <div className="form-row" style={{ marginTop: 8 }}>
                <button className="primary" onClick={() => void saveExtensions()} disabled={busy}>
                  Save extensions
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
