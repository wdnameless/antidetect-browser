import { useCallback, useEffect, useState } from 'react';
import {
  api,
  type ProfileListItem,
  type ExtensionItem,
  type GroupItem,
  type ProxyItem,
  type DeviceItem,
  type ProxyTestResult,
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
  ProxiesIcon,
  RefreshIcon,
  DevicesIcon,
} from '../icons';

export function Profiles() {
  const [profiles, setProfiles] = useState<ProfileListItem[]>([]);
  const [groups, setGroups] = useState<GroupItem[]>([]);
  const [proxies, setProxies] = useState<ProxyItem[]>([]);
  const [devices, setDevices] = useState<DeviceItem[]>([]);
  const [extensions, setExtensions] = useState<ExtensionItem[]>([]);
  const [mobilePresets, setMobilePresets] = useState<Array<{ id: string; name: string; model: string; androidVersion: string; gpu: string }>>([]);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGroupFilter, setSelectedGroupFilter] = useState<string>('');

  const [error, setError] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [endpoint, setEndpoint] = useState<{ id: string; ws: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Modal tab: 'general' | 'proxy' | 'fingerprint'
  const [modalTab, setModalTab] = useState<'general' | 'proxy' | 'fingerprint'>('general');

  // Modal Profile State (Create or Edit)
  const [modalMode, setModalMode] = useState<'create' | 'edit' | null>(null);
  const [profileId, setProfileId] = useState('');
  const [name, setName] = useState('');
  const [groupId, setGroupId] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [seed, setSeed] = useState<number>(0);
  const [mobileModelId, setMobileModelId] = useState('');
  const [userAgent, setUserAgent] = useState('');
  const [cores, setCores] = useState<number>(8);

  // Proxy state in modal: mode = 'none' | 'saved' | 'custom'
  const [proxyMode, setProxyMode] = useState<'none' | 'saved' | 'custom'>('none');
  const [savedProxyId, setSavedProxyId] = useState('');
  const [customProxyType, setCustomProxyType] = useState<'http' | 'https' | 'socks5' | 'ssh'>('socks5');
  const [customProxyHost, setCustomProxyHost] = useState('');
  const [customProxyPort, setCustomProxyPort] = useState('');
  const [customProxyUser, setCustomProxyUser] = useState('');
  const [customProxyPass, setCustomProxyPass] = useState('');
  const [proxyTesting, setProxyTesting] = useState(false);
  const [proxyTestResult, setProxyTestResult] = useState<ProxyTestResult | null>(null);

  // Batch & CSV Modals
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

  // Drawer (Cookies, Fingerprint Overrides, Extensions)
  const [manage, setManage] = useState<{ id: string; tab: 'cookies' | 'fingerprint' | 'extensions' } | null>(null);
  const [cookiesText, setCookiesText] = useState('');
  const [fpConfig, setFpConfig] = useState('');
  const [extSel, setExtSel] = useState<string[]>([]);

  const loadGroups = useCallback(async () => {
    try {
      const res = await api.groupList();
      if (res.code === 0) setGroups(res.data.list);
    } catch { /* ignore */ }
  }, []);

  const loadProxies = useCallback(async () => {
    try {
      const res = await api.proxyList();
      if (res.code === 0) setProxies(res.data.list);
    } catch { /* ignore */ }
  }, []);

  const loadDevices = useCallback(async () => {
    try {
      const res = await api.deviceList();
      if (res.code === 0) setDevices(res.data.list);
    } catch { /* ignore */ }
  }, []);

  const loadMobilePresets = useCallback(async () => {
    try {
      const res = await api.mobilePresets();
      if (res.code === 0) setMobilePresets(res.data.list);
    } catch { /* ignore */ }
  }, []);

  const loadExtensions = useCallback(async () => {
    try {
      const res = await api.extensionList();
      if (res.code === 0) setExtensions(res.data.list);
    } catch { /* ignore */ }
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
    void loadMobilePresets();
    void loadExtensions();
  }, [loadProfiles, loadGroups, loadProxies, loadDevices, loadMobilePresets, loadExtensions]);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(text);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const openCreateModal = () => {
    setModalMode('create');
    setModalTab('general');
    setProfileId('');
    setName('');
    setGroupId('');
    setDeviceId('');
    setSeed(Math.floor(Math.random() * 2000000000) + 100000000);
    setMobileModelId('');
    setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36');
    setCores(8);
    setProxyMode('none');
    setSavedProxyId('');
    setCustomProxyType('socks5');
    setCustomProxyHost('');
    setCustomProxyPort('');
    setCustomProxyUser('');
    setCustomProxyPass('');
    setProxyTestResult(null);
  };

  const openEditModal = async (p: ProfileListItem) => {
    setModalMode('edit');
    setModalTab('general');
    setProfileId(p.user_id);
    setName(p.name || '');
    setGroupId(p.group_id || '');
    setProxyTestResult(null);

    // Fetch full details
    try {
      const res = await api.profileDetail(p.user_id);
      if (res.code === 0 && res.data) {
        const d = res.data;
        setName(d.name || '');
        setGroupId(d.group_id || '');
        setDeviceId(d.device_id || '');
        setSeed(d.fingerprint?.seed || p.fingerprint_seed || 123456789);
        setMobileModelId((d as any).mobile_model_id || '');
        setCores(d.fingerprint?.hardwareConcurrency || 8);
        setUserAgent(d.user_agent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36');

        if (d.proxy) {
          setProxyMode('saved');
          setSavedProxyId(d.proxy.id);
          setCustomProxyType(d.proxy.type);
          setCustomProxyHost(d.proxy.host);
          setCustomProxyPort(String(d.proxy.port));
          setCustomProxyUser(d.proxy.username || '');
        } else {
          setProxyMode('none');
          setSavedProxyId('');
        }
      }
    } catch {
      setSeed(p.fingerprint_seed || 123456789);
    }
  };

  const testProxyLive = async () => {
    setProxyTesting(true);
    setProxyTestResult(null);
    try {
      let payload: { type: string; host: string; port: number; username?: string; password?: string };
      if (proxyMode === 'saved') {
        const px = proxies.find((x) => x.proxy_id === savedProxyId);
        if (!px) {
          setProxyTestResult({ ok: false, error: 'Please select a saved proxy first.' });
          setProxyTesting(false);
          return;
        }
        payload = { type: px.type, host: px.host, port: px.port, username: px.username || undefined };
      } else if (proxyMode === 'custom') {
        if (!customProxyHost.trim() || !customProxyPort.trim()) {
          setProxyTestResult({ ok: false, error: 'Host and Port are required.' });
          setProxyTesting(false);
          return;
        }
        payload = {
          type: customProxyType,
          host: customProxyHost.trim(),
          port: Number(customProxyPort.trim()) || 80,
          username: customProxyUser.trim() || undefined,
          password: customProxyPass.trim() || undefined,
        };
      } else {
        setProxyTestResult({ ok: false, error: 'Proxy mode is set to Direct (No Proxy).' });
        setProxyTesting(false);
        return;
      }

      const res = await api.proxyTest(payload);
      if (res.code === 0) {
        setProxyTestResult(res.data);
      } else {
        setProxyTestResult({ ok: false, error: res.msg });
      }
    } catch (err) {
      setProxyTestResult({ ok: false, error: (err as Error).message });
    } finally {
      setProxyTesting(false);
    }
  };

  const saveProfileModal = async () => {
    setBusy(true);
    setError('');
    try {
      let proxyPayload: any = undefined;
      let proxyIdPayload: string | null | undefined = undefined;

      if (proxyMode === 'none') {
        proxyIdPayload = null;
      } else if (proxyMode === 'saved') {
        proxyIdPayload = savedProxyId || null;
      } else if (proxyMode === 'custom') {
        if (customProxyHost.trim() && customProxyPort.trim()) {
          proxyPayload = {
            type: customProxyType,
            host: customProxyHost.trim(),
            port: Number(customProxyPort.trim()) || 80,
            username: customProxyUser.trim() || undefined,
            password: customProxyPass.trim() || undefined,
          };
        }
      }

      if (modalMode === 'create') {
        const res = await api.create({
          name: name.trim() || undefined,
          group_id: groupId || undefined,
          device_id: deviceId || undefined,
          fingerprint_seed: seed,
          mobile_model_id: mobileModelId || undefined,
          user_agent: userAgent.trim() || undefined,
          proxy_id: proxyIdPayload || undefined,
          proxy: proxyPayload,
        });
        if (res.code === 0) {
          setModalMode(null);
          await loadProfiles();
          await loadGroups();
          await loadProxies();
        } else {
          setError(res.msg);
        }
      } else if (modalMode === 'edit' && profileId) {
        const res = await api.profileUpdate({
          user_id: profileId,
          name: name.trim() || undefined,
          group_id: groupId || null,
          device_id: deviceId || null,
          mobile_model_id: mobileModelId || null,
          user_agent: userAgent.trim() || undefined,
          proxy_id: proxyIdPayload,
          proxy: proxyPayload,
        });
        if (res.code === 0) {
          setModalMode(null);
          await loadProfiles();
          await loadGroups();
          await loadProxies();
        } else {
          setError(res.msg);
        }
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const deleteProfilePrompt = async (id: string) => {
    if (!confirm(`Are you sure you want to delete profile ${id}?`)) return;
    setBusy(true);
    try {
      const res = await api.profileDelete(id);
      if (res.code === 0) {
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
        if (modalMode === 'edit' && profileId === id) {
          setSeed(res.data.seed);
        }
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

  const getGroupName = (gId: string | null): string => {
    if (!gId) return 'Ungrouped';
    const g = groups.find((item) => item.id === gId);
    return g ? g.name : 'Unknown';
  };

  const filteredProfiles = profiles.filter((p) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    const nameMatch = (p.name || '').toLowerCase().includes(query);
    const idMatch = p.user_id.toLowerCase().includes(query);
    const proxyMatch = (p.proxy_host || '').toLowerCase().includes(query);
    return nameMatch || idMatch || proxyMatch;
  });

  return (
    <div>
      {/* Top Action Header */}
      <div className="page-header-actions">
        <div className="header-filters">
          <div className="search-box">
            <SearchIcon size={16} />
            <input
              placeholder="Search profile name, ID, or proxy..."
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
          <button className="btn primary" onClick={openCreateModal} disabled={busy}>
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
              <th style={{ width: '22%' }}>Profile Name</th>
              <th style={{ width: '22%' }}>Proxy</th>
              <th style={{ width: '15%' }}>Device / OS</th>
              <th style={{ width: '13%' }}>Fingerprint</th>
              <th style={{ width: '10%' }}>Status</th>
              <th style={{ width: '18%', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredProfiles.length === 0 ? (
              <tr>
                <td colSpan={6} className="empty-cell">
                  {searchQuery ? 'No profiles match your search criteria.' : 'No profiles found. Click "+ New Profile" to create one.'}
                </td>
              </tr>
            ) : (
              filteredProfiles.map((p) => (
                <tr key={p.user_id}>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <strong style={{ fontSize: 14, color: '#f3f4f6' }}>{p.name || 'Unnamed Profile'}</strong>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span className="group-tag">
                          <FolderIcon size={10} />
                          {getGroupName(p.group_id)}
                        </span>
                        <div className="id-badge">
                          <code>{p.user_id.slice(0, 10)}...</code>
                          <button onClick={() => copyToClipboard(p.user_id)} title="Copy ID">
                            {copiedId === p.user_id ? <CheckIcon size={11} style={{ color: 'var(--ok)' }} /> : <CopyIcon size={11} />}
                          </button>
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    {p.proxy_host ? (
                      <div className="proxy-tag">
                        <span className="proxy-type-badge">{(p.proxy_type || 'HTTP').toUpperCase()}</span>
                        <span>{p.proxy_host}:{p.proxy_port}</span>
                        {p.proxy_country ? <span style={{ color: 'var(--accent)', fontSize: 11 }}>({p.proxy_country})</span> : null}
                      </div>
                    ) : (
                      <span style={{ color: 'var(--text-muted)', fontSize: 12.5 }}>Direct (No Proxy)</span>
                    )}
                  </td>
                  <td>
                    <span className="proxy-type-badge" style={{ color: p.platform === 'ios' || p.platform === 'android' ? 'var(--ok)' : 'var(--text-secondary)' }}>
                      {(p.device_name || p.platform || 'Windows 11').toUpperCase()}
                    </span>
                  </td>
                  <td>
                    <span
                      style={{
                        background: 'rgba(99, 102, 241, 0.1)',
                        border: '1px solid rgba(99, 102, 241, 0.25)',
                        padding: '2px 8px',
                        borderRadius: 4,
                        fontSize: 11.5,
                        color: '#a5b4fc',
                        fontFamily: 'var(--font-mono)',
                      }}
                      title="Fingerprint Seed"
                    >
                      🎲 {p.fingerprint_seed ? String(p.fingerprint_seed).slice(0, 7) + '..' : 'Auto'}
                    </span>
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
                        onClick={() => void openEditModal(p)}
                        title="Edit Profile Settings (Proxy / Fingerprint)"
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

                      <button
                        className="btn-icon"
                        style={{ color: 'var(--danger)' }}
                        onClick={() => void deleteProfilePrompt(p.user_id)}
                        disabled={busy}
                        title="Delete Profile"
                      >
                        <TrashIcon size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* AdsPower-Style Tabbed Profile Modal (Create / Edit) */}
      {modalMode ? (
        <div className="modal-overlay" onClick={() => setModalMode(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{modalMode === 'create' ? 'Create New Profile' : `Edit Profile (${name || profileId})`}</h3>
              <button className="btn-icon" onClick={() => setModalMode(null)}>✕</button>
            </div>

            {/* Modal Tabs Header */}
            <div className="modal-tabs">
              <button
                className={`tab-btn ${modalTab === 'general' ? 'active' : ''}`}
                onClick={() => setModalTab('general')}
              >
                <EditIcon size={14} />
                <span>General Overview</span>
              </button>
              <button
                className={`tab-btn ${modalTab === 'proxy' ? 'active' : ''}`}
                onClick={() => setModalTab('proxy')}
              >
                <ProxiesIcon size={14} />
                <span>Proxy Configuration</span>
              </button>
              <button
                className={`tab-btn ${modalTab === 'fingerprint' ? 'active' : ''}`}
                onClick={() => setModalTab('fingerprint')}
              >
                <FingerprintIcon size={14} />
                <span>Fingerprint &amp; Hardware</span>
              </button>
            </div>

            <div className="modal-body">
              {/* TAB 1: GENERAL */}
              {modalTab === 'general' ? (
                <>
                  <div className="form-group">
                    <label>Profile Name</label>
                    <input
                      placeholder="e.g. MEXC-Account-01"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      autoFocus
                    />
                  </div>

                  <div className="form-group">
                    <label>Group Assignment</label>
                    <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                      <option value="">No Group (Ungrouped)</option>
                      {groups.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name} ({g.profile_count} profiles)
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group">
                    <label>Device Preset</label>
                    <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
                      <option value="">Default Preset (Windows 11 PC)</option>
                      {devices.map((d) => (
                        <option key={d.device_id} value={d.device_id}>
                          {d.name} ({d.platform.toUpperCase()})
                        </option>
                      ))}
                    </select>
                  </div>

                  {deviceId === 'dev_android' ? (
                    <div className="form-group">
                      <label>Phone Model (fixed)</label>
                      <select value={mobileModelId} onChange={(e) => setMobileModelId(e.target.value)}>
                        <option value="">Auto (from seed)</option>
                        {mobilePresets.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name} — Android {m.androidVersion} · {m.gpu}
                          </option>
                        ))}
                      </select>
                      <p className="hint">
                        Pick a specific phone to fix it for this profile (long-lived accounts). "Auto" derives the phone from the seed.
                      </p>
                    </div>
                  ) : null}
                </>
              ) : null}

              {/* TAB 2: PROXY SETTINGS WITH LIVE CHECK */}
              {modalTab === 'proxy' ? (
                <>
                  <div className="form-group">
                    <label>Proxy Mode</label>
                    <div className="mode-selector">
                      <button
                        type="button"
                        className={`mode-btn ${proxyMode === 'none' ? 'active' : ''}`}
                        onClick={() => { setProxyMode('none'); setProxyTestResult(null); }}
                      >
                        Direct (No Proxy)
                      </button>
                      <button
                        type="button"
                        className={`mode-btn ${proxyMode === 'saved' ? 'active' : ''}`}
                        onClick={() => { setProxyMode('saved'); setProxyTestResult(null); }}
                      >
                        Saved Proxy
                      </button>
                      <button
                        type="button"
                        className={`mode-btn ${proxyMode === 'custom' ? 'active' : ''}`}
                        onClick={() => { setProxyMode('custom'); setProxyTestResult(null); }}
                      >
                        Custom Proxy
                      </button>
                    </div>
                  </div>

                  {proxyMode === 'saved' ? (
                    <div className="form-group">
                      <label>Choose Proxy from List</label>
                      <select value={savedProxyId} onChange={(e) => { setSavedProxyId(e.target.value); setProxyTestResult(null); }}>
                        <option value="">Select saved proxy...</option>
                        {proxies.map((p) => (
                          <option key={p.proxy_id} value={p.proxy_id}>
                            {p.type.toUpperCase()}://{p.host}:{p.port} {p.country ? `(${p.country})` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}

                  {proxyMode === 'custom' ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <div className="form-group">
                        <label>Protocol</label>
                        <select value={customProxyType} onChange={(e) => setCustomProxyType(e.target.value as any)}>
                          <option value="socks5">SOCKS5</option>
                          <option value="http">HTTP</option>
                          <option value="https">HTTPS</option>
                          <option value="ssh">SSH Tunnel</option>
                        </select>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
                        <div className="form-group">
                          <label>Host / IP</label>
                          <input
                            placeholder="1.2.3.4 or proxy.example.com"
                            value={customProxyHost}
                            onChange={(e) => setCustomProxyHost(e.target.value)}
                          />
                        </div>
                        <div className="form-group">
                          <label>Port</label>
                          <input
                            placeholder="1080"
                            value={customProxyPort}
                            onChange={(e) => setCustomProxyPort(e.target.value)}
                          />
                        </div>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        <div className="form-group">
                          <label>Username (optional)</label>
                          <input
                            placeholder="Username"
                            value={customProxyUser}
                            onChange={(e) => setCustomProxyUser(e.target.value)}
                          />
                        </div>
                        <div className="form-group">
                          <label>Password (optional)</label>
                          <input
                            type="password"
                            placeholder="Password"
                            value={customProxyPass}
                            onChange={(e) => setCustomProxyPass(e.target.value)}
                          />
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {proxyMode !== 'none' ? (
                    <div style={{ marginTop: 8 }}>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => void testProxyLive()}
                        disabled={proxyTesting}
                      >
                        <RefreshIcon size={14} />
                        <span>{proxyTesting ? 'Testing connection...' : '⚡ Test Proxy Connection'}</span>
                      </button>

                      {proxyTestResult ? (
                        <div className={`proxy-test-box ${proxyTestResult.ok ? 'success' : 'failed'}`}>
                          {proxyTestResult.ok ? (
                            <span>
                              ✓ Connection OK: IP <strong>{proxyTestResult.ip}</strong> ({proxyTestResult.country || 'Unknown'}, {proxyTestResult.timezone || 'UTC'}) • Latency: {proxyTestResult.latencyMs}ms
                            </span>
                          ) : (
                            <span>✕ Proxy check failed: {proxyTestResult.error || 'Connection refused'}</span>
                          )}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </>
              ) : null}

              {/* TAB 3: FINGERPRINT LIVE PREVIEW */}
              {modalTab === 'fingerprint' ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Hardware Fingerprint</label>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => setSeed(Math.floor(Math.random() * 2000000000) + 100000000)}
                      title="Generate new random seed"
                    >
                      <DiceIcon size={14} />
                      <span>Randomize Seed</span>
                    </button>
                  </div>

                  <div className="form-group">
                    <label>Fingerprint Seed (manual)</label>
                    <input
                      type="number"
                      min="1"
                      max="2147483647"
                      placeholder="e.g. 123456789 — same seed = same phone & fingerprint"
                      value={seed || ''}
                      onChange={(e) => setSeed(Number(e.target.value) || 0)}
                    />
                    <p className="hint">
                      Fix the seed to keep the same device &amp; fingerprint across restarts (recommended for long-lived accounts).
                    </p>
                  </div>

                  <div className="fingerprint-grid">
                    <div className="fp-item">
                      <span className="fp-item-label">Fingerprint Seed</span>
                      <span className="fp-item-val">🎲 {seed || 'Auto-generated'}</span>
                    </div>
                    <div className="fp-item">
                      <span className="fp-item-label">Navigator WebDriver</span>
                      <span className="fp-item-val" style={{ color: 'var(--ok)' }}>false (Stealth forced)</span>
                    </div>
                    <div className="fp-item">
                      <span className="fp-item-label">Canvas &amp; Audio Noise</span>
                      <span className="fp-item-val" style={{ color: 'var(--ok)' }}>Active (Per-Seed Hash)</span>
                    </div>
                    <div className="fp-item">
                      <span className="fp-item-label">CPU Cores</span>
                      <span className="fp-item-val">{cores} Logical Cores</span>
                    </div>
                    <div className="fp-item">
                      <span className="fp-item-label">WebGL Renderer</span>
                      <span className="fp-item-val">ANGLE (Intel / NVIDIA Direct3D11)</span>
                    </div>
                    <div className="fp-item">
                      <span className="fp-item-label">WebRTC Protection</span>
                      <span className="fp-item-val" style={{ color: 'var(--ok)' }}>Disabled (Zero IP Leaks)</span>
                    </div>
                  </div>

                  <div className="form-group" style={{ marginTop: 14 }}>
                    <label>Custom User-Agent Override</label>
                    <textarea
                      rows={2}
                      value={userAgent}
                      onChange={(e) => setUserAgent(e.target.value)}
                      style={{ fontSize: 12, fontFamily: 'var(--font-mono)' }}
                    />
                  </div>
                </>
              ) : null}
            </div>

            <div className="modal-footer">
              <button className="btn" onClick={() => setModalMode(null)}>Cancel</button>
              <button className="btn primary" onClick={() => void saveProfileModal()} disabled={busy}>
                {modalMode === 'create' ? 'Create Profile' : 'Save Changes'}
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
                  placeholder="New group name (e.g. TikTok Farm, MEXC Traders)..."
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

      {/* Manage Drawer / Modal for Cookies, Fingerprint Overrides, Extensions */}
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
