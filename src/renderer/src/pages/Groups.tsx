import { useCallback, useEffect, useState } from 'react';
import { api, type GroupItem, type ProfileListItem } from '../api';
import { FolderIcon, PlusIcon, EditIcon, TrashIcon, SearchIcon, ProfilesIcon } from '../icons';
import { useI18n } from '../i18n';

export function Groups({ onSelectGroup }: { onSelectGroup?: (groupId: string) => void }) {
  const { t } = useI18n();
  const [groups, setGroups] = useState<GroupItem[]>([]);
  const [profiles, setProfiles] = useState<ProfileListItem[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');

  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editGroupName, setEditGroupName] = useState('');

  const loadData = useCallback(async () => {
    try {
      setError('');
      const [gRes, pRes] = await Promise.all([api.groupList(), api.list()]);
      if (gRes.code === 0) setGroups(gRes.data.list);
      if (pRes.code === 0) setProfiles(pRes.data.list);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGroupName.trim()) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.groupCreate(newGroupName.trim());
      if (res.code === 0) {
        setNewGroupName('');
        setShowCreateModal(false);
        await loadData();
      } else {
        setError(res.msg);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleUpdateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingGroupId || !editGroupName.trim()) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.groupUpdate(editingGroupId, editGroupName.trim());
      if (res.code === 0) {
        setEditingGroupId(null);
        setEditGroupName('');
        await loadData();
      } else {
        setError(res.msg);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteGroup = async (groupId: string, groupName: string) => {
    const count = profiles.filter((p) => p.group_id === groupId).length;
    const msg = count > 0
      ? `Delete group "${groupName}"? ${count} profile(s) will be unassigned from this group.`
      : `Delete group "${groupName}"?`;
    if (!window.confirm(msg)) return;

    setBusy(true);
    setError('');
    try {
      const res = await api.groupDelete(groupId);
      if (res.code === 0) {
        await loadData();
      } else {
        setError(res.msg);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const filteredGroups = groups.filter((g) =>
    g.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <div className="page-header-actions">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <FolderIcon size={22} style={{ color: 'var(--accent)' }} />
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 700 }}>{t('Profile Groups')}</h2>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
              {t('Organize your browser profiles by projects, clients, or account categories.')}
            </p>
          </div>
        </div>

        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setShowCreateModal(true)}
          disabled={busy}
        >
          <PlusIcon size={14} />
          <span>{t('New Group')}</span>
        </button>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}

      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
        <div className="search-box" style={{ maxWidth: 320, width: '100%' }}>
          <SearchIcon size={14} />
          <input
            type="text"
            placeholder={t('Search groups...')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 40 }}>#</th>
              <th>{t('Group Name')}</th>
              <th style={{ width: 140 }}>{t('Profiles Count')}</th>
              <th style={{ width: 180 }}>{t('Group ID')}</th>
              <th style={{ width: 180, textAlign: 'right' }}>{t('Actions')}</th>
            </tr>
          </thead>
          <tbody>
            {filteredGroups.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', padding: '40px 16px', color: 'var(--text-muted)' }}>
                  {groups.length === 0 ? (
                    <div>
                      <FolderIcon size={32} style={{ opacity: 0.3, marginBottom: 8 }} />
                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)' }}>{t('No groups yet')}</div>
                      <p style={{ fontSize: 12, marginTop: 4 }}>
                        {t('Create groups to keep dozens or hundreds of profiles neatly organized.')}
                      </p>
                      <button
                        type="button"
                        className="btn btn-primary"
                        style={{ marginTop: 12 }}
                        onClick={() => setShowCreateModal(true)}
                      >
                        <PlusIcon size={13} />
                        <span>{t('Create First Group')}</span>
                      </button>
                    </div>
                  ) : (
                    t('No groups matching search')
                  )}
                </td>
              </tr>
            ) : (
              filteredGroups.map((g, idx) => {
                const count = profiles.filter((p) => p.group_id === g.id).length;
                return (
                  <tr key={g.id}>
                    <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{idx + 1}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ color: 'var(--accent)' }}>
                          <FolderIcon size={16} />
                        </span>
                        <strong style={{ fontSize: 13.5, color: 'var(--text)' }}>{g.name}</strong>
                      </div>
                    </td>
                    <td>
                      <span className="badge badge-gray" style={{ fontWeight: 600 }}>
                        {count} {count === 1 ? t('profile') : t('profiles')}
                      </span>
                    </td>
                    <td>
                      <span style={{ fontSize: 11.5, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                        {g.id}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                        {onSelectGroup ? (
                          <button
                            type="button"
                            className="btn btn-sm"
                            title={t('View profiles in this group')}
                            onClick={() => onSelectGroup(g.id)}
                          >
                            <ProfilesIcon size={12} />
                            <span>Profiles</span>
                          </button>
                        ) : null}

                        <button
                          type="button"
                          className="btn btn-sm"
                          title={t('Rename group')}
                          onClick={() => {
                            setEditingGroupId(g.id);
                            setEditGroupName(g.name);
                          }}
                        >
                          <EditIcon size={12} />
                        </button>

                        <button
                          type="button"
                          className="btn btn-sm btn-danger"
                          title={t('Delete group')}
                          onClick={() => void handleDeleteGroup(g.id, g.name)}
                        >
                          <TrashIcon size={12} />
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

      {/* Modal: Create Group */}
      {showCreateModal ? (
        <div className="modal-backdrop">
          <div className="modal" style={{ maxWidth: 420 }}>
            <div className="modal-header">
              <h3>{t('Create New Group')}</h3>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setShowCreateModal(false)}
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleCreateGroup}>
              <div className="modal-body">
                <div className="form-group">
                  <label>{t('Group Name')} *</label>
                  <input
                    type="text"
                    required
                    autoFocus
                    placeholder="e.g. TikTok Farm, Google Ads, Crypto Accounts"
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn"
                  onClick={() => setShowCreateModal(false)}
                  disabled={busy}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={busy || !newGroupName.trim()}
                >
                  {busy ? t('Creating...') : t('Create Group')}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* Modal: Edit Group */}
      {editingGroupId ? (
        <div className="modal-backdrop">
          <div className="modal" style={{ maxWidth: 420 }}>
            <div className="modal-header">
              <h3>{t('Rename Group')}</h3>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setEditingGroupId(null)}
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleUpdateGroup}>
              <div className="modal-body">
                <div className="form-group">
                  <label>{t('Group Name')} *</label>
                  <input
                    type="text"
                    required
                    autoFocus
                    value={editGroupName}
                    onChange={(e) => setEditGroupName(e.target.value)}
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn"
                  onClick={() => setEditingGroupId(null)}
                  disabled={busy}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={busy || !editGroupName.trim()}
                >
                  {busy ? t('Saving...') : t('Save Changes')}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
