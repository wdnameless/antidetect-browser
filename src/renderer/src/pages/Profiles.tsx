import { useCallback, useEffect, useState } from 'react';
import {
  api,
  type ProfileListItem,
  type ExtensionItem,
  type GroupItem,
  type ProxyItem,
  type DeviceItem,
  type ProxyTestResult,
  type VaultEntry,
  type TagItem,
  type ProfileTagBinding,
} from '../api';
import { useI18n } from '../i18n';
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
  ProfilesIcon,
  KeyIcon,
} from '../icons';

export function Profiles({ initialGroupId }: { initialGroupId?: string | null } = {}) {
  const { t } = useI18n();
  const [profiles, setProfiles] = useState<ProfileListItem[]>([]);
  const [groups, setGroups] = useState<GroupItem[]>([]);
  const [proxies, setProxies] = useState<ProxyItem[]>([]);
  const [devices, setDevices] = useState<DeviceItem[]>([]);
  const [extensions, setExtensions] = useState<ExtensionItem[]>([]);
  const [mobilePresets, setMobilePresets] = useState<Array<{ id: string; name: string; model: string; androidVersion: string; gpu: string }>>([]);
  const [selectedGroupFilter, setSelectedGroupFilter] = useState<string>(initialGroupId || '');
  const [selectedPlatformFilter, setSelectedPlatformFilter] = useState<string>('');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>('');
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number }>({ top: 0, right: 0 });
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [total, setTotal] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedSeed, setCopiedSeed] = useState<number | null>(null);
  const [endpoint, setEndpoint] = useState<{ id: string; ws: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkTargetGroup, setBulkTargetGroup] = useState<string>('');
  const [error, setError] = useState('');

  // Modal tab: 'general' | 'proxy' | 'fingerprint' | 'vault'
  const [modalTab, setModalTab] = useState<'general' | 'proxy' | 'fingerprint' | 'vault'>('general');

  // Vault tab state (Sprint 2.1)
  const [vaultEntries, setVaultEntries] = useState<VaultEntry[]>([]);
  const [vaultForm, setVaultForm] = useState<{ id: string | null; label: string; login: string; password: string; totp: string; notes: string }>({ id: null, label: '', login: '', password: '', totp: '', notes: '' });
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [copiedValue, setCopiedValue] = useState<string | null>(null);

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
  interface FpForm {
    platform?: string;
    brand?: string;
    brandVersion?: string;
    hardwareConcurrency?: number;
    deviceMemory?: number;
    lang?: string;
    screenWidth?: number;
    screenHeight?: number;
    disableSpoofing?: string[];
  }
  const [fpForm, setFpForm] = useState<FpForm>({});
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

  useEffect(() => {
    if (initialGroupId !== undefined) {
      setSelectedGroupFilter(initialGroupId || '');
    }
  }, [initialGroupId]);

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

  // ---- Tags (Sprint 2.3) ----
  const [tags, setTags] = useState<TagItem[]>([]);
  const [selectedTagFilter, setSelectedTagFilter] = useState<string>('');
  const [profileTagMap, setProfileTagMap] = useState<Record<string, ProfileTagBinding[]>>({});
  const [showTagModal, setShowTagModal] = useState(false);
  const [tagForm, setTagForm] = useState<{ id: string | null; name: string; color: string }>({ id: null, name: '', color: '#6b7280' });

  const loadTags = useCallback(async () => {
    try {
      const res = await api.tagsList();
      if (res.code === 0) setTags(res.data.list);
    } catch { /* ignore */ }
  }, []);

  // Debounce server-side search (300 ms after the last keystroke).
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // Reset to the first page whenever filters/page size change.
  useEffect(() => {
    setPage(1);
  }, [selectedGroupFilter, selectedPlatformFilter, selectedStatusFilter, pageSize, selectedTagFilter]);

  const loadProfiles = useCallback(async () => {
    try {
      const res = await api.list({
        groupId: selectedGroupFilter || undefined,
        page,
        pageSize,
        search: debouncedSearch || undefined,
        platform: selectedPlatformFilter || undefined,
        status: selectedStatusFilter || undefined,
        tagId: selectedTagFilter || undefined,
      });
      if (res.code === 0) {
        setProfiles(res.data.list);
        setTotal(res.data.total);
        // Tag chips for the visible rows (per-profile fetch, parallelized).
        const ids = res.data.list.map((p) => p.user_id);
        const maps = await Promise.all(
          ids.map(async (uid) => {
            const r = await api.profileTags(uid).catch(() => null);
            return [uid, r && r.code === 0 ? r.data.tags : []] as const;
          })
        );
        setProfileTagMap(Object.fromEntries(maps));
      } else {
        setError(res.msg);
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }, [selectedGroupFilter, page, pageSize, debouncedSearch, selectedPlatformFilter, selectedStatusFilter, selectedTagFilter]);

  useEffect(() => {
    void loadProfiles();
    void loadGroups();
    void loadProxies();
    void loadDevices();
    void loadMobilePresets();
    void loadExtensions();
    void loadTags();
  }, [loadProfiles, loadGroups, loadProxies, loadDevices, loadMobilePresets, loadExtensions, loadTags]);

  // Auto-refresh statuses: if the user closes the browser window manually, the
  // backend watchdog marks the profile "closed" — reflect it without a manual reload.
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && !busy) void loadProfiles();
    }, 5000);
    return () => clearInterval(timer);
  }, [loadProfiles, busy]);

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

  const handleDuplicateProfile = async (id: string) => {
    setBusy(true);
    setError('');
    try {
      const res = await api.profileDuplicate(id);
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

  const handleExportProfile = async (id: string, label: string) => {
    setError('');
    try {
      const res = await api.profileExport(id);
      if (res.code === 0) {
        const blob = new Blob([JSON.stringify(res.data.bundle, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `antidetect-profile-${label.replace(/[^a-zA-Z0-9-_]/g, '_')}.json`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        setError(res.msg);
      }
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleImportBundle = async (file: File) => {
    setBusy(true);
    setError('');
    try {
      const text = await file.text();
      const bundle = JSON.parse(text);
      const res = await api.profileImportBundle(bundle);
      if (res.code === 0) {
        await loadProfiles();
      } else {
        setError(`Import failed: ${res.msg}`);
      }
    } catch (err) {
      setError(`Import failed: ${(err as Error).message}`);
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

  // ---- Vault (Sprint 2.1) ----
  const loadVault = useCallback(async (pid: string) => {
    try {
      const res = await api.vaultList(pid);
      if (res.code === 0) setVaultEntries(res.data.list);
    } catch { /* ignore */ }
  }, []);

  const openVaultTab = (pid: string) => {
    setVaultForm({ id: null, label: '', login: '', password: '', totp: '', notes: '' });
    setRevealed({});
    void loadVault(pid);
  };

  const saveVaultEntry = async () => {
    if (!profileId) return;
    setBusy(true);
    setError('');
    try {
      const body = {
        label: vaultForm.label.trim() || undefined,
        login: vaultForm.login.trim() || undefined,
        password: vaultForm.password || undefined,
        totp_secret: vaultForm.totp.trim() || undefined,
        notes: vaultForm.notes.trim() || undefined,
      };
      const res = vaultForm.id
        ? await api.vaultUpdate(profileId, vaultForm.id, body)
        : await api.vaultCreate(profileId, body);
      if (res.code === 0) {
        setVaultForm({ id: null, label: '', login: '', password: '', totp: '', notes: '' });
        await loadVault(profileId);
      } else {
        setError(res.msg);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const editVaultEntry = (e: VaultEntry) => {
    setVaultForm({ id: e.id, label: e.label || '', login: e.login || '', password: '', totp: '', notes: e.notes || '' });
  };

  const deleteVaultEntry = async (entryId: string) => {
    if (!profileId) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.vaultDelete(profileId, entryId);
      if (res.code === 0) await loadVault(profileId);
      else setError(res.msg);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const revealVaultField = async (entry: VaultEntry, field: 'password' | 'totp_secret') => {
    if (!profileId) return;
    const key = `${entry.id}:${field}`;
    if (revealed[key]) {
      // toggle off
      setRevealed((r) => { const n = { ...r }; delete n[key]; return n; });
      return;
    }
    try {
      const res = await api.vaultReveal(profileId, entry.id, field);
      if (res.code === 0) {
        setRevealed((r) => ({ ...r, [key]: res.data.value }));
        setTimeout(() => {
          setRevealed((r) => { const n = { ...r }; delete n[key]; return n; });
        }, 15000);
      } else {
        setError(res.msg);
      }
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const copyVaultValue = (text: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedValue(text);
    setTimeout(() => setCopiedValue(null), 1500);
  };

  // ---- Tag management (Sprint 2.3) ----
  const saveTag = async () => {
    if (!tagForm.name.trim()) return;
    setBusy(true);
    setError('');
    try {
      const res = tagForm.id
        ? await api.tagUpdate(tagForm.id, { name: tagForm.name.trim(), color: tagForm.color })
        : await api.tagCreate(tagForm.name.trim(), tagForm.color);
      if (res.code === 0) {
        setTagForm({ id: null, name: '', color: '#6b7280' });
        await loadTags();
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

  const deleteTagById = async (tagId: string) => {
    if (!confirm('Delete this tag? It will be removed from all profiles.')) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.tagDelete(tagId);
      if (res.code === 0) {
        if (selectedTagFilter === tagId) setSelectedTagFilter('');
        await loadTags();
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
    setFpForm({});
    setExtSel([]);
    if (tab === 'extensions') {
      const res = await api.profileExtensions(id);
      if (res.code === 0) setExtSel(res.data.extension_ids);
    }
    if (tab === 'fingerprint') {
      // Load the current overrides into the structured form.
      const res = await api.profileDetail(id);
      if (res.code === 0) {
        const cfg = (res.data.fingerprint?.config ?? {}) as Record<string, unknown>;
        const screen = cfg.screen as { width?: number; height?: number } | undefined;
        setFpForm({
          platform: typeof cfg.platform === 'string' ? cfg.platform : '',
          brand: typeof cfg.brand === 'string' ? cfg.brand : '',
          brandVersion: typeof cfg.brandVersion === 'string' ? cfg.brandVersion : '',
          hardwareConcurrency: typeof cfg.hardwareConcurrency === 'number' ? cfg.hardwareConcurrency : undefined,
          deviceMemory: typeof cfg.deviceMemory === 'number' ? cfg.deviceMemory : undefined,
          lang: typeof cfg.lang === 'string' ? cfg.lang : '',
          screenWidth: screen?.width,
          screenHeight: screen?.height,
          disableSpoofing:
            typeof cfg.disableSpoofing === 'string' && cfg.disableSpoofing
              ? cfg.disableSpoofing.split(',').map((s) => s.trim()).filter(Boolean)
              : undefined,
        });
      }
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
      // Structured form -> fingerprint config JSON (backend validates ranges).
      const cfg: Record<string, unknown> = {};
      if (fpForm.platform) cfg.platform = fpForm.platform;
      if (fpForm.brand) cfg.brand = fpForm.brand;
      if (fpForm.brandVersion) cfg.brandVersion = fpForm.brandVersion;
      if (fpForm.hardwareConcurrency) cfg.hardwareConcurrency = fpForm.hardwareConcurrency;
      if (fpForm.deviceMemory) cfg.deviceMemory = fpForm.deviceMemory;
      if (fpForm.lang) cfg.lang = fpForm.lang;
      if (fpForm.screenWidth && fpForm.screenHeight) {
        cfg.screen = { width: fpForm.screenWidth, height: fpForm.screenHeight };
      }
      if (fpForm.disableSpoofing?.length) cfg.disableSpoofing = fpForm.disableSpoofing.join(',');
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

  // Filtering (search/platform/status) and pagination are server-side now.
  const filteredProfiles = profiles;

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredProfiles.length && filteredProfiles.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredProfiles.map((p) => p.user_id)));
    }
  };

  const toggleSelectProfile = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const copySeedToClipboard = (seedNum: number | null | undefined) => {
    if (!seedNum) return;
    void navigator.clipboard.writeText(String(seedNum));
    setCopiedSeed(seedNum);
    setTimeout(() => setCopiedSeed(null), 1500);
  };

  // Realistic random Chrome UA matching the bundled kernel (Chrome 148).
  // Platform-consistent: Windows 10/11 or macOS — never mixes (e.g. Mac UA on Windows kernel).
  const generateRandomUa = (): string => {
    const chromeVer = '148.0.0.0';
    const webkit = '537.36';
    const roll = Math.random();
    if (roll < 0.45) {
      // Windows 10 / 11 (both report NT 10.0)
      const variants = [
        `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/${webkit} (KHTML, like Gecko) Chrome/${chromeVer} Safari/${webkit}`,
        `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/${webkit} (KHTML, like Gecko) Chrome/${chromeVer} Safari/${webkit} Edg/${chromeVer}`,
      ];
      return variants[Math.floor(Math.random() * variants.length)];
    }
    if (roll < 0.7) {
      // macOS (platform version in UA is fixed at 10_15_7 by Chrome itself)
      return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/${webkit} (KHTML, like Gecko) Chrome/${chromeVer} Safari/${webkit}`;
    }
    // Linux
    return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/${webkit} (KHTML, like Gecko) Chrome/${chromeVer} Safari/${webkit}`;
  };

  const handleBulkStart = async () => {
    if (selectedIds.size === 0) return;
    setBulkBusy(true);
    setError('');
    try {
      const res = await api.bulkStart(Array.from(selectedIds));
      if (res.code === 0) {
        const failedCount = res.data.failed?.length ?? 0;
        if (failedCount > 0) setError(`Started ${res.data.succeeded.length}, failed ${failedCount}: ${res.data.failed[0].error}`);
        await loadProfiles();
      } else {
        setError(res.msg);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBulkBusy(false);
    }
  };

  const handleBulkStop = async () => {
    if (selectedIds.size === 0) return;
    setBulkBusy(true);
    setError('');
    try {
      const res = await api.bulkStop(Array.from(selectedIds));
      if (res.code === 0) {
        const failedCount = res.data.failed?.length ?? 0;
        if (failedCount > 0) setError(`Stopped ${res.data.succeeded.length}, failed ${failedCount}: ${res.data.failed[0].error}`);
        await loadProfiles();
      } else {
        setError(res.msg);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBulkBusy(false);
    }
  };

  const handleBulkMoveGroup = async () => {
    if (selectedIds.size === 0) return;
    setBulkBusy(true);
    setError('');
    try {
      const res = await api.bulkGroup(Array.from(selectedIds), bulkTargetGroup || null);
      if (res.code === 0) {
        await loadProfiles();
        await loadGroups();
      } else {
        setError(res.msg);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBulkBusy(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    if (!window.confirm(`Are you sure you want to delete ${count} selected profile(s)? This action cannot be undone.`)) {
      return;
    }
    setBulkBusy(true);
    setError('');
    try {
      const res = await api.bulkDelete(Array.from(selectedIds));
      if (res.code === 0) {
        setSelectedIds(new Set());
        const failedCount = res.data.failed?.length ?? 0;
        if (failedCount > 0) setError(`Deleted ${res.data.succeeded.length}, failed ${failedCount}: ${res.data.failed[0].error}`);
        await loadProfiles();
        await loadGroups();
      } else {
        setError(res.msg);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBulkBusy(false);
    }
  };

  return (
    <div>
      {/* Top Action Header */}
      <div className="page-header-actions">
        <div className="header-filters">
          <div className="search-box">
            <SearchIcon size={16} />
            <input
              placeholder={t('Search profile name, ID, or proxy...')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <select
            className="select-input"
            value={selectedGroupFilter}
            onChange={(e) => setSelectedGroupFilter(e.target.value)}
          >
            <option value="">{t('All Groups')} ({groups.reduce((acc, g) => acc + g.profile_count, 0)})</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} ({g.profile_count})
              </option>
            ))}
          </select>

          <select
            className="select-input"
            value={selectedPlatformFilter}
            onChange={(e) => setSelectedPlatformFilter(e.target.value)}
          >
            <option value="">{t('All Platforms')}</option>
            <option value="windows">{t('Windows')}</option>
            <option value="macos">{t('macOS')}</option>
            <option value="android">{t('Android')}</option>
            <option value="ios">{t('iOS')}</option>
            <option value="linux">{t('Linux')}</option>
          </select>

          <select
            className="select-input"
            value={selectedStatusFilter}
            onChange={(e) => setSelectedStatusFilter(e.target.value)}
          >
            <option value="">{t('All Statuses')}</option>
            <option value="running">{t('Running')}</option>
            <option value="closed">{t('Closed')}</option>
          </select>

          <select
            className="select-input"
            value={selectedTagFilter}
            onChange={(e) => setSelectedTagFilter(e.target.value)}
          >
            <option value="">{t('All Tags')}</option>
            {tags.map((tg) => (
              <option key={tg.id} value={tg.id}>
                {tg.name} ({tg.profile_count})
              </option>
            ))}
          </select>
        </div>

        <div className="header-btn-group">
          <button className="btn" onClick={() => setShowGroupModal(true)}>
            <FolderIcon size={14} />
            <span>Groups</span>
          </button>
          <button className="btn" onClick={() => { setTagForm({ id: null, name: '', color: '#6b7280' }); setShowTagModal(true); }}>
            <ProxiesIcon size={14} />
            <span>Tags</span>
          </button>
          <button className="btn" onClick={() => setShowBatch(true)}>
            {t('Batch Create')}
          </button>
          <button className="btn" onClick={() => setShowCsv(true)}>
            {t('Import CSV')}
          </button>
          <button className="btn" onClick={() => window.open(api.exportCsvUrl(), '_blank')} title={t('Export all profiles to CSV')}>
            {t('Export CSV')}
          </button>
          <button className="btn" onClick={() => document.getElementById('import-bundle-input')?.click()} disabled={busy} title={t('Import a profile bundle (.json) exported from this or another machine')}>
            {t('Import Bundle')}
          </button>
          <input
            id="import-bundle-input"
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleImportBundle(f);
              e.target.value = '';
            }}
          />
          <button className="btn primary" onClick={openCreateModal} disabled={busy}>
            <PlusIcon size={15} />
            <span>{t('New Profile')}</span>
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
              <th style={{ width: 40, textAlign: 'center' }}>
                <input
                  type="checkbox"
                  checked={selectedIds.size === filteredProfiles.length && filteredProfiles.length > 0}
                  onChange={toggleSelectAll}
                  style={{ cursor: 'pointer' }}
                />
              </th>
              <th style={{ width: '22%' }}>{t('Profile Name')}</th>
              <th style={{ width: '20%' }}>{t('Proxy')}</th>
              <th style={{ width: '15%' }}>{t('Device / OS')}</th>
              <th style={{ width: '15%' }}>{t('Fingerprint')}</th>
              <th style={{ width: '10%' }}>{t('Status')}</th>
              <th style={{ width: '18%', textAlign: 'right' }}>{t('Actions')}</th>
            </tr>
          </thead>
          <tbody>
            {filteredProfiles.length === 0 ? (
              <tr>
                <td colSpan={7} className="empty-cell">
                  {searchQuery ? (
                    t('No profiles match your search criteria.')
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '24px 0' }}>
                      <ProfilesIcon size={32} style={{ opacity: 0.3 }} />
                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)' }}>
                        {t('No profiles yet')}
                      </div>
                      <p style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 420, margin: 0 }}>
                        {t('Create your first browser profile — each profile gets a unique fingerprint, device, and proxy. Click')} <strong>{t('+ New Profile')}</strong> {t('to get started.')}
                      </p>
                    </div>
                  )}
                </td>
              </tr>
            ) : (
              filteredProfiles.map((p) => (
                <tr key={p.user_id} className={selectedIds.has(p.user_id) ? 'selected-row' : ''}>
                  <td style={{ textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(p.user_id)}
                      onChange={() => toggleSelectProfile(p.user_id)}
                      style={{ cursor: 'pointer' }}
                    />
                  </td>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <strong style={{ fontSize: 14, color: '#f3f4f6' }}>{p.name || 'Unnamed Profile'}</strong>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span className="group-tag">
                          <FolderIcon size={10} />
                          {getGroupName(p.group_id)}
                        </span>
                        {(profileTagMap[p.user_id] || []).map((tg) => (
                          <span
                            key={tg.tag_id}
                            className="group-tag"
                            style={{ color: tg.color || 'var(--text-secondary)', borderColor: `${tg.color || 'var(--border)'}66` }}
                            title={tg.name}
                          >
                            #{tg.name}
                          </span>
                        ))}
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
                      {(p.platform || 'windows').toUpperCase()}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          fontSize: 12,
                          fontWeight: 600,
                          color: 'var(--text)',
                        }}
                      >
                        {p.device_name ? (
                          <span>{p.device_name}</span>
                        ) : (
                          <span>
                            {p.platform === 'android' ? 'Android' : p.platform === 'ios' ? 'iOS' : p.platform === 'macos' ? 'macOS' : 'Windows'}
                          </span>
                        )}
                      </span>
                      <span
                        style={{
                          fontSize: 11,
                          color: copiedSeed === p.fingerprint_seed ? 'var(--ok)' : 'var(--text-muted)',
                          fontFamily: 'var(--font-mono)',
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                        }}
                        onClick={() => copySeedToClipboard(p.fingerprint_seed)}
                        title="Click to copy full Seed"
                      >
                        {copiedSeed === p.fingerprint_seed ? (
                          '✓ Copied!'
                        ) : (
                          <>{p.fingerprint_seed ? String(p.fingerprint_seed).slice(0, 8) + '..' : 'auto'}</>
                        )}
                      </span>
                    </div>
                  </td>
                  <td>
                    <span className={`badge ${p.status}`}>
                      {p.status === 'running' ? t('Running') : t('Closed')}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, position: 'relative' }}>
                      {p.status === 'running' ? (
                        <button
                          type="button"
                          className="btn-icon stop-btn"
                          onClick={() => void stop(p.user_id)}
                          disabled={busy}
                          title="Stop Profile"
                        >
                          <StopIcon size={13} />
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn-icon play-btn"
                          onClick={() => void start(p.user_id)}
                          disabled={busy}
                          title="Start Profile"
                        >
                          <PlayIcon size={13} />
                        </button>
                      )}

                      <button
                        type="button"
                        className="btn-icon"
                        onClick={() => void openEditModal(p)}
                        disabled={busy}
                        title="Edit Profile Settings (Proxy / Fingerprint)"
                      >
                        <EditIcon size={14} />
                      </button>

                      {/* Kebab Action Menu */}
                      <div style={{ position: 'relative' }}>
                        <button
                          type="button"
                          className={`btn-icon ${activeMenuId === p.user_id ? 'active' : ''}`}
                          onClick={(e) => {
                            if (activeMenuId === p.user_id) {
                              setActiveMenuId(null);
                              return;
                            }
                            // Position the menu with `fixed` coordinates from the button so
                            // the table container's overflow can never clip it. Flip above
                            // the button when there is not enough room below.
                            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                            const MENU_H = 270;
                            const top =
                              rect.bottom + MENU_H > window.innerHeight
                                ? Math.max(8, rect.top - MENU_H - 6)
                                : rect.bottom + 6;
                            const right = Math.max(8, window.innerWidth - rect.right);
                            setMenuPos({ top, right });
                            setActiveMenuId(p.user_id);
                          }}
                          title="More actions"
                          style={{ fontWeight: 800, fontSize: 13, padding: '0 6px' }}
                        >
                          ⋯
                        </button>

                        {activeMenuId === p.user_id ? (
                          <>
                            <div
                              style={{ position: 'fixed', inset: 0, zIndex: 99 }}
                              onClick={() => setActiveMenuId(null)}
                            />
                            <div
                              style={{
                                position: 'fixed',
                                right: menuPos.right,
                                top: menuPos.top,
                                zIndex: 100,
                                minWidth: 175,
                                background: 'var(--panel)',
                                border: '1px solid var(--border)',
                                borderRadius: 6,
                                boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                                padding: '4px 0',
                                display: 'flex',
                                flexDirection: 'column',
                              }}
                            >
                              <button
                                type="button"
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 8,
                                  padding: '7px 12px',
                                  background: 'transparent',
                                  border: 'none',
                                  color: 'var(--text)',
                                  fontSize: 12,
                                  cursor: 'pointer',
                                  textAlign: 'left',
                                  width: '100%',
                                }}
                                onClick={() => {
                                  setActiveMenuId(null);
                                  void handleDuplicateProfile(p.user_id);
                                }}
                              >
                                <CopyIcon size={13} />
                                <span>Duplicate Profile</span>
                              </button>

                              <button
                                type="button"
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 8,
                                  padding: '7px 12px',
                                  background: 'transparent',
                                  border: 'none',
                                  color: 'var(--text)',
                                  fontSize: 12,
                                  cursor: 'pointer',
                                  textAlign: 'left',
                                  width: '100%',
                                }}
                                onClick={() => {
                                  setActiveMenuId(null);
                                  void handleExportProfile(p.user_id, p.name || p.user_id);
                                }}
                              >
                                <CopyIcon size={13} />
                                <span>Export Profile (bundle)</span>
                              </button>

                              <button
                                type="button"
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 8,
                                  padding: '7px 12px',
                                  background: 'transparent',
                                  border: 'none',
                                  color: 'var(--text)',
                                  fontSize: 12,
                                  cursor: 'pointer',
                                  textAlign: 'left',
                                  width: '100%',
                                }}
                                onClick={() => {
                                  setActiveMenuId(null);
                                  void handleRandomizeFingerprint(p.user_id);
                                }}
                              >
                                <DiceIcon size={13} />
                                <span>Randomize Seed</span>
                              </button>

                              <button
                                type="button"
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 8,
                                  padding: '7px 12px',
                                  background: 'transparent',
                                  border: 'none',
                                  color: 'var(--text)',
                                  fontSize: 12,
                                  cursor: 'pointer',
                                  textAlign: 'left',
                                  width: '100%',
                                }}
                                onClick={() => {
                                  setActiveMenuId(null);
                                  void openManage(p.user_id, 'cookies');
                                }}
                              >
                                <CookieIcon size={13} />
                                <span>Manage Cookies</span>
                              </button>

                              <button
                                type="button"
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 8,
                                  padding: '7px 12px',
                                  background: 'transparent',
                                  border: 'none',
                                  color: 'var(--text)',
                                  fontSize: 12,
                                  cursor: 'pointer',
                                  textAlign: 'left',
                                  width: '100%',
                                }}
                                onClick={() => {
                                  setActiveMenuId(null);
                                  void openManage(p.user_id, 'fingerprint');
                                }}
                              >
                                <FingerprintIcon size={13} />
                                <span>Fingerprint Config</span>
                              </button>

                              <button
                                type="button"
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 8,
                                  padding: '7px 12px',
                                  background: 'transparent',
                                  border: 'none',
                                  color: 'var(--text)',
                                  fontSize: 12,
                                  cursor: 'pointer',
                                  textAlign: 'left',
                                  width: '100%',
                                }}
                                onClick={() => {
                                  setActiveMenuId(null);
                                  void openManage(p.user_id, 'extensions');
                                }}
                              >
                                <ExtensionsIcon size={13} />
                                <span>Bind Extensions</span>
                              </button>

                              <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />

                              <button
                                type="button"
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 8,
                                  padding: '7px 12px',
                                  background: 'transparent',
                                  border: 'none',
                                  color: 'var(--danger)',
                                  fontSize: 12,
                                  cursor: 'pointer',
                                  textAlign: 'left',
                                  width: '100%',
                                }}
                                onClick={() => {
                                  setActiveMenuId(null);
                                  void deleteProfilePrompt(p.user_id);
                                }}
                              >
                                <TrashIcon size={13} />
                                <span>Delete Profile</span>
                              </button>
                            </div>
                          </>
                        ) : null}
                      </div>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {total > 0 ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: 14,
            padding: '0 4px',
            flexWrap: 'wrap',
            gap: 10,
          }}
        >
          <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
            {t('Total')}: <strong style={{ color: 'var(--text)' }}>{total}</strong> {total === 1 ? t('profile') : t('profiles')}
          </span>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <select
              className="select-input"
              style={{ fontSize: 12, padding: '4px 8px' }}
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
            >
              <option value={50}>{t('50 / page')}</option>
              <option value={100}>{t('100 / page')}</option>
              <option value={200}>{t('200 / page')}</option>
            </select>

            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
            >
              {t('← Prev')}
            </button>
            <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
              {t('Page')} {page} {t('of')} {Math.max(1, Math.ceil(total / pageSize))}
            </span>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setPage((p) => (p * pageSize < total ? p + 1 : p))}
              disabled={page * pageSize >= total}
            >
              {t('Next →')}
            </button>
          </div>
        </div>
      ) : null}

      {/* Floating Bulk Actions Bar */}
      {selectedIds.size > 0 ? (
        <div
          style={{
            position: 'fixed',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'var(--panel)',
            border: '1px solid var(--accent)',
            boxShadow: '0 12px 36px rgba(0,0,0,0.6)',
            borderRadius: 10,
            padding: '10px 18px',
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            zIndex: 900,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
            <span
              style={{
                background: 'var(--accent)',
                color: '#fff',
                borderRadius: '50%',
                width: 22,
                height: 22,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 11.5,
              }}
            >
              {selectedIds.size}
            </span>
            <span>{t('Selected')}</span>
          </div>

          <div style={{ height: 18, width: 1, background: 'var(--border)' }} />

          <button
            type="button"
            className="btn btn-sm"
            onClick={() => void handleBulkStart()}
            disabled={bulkBusy}
            title={t('Start selected profiles')}
            style={{ background: 'rgba(255, 255, 255, 0.08)', color: 'var(--text)', borderColor: 'rgba(255, 255, 255, 0.22)' }}
          >
            <PlayIcon size={12} />
            <span>{t('Start')}</span>
          </button>

          <button
            type="button"
            className="btn btn-sm"
            onClick={() => void handleBulkStop()}
            disabled={bulkBusy}
            title={t('Stop selected profiles')}
            style={{ background: 'rgba(255, 255, 255, 0.08)', color: 'var(--text-secondary)', borderColor: 'rgba(255, 255, 255, 0.22)' }}
          >
            <StopIcon size={12} />
            <span>{t('Stop')}</span>
          </button>

          <div style={{ height: 18, width: 1, background: 'var(--border)' }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <select
              className="select-input"
              style={{ fontSize: 12, padding: '4px 8px' }}
              value={bulkTargetGroup}
              onChange={(e) => setBulkTargetGroup(e.target.value)}
              disabled={bulkBusy}
            >
              <option value="">{t('Move to Group...')}</option>
              <option value="">{t('(No Group / Ungrouped)')}</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => void handleBulkMoveGroup()}
              disabled={bulkBusy}
            >
              {t('Apply')}
            </button>
          </div>

          <div style={{ height: 18, width: 1, background: 'var(--border)' }} />

          <button
            type="button"
            className="btn btn-sm btn-danger"
            onClick={() => void handleBulkDelete()}
            disabled={bulkBusy}
            title={t('Delete selected profiles')}
          >
            <TrashIcon size={12} />
            <span>{t('Delete')}</span>
          </button>

          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setSelectedIds(new Set())}
            disabled={bulkBusy}
            title={t('Deselect all')}
            style={{ color: 'var(--text-muted)' }}
          >
            ✕
          </button>
        </div>
      ) : null}

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
              {modalMode === 'edit' ? (
                <button
                  className={`tab-btn ${modalTab === 'vault' ? 'active' : ''}`}
                  onClick={() => { setModalTab('vault'); openVaultTab(profileId); }}
                >
                  <KeyIcon size={14} />
                  <span>Vault</span>
                </button>
              ) : null}
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

              {/* TAB: VAULT (Sprint 2.1) — credentials per profile */}
              {modalTab === 'vault' && modalMode === 'edit' ? (
                <>
                  <div className="form-group">
                    <label>{vaultForm.id ? t('Edit entry') : t('Add entry')}</label>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <input
                        placeholder={t('Label (e.g. main account)')}
                        value={vaultForm.label}
                        onChange={(e) => setVaultForm({ ...vaultForm, label: e.target.value })}
                      />
                      <input
                        placeholder={t('Login')}
                        value={vaultForm.login}
                        onChange={(e) => setVaultForm({ ...vaultForm, login: e.target.value })}
                      />
                      <input
                        type="password"
                        placeholder={t('Password')}
                        value={vaultForm.password}
                        onChange={(e) => setVaultForm({ ...vaultForm, password: e.target.value })}
                      />
                      <input
                        placeholder={t('TOTP secret (optional)')}
                        value={vaultForm.totp}
                        onChange={(e) => setVaultForm({ ...vaultForm, totp: e.target.value })}
                      />
                    </div>
                    <input
                      style={{ marginTop: 8 }}
                      placeholder={t('Notes')}
                      value={vaultForm.notes}
                      onChange={(e) => setVaultForm({ ...vaultForm, notes: e.target.value })}
                    />
                    <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                      <button className="btn primary" onClick={() => void saveVaultEntry()} disabled={busy}>
                        {vaultForm.id ? t('Save') : t('Add')}
                      </button>
                      {vaultForm.id ? (
                        <button className="btn" onClick={() => setVaultForm({ id: null, label: '', login: '', password: '', totp: '', notes: '' })}>
                          {t('Cancel')}
                        </button>
                      ) : null}
                    </div>
                  </div>

                  <div className="table-container" style={{ marginTop: 10 }}>
                    <table className="table">
                      <thead>
                        <tr>
                          <th>{t('Label')}</th>
                          <th>{t('Login')}</th>
                          <th>{t('Password')}</th>
                          <th style={{ width: '20%', textAlign: 'right' }}>{t('Actions')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {vaultEntries.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="empty-cell" style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                              {t('No saved credentials yet. Passwords are encrypted (AES-256-GCM) and never leave this machine.')}
                            </td>
                          </tr>
                        ) : (
                          vaultEntries.map((e) => {
                            const pwKey = `${e.id}:password`;
                            const totpKey = `${e.id}:totp_secret`;
                            return (
                              <tr key={e.id}>
                                <td style={{ fontSize: 12.5 }}>{e.label || '—'}</td>
                                <td style={{ fontSize: 12.5 }}>{e.login || '—'}</td>
                                <td style={{ fontSize: 12.5 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                    <code style={{ fontFamily: 'var(--font-mono)' }}>
                                      {revealed[pwKey] || (e.has_password ? '******' : '—')}
                                    </code>
                                    {e.has_password ? (
                                      <>
                                        <button
                                          className="btn-icon"
                                          style={{ padding: '2px 6px' }}
                                          onClick={() => void revealVaultField(e, 'password')}
                                          title={t('Reveal / hide (15s)')}
                                        >
                                          <KeyIcon size={11} />
                                        </button>
                                        <button
                                          className="btn-icon"
                                          style={{ padding: '2px 6px' }}
                                          onClick={() => revealed[pwKey] && copyVaultValue(revealed[pwKey])}
                                          disabled={!revealed[pwKey]}
                                          title={t('Copy value')}
                                        >
                                          {copiedValue && revealed[pwKey] === copiedValue ? <CheckIcon size={11} style={{ color: 'var(--ok)' }} /> : <CopyIcon size={11} />}
                                        </button>
                                      </>
                                    ) : null}
                                    {e.has_totp ? (
                                      <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }} title={revealed[totpKey] || t('TOTP secret stored')}>
                                        {revealed[totpKey] ? `TOTP: ${revealed[totpKey]}` : 'TOTP: ******'}
                                      </code>
                                    ) : null}
                                  </div>
                                </td>
                                <td>
                                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                                    <button className="btn btn-sm" onClick={() => editVaultEntry(e)} disabled={busy}>
                                      {t('Edit')}
                                    </button>
                                    <button className="btn btn-sm btn-danger" onClick={() => void deleteVaultEntry(e.id)} disabled={busy}>
                                      <TrashIcon size={11} />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
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
                      <span className="fp-item-val">{seed || 'Auto-generated'}</span>
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
                      <span className="fp-item-label">GPU (WebGL)</span>
                      <span className="fp-item-val">Intel / NVIDIA (Direct3D11)</span>
                    </div>
                    <div className="fp-item">
                      <span className="fp-item-label">WebRTC Protection</span>
                      <span className="fp-item-val" style={{ color: 'var(--ok)' }}>Disabled (Zero IP Leaks)</span>
                    </div>
                  </div>

                  <div className="form-group" style={{ marginTop: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <label>{t('Custom User-Agent Override')}</label>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => setUserAgent(generateRandomUa())}
                        title={t('Generate a realistic random Chrome UA (matches the kernel version)')}
                      >
                        <DiceIcon size={12} />
                        <span>{t('Randomize UA')}</span>
                      </button>
                    </div>
                    <textarea
                      rows={2}
                      value={userAgent}
                      onChange={(e) => setUserAgent(e.target.value)}
                      placeholder={t('Empty = kernel default UA (recommended)')}
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

      {/* Tag Management Modal (Sprint 2.3) */}
      {showTagModal ? (
        <div className="modal-overlay" onClick={() => setShowTagModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <div className="modal-header">
              <h3>{t('Manage Tags')}</h3>
              <button className="btn-icon" onClick={() => setShowTagModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>{tagForm.id ? t('Edit tag') : t('Create tag')}</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    style={{ flex: 1 }}
                    placeholder={t('Tag name')}
                    value={tagForm.name}
                    onChange={(e) => setTagForm({ ...tagForm, name: e.target.value })}
                  />
                  <input
                    type="color"
                    value={tagForm.color}
                    onChange={(e) => setTagForm({ ...tagForm, color: e.target.value })}
                    style={{ width: 42, height: 34, padding: 2, cursor: 'pointer' }}
                  />
                  <button className="btn primary" onClick={() => void saveTag()} disabled={busy || !tagForm.name.trim()}>
                    {tagForm.id ? t('Save') : t('Create')}
                  </button>
                  {tagForm.id ? (
                    <button className="btn" onClick={() => setTagForm({ id: null, name: '', color: '#6b7280' })}>
                      {t('Cancel')}
                    </button>
                  ) : null}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                {tags.map((tg) => (
                  <div
                    key={tg.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '7px 10px',
                      border: '1px solid var(--border)',
                      borderRadius: 6,
                    }}
                  >
                    <span style={{ width: 12, height: 12, borderRadius: 3, background: tg.color || 'var(--border)', display: 'inline-block' }} />
                    <span style={{ fontSize: 13, flex: 1 }}>
                      {tg.name} <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>({tg.profile_count})</span>
                    </span>
                    <button
                      className="btn btn-sm"
                      onClick={() => setTagForm({ id: tg.id, name: tg.name, color: tg.color || '#6b7280' })}
                      disabled={busy}
                    >
                      {t('Edit')}
                    </button>
                    <button className="btn btn-sm btn-danger" onClick={() => void deleteTagById(tg.id)} disabled={busy}>
                      <TrashIcon size={11} />
                    </button>
                  </div>
                ))}
                {tags.length === 0 ? <p className="hint">{t('No tags yet — create one above.')}</p> : null}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowTagModal(false)}>Close</button>
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
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <p className="hint" style={{ margin: 0 }}>
                    {t('Per-profile fingerprint overrides (like AdsPower). Leave empty for defaults.')}
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label>{t('Platform')}</label>
                      <select
                        value={fpForm.platform}
                        onChange={(e) => setFpForm({ ...fpForm, platform: e.target.value })}
                      >
                        <option value="">{t('Default (Windows)')}</option>
                        <option value="windows">Windows</option>
                        <option value="macos">macOS</option>
                        <option value="linux">Linux</option>
                      </select>
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label>{t('Browser Brand')}</label>
                      <select
                        value={fpForm.brand}
                        onChange={(e) => setFpForm({ ...fpForm, brand: e.target.value })}
                      >
                        <option value="">{t('Default (Chrome)')}</option>
                        <option value="Chrome">Chrome</option>
                        <option value="Edge">Edge</option>
                      </select>
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label>{t('CPU Cores')}</label>
                      <input
                        type="number"
                        min={1}
                        max={32}
                        placeholder={t('e.g. 8')}
                        value={fpForm.hardwareConcurrency ?? ''}
                        onChange={(e) =>
                          setFpForm({ ...fpForm, hardwareConcurrency: e.target.value ? Number(e.target.value) : undefined })
                        }
                      />
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label>{t('RAM (GB) — navigator.deviceMemory')}</label>
                      <select
                        value={fpForm.deviceMemory ?? ''}
                        onChange={(e) =>
                          setFpForm({ ...fpForm, deviceMemory: e.target.value ? Number(e.target.value) : undefined })
                        }
                      >
                        <option value="">{t('Default (8 GB)')}</option>
                        <option value={2}>2 GB</option>
                        <option value={4}>4 GB</option>
                        <option value={8}>8 GB</option>
                        <option value={16}>16 GB</option>
                        <option value={32}>32 GB</option>
                      </select>
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label>{t('Language (Accept-Language)')}</label>
                      <input
                        placeholder="en-US"
                        value={fpForm.lang ?? ''}
                        onChange={(e) => setFpForm({ ...fpForm, lang: e.target.value || undefined })}
                      />
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label>{t('Brand Version')}</label>
                      <input
                        placeholder="148.0.0.0"
                        value={fpForm.brandVersion ?? ''}
                        onChange={(e) => setFpForm({ ...fpForm, brandVersion: e.target.value || undefined })}
                      />
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label>{t('Screen Width')}</label>
                      <input
                        type="number"
                        min={320}
                        max={7680}
                        placeholder={t('native')}
                        value={fpForm.screenWidth ?? ''}
                        onChange={(e) =>
                          setFpForm({ ...fpForm, screenWidth: e.target.value ? Number(e.target.value) : undefined })
                        }
                      />
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label>{t('Screen Height')}</label>
                      <input
                        type="number"
                        min={240}
                        max={4320}
                        placeholder={t('native')}
                        value={fpForm.screenHeight ?? ''}
                        onChange={(e) =>
                          setFpForm({ ...fpForm, screenHeight: e.target.value ? Number(e.target.value) : undefined })
                        }
                      />
                    </div>
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label>{t('Disable Spoofing (advanced — pass-through to real values)')}</label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, fontSize: 13, color: 'var(--text-secondary)' }}>
                      {(['canvas', 'webgl', 'audio', 'clientrects'] as const).map((k) => (
                        <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', textTransform: 'capitalize' }}>
                          <input
                            type="checkbox"
                            checked={fpForm.disableSpoofing?.includes(k) ?? false}
                            onChange={(e) => {
                              const cur = new Set(fpForm.disableSpoofing ?? []);
                              if (e.target.checked) cur.add(k);
                              else cur.delete(k);
                              setFpForm({ ...fpForm, disableSpoofing: cur.size ? Array.from(cur) : undefined });
                            }}
                          />
                          {k}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
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
