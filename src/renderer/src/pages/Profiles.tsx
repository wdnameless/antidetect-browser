import { useCallback, useEffect, useState } from 'react';
import {
  api,
  type ProfileListItem,
  type ExtensionItem,
  type GroupItem,
  type ProxyItem,
  type DeviceItem,
} from '../api';
import {
  PlayIcon,
  StopIcon,
  EditIcon,
  DiceIcon,
  CookieIcon,
  FingerprintIcon,
  ExtensionsIcon,
  CopyIcon,
  CheckIcon,
  PlusIcon,
  SearchIcon,
  FolderIcon,
  TrashIcon,
} from '../icons';

export function Profiles() {
  const [profiles, setProfiles] = useState<ProfileListItem[]>([]);
  const [groups, setGroups] = useState<GroupItem[]>([]);
  const [proxies, setProxies] = useState<ProxyItem[]>([]);
  const [devices, setDevices] = useState<DeviceItem[]>([]);
  const [extensions, setExtensions] = useState<ExtensionItem[]>([]);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGroupFilter, setSelectedGroupFilter] = useState<string>('');

  const [error, setError] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
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

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(text);
    setTimeout(() => setCopiedId(null), 1500);
  };

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
    if (!groupId) return 'Ungrouped';
    const g = groups.find((item) => item.id === groupId);
    return g ? g.name : 'Unknown';
  };

  const filteredProfiles = profiles.filter((p) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    const nameMatch = (p.name || '').toLowerCase().includes(query);
    const idMatch = p.user_id.toLowerCase().includes(query);
    return nameMatch || idMatch;
  });

  return (
    <div>
      {/* Top Action Header */}
      <div className="page-header-actions">
        <div className="header-filters">
          <div className="search-box">
            <SearchIcon size={16} />
            <input
              placeholder="Search by profile name or ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <select
            className="select-input"
            value={selectedGroupFilter}
            onChange={(e) => setSelectedGroupFilter(e.target.value)}
          >
            <option value="">All Groups ({groups.reduce((acc, g) => acc + g.profile_count, 0)})</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} ({g.profile_count})
              </option>
            ))}
          </select>
        </div>

        <div className="header-btn-group">
          <button className="btn" onClick={() => setShowGroupModal(true)}>
            <FolderIcon size={14} />
            <span>Groups</span>
          </button>
          <button className="btn" onClick={() => setShowBatch(true)}>
            Batch Create
          </button>
          <button className="btn" onClick={() => setShowCsv(true)}>
            Import CSV
          </button>
          <button className="btn primary" onClick={() => setShowCreateModal(true)} disabled={busy}>
            <PlusIcon size={15} />
            <span>New Profile</span>
          </button>
        </div>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}

      {endpoint ? (
        <div className="endpoint-banner">
          <div>
            <strong style={{ fontSize: 13, marginRight: 10 }}>Active CDP:</strong>
            <code>{endpoint.ws}</code>
          </div>
          <span className="hint" style={{ margin: 0 }}>Connected to automation</span>
        </div>
      ) : null}

      {/* Profiles Table */}
      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: '28%' }}>Profile Name</th>
              <th style={{ width: '16%' }}>Group</th>
              <th style={{ width: '26%' }}>ID</th>
              <th style={{ width: '12%' }}>Status</th>
              <th style={{ width: '18%', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredProfiles.length === 0 ? (
              <tr>
                <td colSpan={5} className="empty-cell">
                  {searchQuery ? 'No profiles match your search criteria.' : 'No profiles found. Click "+ New Profile" to create one.'}
                </td>
              </tr>
            ) : (
              filteredProfiles.map((p) => (
                <tr key={p.user_id}>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <strong style={{ fontSize: 14, color: '#f3f4f6' }}>{p.name || 'Unnamed Profile'}</strong>
                    </div>
                  </td>
                  <td>
                    <span className="group-tag">
                      <FolderIcon size={11} />
                      {getGroupName(p.group_id)}
                    </span>
                  </td>
                  <td>
                    <div className="id-badge">
                      <code>{p.user_id.slice(0, 18)}...</code>
                      <button onClick={() => copyToClipboard(p.user_id)} title="Copy ID">
                        {copiedId === p.user_id ? <CheckIcon size={13} style={{ color: 'var(--ok)' }} /> : <CopyIcon size={13} />}
                      </button>
                    </div>
                  </td>
                  <td>
                    <span className={`badge ${p.status}`}>
                      {p.status === 'running' ? 'Running' : 'Closed'}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                      {p.status === 'running' ? (
                        <button
                          className="btn-icon stop-btn"
                          onClick={() => void stop(p.user_id)}
                          disabled={busy}
                          title="Stop Profile"
                        >
                          <StopIcon size={13} />
                        </button>
                      ) : (
                        <button
                          className="btn-icon play-btn"
                          onClick={() => void start(p.user_id)}
                          disabled={busy}
                          title="Start Profile"
                        >
                          <PlayIcon size={13} />
                        </button>
                      )}
                      
                      <button
                        className="btn-icon"
                        onClick={() =>
                          setEditingProfile({
                            id: p.user_id,
                            name: p.name || '',
                            group_id: p.group_id || '',
                            proxy_id: '',
                          })
                        }
                        title="Edit Profile"
                      >
                        <EditIcon size={14} />
                      </button>

                      <button
                        className="btn-icon"
                        onClick={() => void handleRandomizeFingerprint(p.user_id)}
                        disabled={busy}
                        title="🎲 Randomize Fingerprint Seed"
                      >
                        <DiceIcon size={14} />
                      </button>

                      <button
                        className="btn-icon"
                        onClick={() => void openManage(p.user_id, 'cookies')}
                        title="Manage Cookies"
                      >
                        <CookieIcon size={14} />
                      </button>

                      <button
                        className="btn-icon"
                        onClick={() => void openManage(p.user_id, 'fingerprint')}
                        title="Fingerprint Overrides"
                      >
                        <FingerprintIcon size={14} />
                      </button>

                      <button
                        className="btn-icon"
                        onClick={() => void openManage(p.user_id, 'extensions')}
                        title="Bind Extensions"
                      >
                        <ExtensionsIcon size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* New Profile Modal */}
      {showCreateModal ? (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Create New Profile</h3>
              <button className="btn-icon" onClick={() => setShowCreateModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Profile Name</label>
                <input
                  placeholder="e.g. TikTok-Farm-01"
                  value={newProfileName}
                  onChange={(e) => setNewProfileName(e.target.value)}
                  autoFocus
                />
              </div>

              <div className="form-group">
                <label>Group</label>
                <select value={newProfileGroup} onChange={(e) => setNewProfileGroup(e.target.value)}>
                  <option value="">No Group (Ungrouped)</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Proxy Configuration</label>
                <select value={newProfileProxy} onChange={(e) => setNewProfileProxy(e.target.value)}>
                  <option value="">Direct Connection (No Proxy)</option>
                  {proxies.map((p) => (
                    <option key={p.proxy_id} value={p.proxy_id}>
                      {p.type.toUpperCase()}://{p.host}:{p.port} ({p.country || 'Default'})
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Device Preset / OS</label>
                <select value={newProfileDevice} onChange={(e) => setNewProfileDevice(e.target.value)}>
                  <option value="">Windows Default Preset</option>
                  {devices.map((d) => (
                    <option key={d.device_id} value={d.device_id}>
                      {d.name} ({d.platform.toUpperCase()})
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowCreateModal(false)}>Cancel</button>
              <button className="btn primary" onClick={() => void createSingleProfile()} disabled={busy}>
                Create Profile
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Edit Profile Modal */}
      {editingProfile ? (
        <div className="modal-overlay" onClick={() => setEditingProfile(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Edit Profile</h3>
              <button className="btn-icon" onClick={() => setEditingProfile(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Profile Name</label>
                <input
                  placeholder="Profile Name"
                  value={editingProfile.name}
                  onChange={(e) => setEditingProfile({ ...editingProfile, name: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Group</label>
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
              </div>

              <div className="form-group">
                <label>Change Proxy</label>
                <select
                  value={editingProfile.proxy_id}
                  onChange={(e) => setEditingProfile({ ...editingProfile, proxy_id: e.target.value })}
                >
                  <option value="">No Proxy (Direct)</option>
                  {proxies.map((p) => (
                    <option key={p.proxy_id} value={p.proxy_id}>
                      {p.type.toUpperCase()}://{p.host}:{p.port}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="btn"
                onClick={() => void handleRandomizeFingerprint(editingProfile.id)}
                disabled={busy}
                title="Regenerate random seed and canvas/WebGL/audio fingerprint"
              >
                🎲 Randomize Seed
              </button>
              <button className="btn" onClick={() => setEditingProfile(null)}>Cancel</button>
              <button className="btn primary" onClick={() => void saveProfileEdit()} disabled={busy}>
                Save Changes
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Manage Groups Modal */}
      {showGroupModal ? (
        <div className="modal-overlay" onClick={() => setShowGroupModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Profile Groups</h3>
              <button className="btn-icon" onClick={() => setShowGroupModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  style={{ flex: 1 }}
                  placeholder="New group name (e.g. TikTok Farm, Crypto)..."
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                />
                <button className="btn primary" onClick={() => void handleCreateGroup()} disabled={busy || !newGroupName.trim()}>
                  + Add Group
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
                {groups.map((g) => (
                  <div
                    key={g.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      background: 'var(--panel-2)',
                      padding: '10px 14px',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--border)',
                    }}
                  >
                    {editingGroup?.id === g.id ? (
                      <div style={{ display: 'flex', gap: 6, flex: 1 }}>
                        <input
                          style={{ flex: 1 }}
                          value={editingGroup.name}
                          onChange={(e) => setEditingGroup({ ...editingGroup, name: e.target.value })}
                        />
                        <button className="btn primary" onClick={() => void handleUpdateGroup()} disabled={busy}>
                          Save
                        </button>
                        <button className="btn" onClick={() => setEditingGroup(null)}>Cancel</button>
                      </div>
                    ) : (
                      <>
                        <span style={{ fontSize: 13.5 }}>
                          <strong>{g.name}</strong> <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>({g.profile_count} profiles)</span>
                        </span>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="btn" onClick={() => setEditingGroup({ id: g.id, name: g.name })}>
                            Rename
                          </button>
                          <button className="btn danger" onClick={() => void handleDeleteGroup(g.id)} disabled={busy}>
                            <TrashIcon size={14} />
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
                {groups.length === 0 ? <p className="hint">No custom groups created yet.</p> : null}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowGroupModal(false)}>Close</button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Batch Create Modal */}
      {showBatch ? (
        <div className="modal-overlay" onClick={() => setShowBatch(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Batch Create Profiles</h3>
              <button className="btn-icon" onClick={() => setShowBatch(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Number of profiles to generate</label>
                <input
                  type="number"
                  min="1"
                  max="500"
                  value={batchCount}
                  onChange={(e) => setBatchCount(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label>Name Prefix</label>
                <input
                  placeholder="e.g. farm-acc"
                  value={batchPrefix}
                  onChange={(e) => setBatchPrefix(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label>Assign to Group</label>
                <select value={batchGroup} onChange={(e) => setBatchGroup(e.target.value)}>
                  <option value="">No Group</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowBatch(false)}>Cancel</button>
              <button className="btn primary" onClick={() => void createBatch()} disabled={busy}>
                Generate Profiles
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* CSV Import Modal */}
      {showCsv ? (
        <div className="modal-overlay" onClick={() => setShowCsv(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Import Profiles via CSV</h3>
              <button className="btn-icon" onClick={() => setShowCsv(false)}>✕</button>
            </div>
            <div className="modal-body">
              <p className="hint" style={{ margin: 0 }}>
                CSV format: <code>name,proxy_type,proxy_host,proxy_port,proxy_user,proxy_pass</code>
              </p>
              <textarea
                placeholder="acc1,http,1.2.3.4,8080,usr,pass&#10;acc2,socks5,5.6.7.8,1080"
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
                rows={6}
                style={{ width: '100%', fontFamily: 'var(--font-mono)' }}
              />
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowCsv(false)}>Cancel</button>
              <button className="btn primary" onClick={() => void importCsv()} disabled={busy || !csvText.trim()}>
                Import Profiles
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Manage Drawer / Modal for Cookies, Fingerprint, Extensions */}
      {manage ? (
        <div className="modal-overlay" onClick={() => setManage(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>
                {manage.tab === 'cookies' && 'Manage Cookies'}
                {manage.tab === 'fingerprint' && 'Fingerprint Overrides'}
                {manage.tab === 'extensions' && 'Bound Extensions'}
              </h3>
              <button className="btn-icon" onClick={() => setManage(null)}>✕</button>
            </div>

            <div className="modal-body">
              {manage.tab === 'cookies' ? (
                <>
                  <p className="hint" style={{ margin: 0 }}>
                    Paste an array of JSON cookies exported from EditThisCookie or another browser.
                  </p>
                  <textarea
                    placeholder='[{"name":"session","value":"xyz","domain":".example.com","path":"/"}]'
                    value={cookiesText}
                    onChange={(e) => setCookiesText(e.target.value)}
                    rows={8}
                    style={{ width: '100%', fontFamily: 'var(--font-mono)' }}
                  />
                </>
              ) : manage.tab === 'fingerprint' ? (
                <>
                  <p className="hint" style={{ margin: 0 }}>
                    JSON overrides for hardware and fingerprint (platform, brand, hardwareConcurrency, timezone, lang).
                  </p>
                  <textarea
                    placeholder='{"platform":"windows","hardwareConcurrency":8}'
                    value={fpConfig}
                    onChange={(e) => setFpConfig(e.target.value)}
                    rows={6}
                    style={{ width: '100%', fontFamily: 'var(--font-mono)' }}
                  />
                </>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {extensions.map((e) => (
                    <label key={e.extension_id} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13.5 }}>
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
                      <span>{e.name}</span>
                    </label>
                  ))}
                  {extensions.length === 0 ? <p className="hint">No extensions available. Go to Extensions to import .crx or unpacked folders.</p> : null}
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button className="btn" onClick={() => setManage(null)}>Cancel</button>
              {manage.tab === 'cookies' && (
                <button className="btn primary" onClick={() => void saveCookies()} disabled={busy}>
                  Save Cookies
                </button>
              )}
              {manage.tab === 'fingerprint' && (
                <button className="btn primary" onClick={() => void saveFingerprint()} disabled={busy}>
                  Apply Overrides
                </button>
              )}
              {manage.tab === 'extensions' && (
                <button className="btn primary" onClick={() => void saveExtensions()} disabled={busy}>
                  Save Extensions
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
