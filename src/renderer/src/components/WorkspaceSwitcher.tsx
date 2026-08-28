import { useCallback, useEffect, useState } from 'react';
import { api, type TeamItem } from '../api';
import { useI18n } from '../i18n';

/**
 * Workspace switcher: Personal + every team the device belongs to.
 * The active choice is persisted server-side (settings.activeWorkspace).
 */
export function WorkspaceSwitcher({ active, onChange }: { active: string; onChange: (ws: string) => void }) {
  const { t } = useI18n();
  const [teams, setTeams] = useState<TeamItem[]>([]);

  const load = useCallback(() => {
    api.teamsList()
      .then((res) => {
        if (res.code === 0) setTeams(res.data.list);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    load();
    const iv = window.setInterval(load, 30000);
    return () => window.clearInterval(iv);
  }, [load]);

  const options: Array<{ id: string; label: string }> = [
    { id: 'personal', label: t('Personal') },
    ...teams.filter((tm) => tm.local_status === 'active').map((tm) => ({ id: tm.id, label: tm.name })),
  ];

  return (
    <select
      className="input"
      style={{ fontSize: 12, padding: '4px 8px', margin: '6px 12px', width: 'calc(100% - 24px)' }}
      value={active}
      onChange={(e) => onChange(e.target.value)}
      title={t('Active workspace')}
    >
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  );
}