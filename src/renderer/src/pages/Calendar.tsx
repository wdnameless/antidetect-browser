import { useEffect, useMemo, useState } from 'react';
import { api, TriggerItem, TaskGroupItem } from '../api';
import { nextOccurrences } from '../cronProjection';
import { useI18n } from '../i18n';

interface DayMarker {
  date: Date;
  triggerId: string;
  groupName: string;
  timeLabel: string;
}

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function monthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startOffset = (first.getDay() + 6) % 7; // Monday-first
  const cells: Date[] = [];
  for (let i = 0; i < startOffset; i++) cells.push(new Date(year, month, -i));
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) {
    const last = cells[cells.length - 1];
    cells.push(new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1));
  }
  return cells;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function Calendar() {
  const i18n = useI18n();
  const [cursor, setCursor] = useState(() => new Date());
  const [triggers, setTriggers] = useState<TriggerItem[]>([]);
  const [groups, setGroups] = useState<TaskGroupItem[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [trig, grp] = await Promise.all([api.triggersList(), api.taskGroupsList()]);
        setTriggers((trig.data?.list ?? []) as TriggerItem[]);
        setGroups((grp.data?.list ?? []) as TaskGroupItem[]);
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  }, []);

  const scheduled = useMemo(
    () => triggers.filter((t) => t.type === 'schedule' && typeof t.schedule === 'string' && t.schedule),
    [triggers]
  );

  const markers = useMemo(() => {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const first = new Date(year, month, 1, 0, 0, 0);
    const last = new Date(year, month + 1, 0, 23, 59, 59);
    const map = new Map<string, DayMarker[]>();
    for (const t of scheduled) {
      const occ = nextOccurrences(t.schedule as string, first, last);
      for (const occDate of occ) {
        const key = occDate.toDateString();
        const list = map.get(key) ?? [];
        list.push({
          date: occDate,
          triggerId: t.id,
          groupName: t.name,
          timeLabel: `${String(occDate.getHours()).padStart(2, '0')}:${String(occDate.getMinutes()).padStart(2, '0')}`,
        });
        map.set(key, list);
      }
    }
    // Task-group time windows also project onto the grid
    for (const g of groups) {
      if (!g.time_window_cron) continue;
      const occ = nextOccurrences(g.time_window_cron, first, last);
      for (const occDate of occ) {
        const key = occDate.toDateString();
        const list = map.get(key) ?? [];
        list.push({
          date: occDate,
          triggerId: g.id,
          groupName: g.name,
          timeLabel: `${String(occDate.getHours()).padStart(2, '0')}:${String(occDate.getMinutes()).padStart(2, '0')}`,
        });
      }
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.date.getTime() - b.date.getTime());
    }
    return map;
  }, [cursor, scheduled, groups]);

  const cells = useMemo(() => monthGrid(cursor.getFullYear(), cursor.getMonth()), [cursor]);
  const today = new Date();

  return (
    <div className="page" data-testid="calendar-page">
      <div className="page-header">
        <h2>{i18n.t('nav.calendar')}</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            data-testid="calendar-prev"
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
          >
            ‹
          </button>
          <span data-testid="calendar-month" style={{ fontSize: 13, color: '#fafafa', minWidth: 140, textAlign: 'center' }}>
            {cursor.toLocaleString(undefined, { month: 'long', year: 'numeric' })}
          </span>
          <button
            data-testid="calendar-next"
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
          >
            ›
          </button>
        </div>
      </div>

      {error && <div style={{ color: '#f87171', fontSize: 12, marginBottom: 8 }}>{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
        {WEEKDAY_LABELS.map((d) => (
          <div key={d} style={{ fontSize: 11, color: '#a1a1aa', textAlign: 'center', padding: '4px 0' }}>
            {d}
          </div>
        ))}
        {cells.map((cell, idx) => {
          const key = cell.toDateString();
          const inMonth = cell.getMonth() === cursor.getMonth();
          const isToday = sameDay(cell, today);
          const dayMarkers = markers.get(key) ?? [];
          const visible = dayMarkers.slice(0, 3);
          return (
            <div
              key={idx}
              data-testid={`calendar-cell-${cell.getDate()}-${cell.getMonth() + 1}`}
              style={{
                minHeight: 72,
                padding: 6,
                borderRadius: 6,
                border: '1px solid rgba(255,255,255,0.1)',
                background: isToday ? 'rgba(255,255,255,0.08)' : 'transparent',
                opacity: inMonth ? 1 : 0.35,
              }}
            >
              <div style={{ fontSize: 11, color: '#a1a1aa', marginBottom: 4 }}>{cell.getDate()}</div>
              {visible.map((m, i) => (
                <button
                  key={`${m.triggerId}-${i}`}
                  data-testid="calendar-marker"
                  onClick={() => setSelectedGroup(m.triggerId)}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    fontSize: 10,
                    padding: '2px 4px',
                    marginBottom: 2,
                    background: '#141416',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 4,
                    color: '#fafafa',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {m.timeLabel} {m.groupName}
                </button>
              ))}
              {dayMarkers.length > 3 && (
                <div style={{ fontSize: 10, color: '#71717a' }}>+{dayMarkers.length - 3}</div>
              )}
            </div>
          );
        })}
      </div>

      {selectedGroup && (
        <div className="modal-backdrop" onClick={() => setSelectedGroup(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{selectedGroup}</h3>
            <p style={{ fontSize: 12, color: '#a1a1aa' }}>{i18n.t('calendar.jumpHint')}</p>
            <button onClick={() => setSelectedGroup(null)}>OK</button>
          </div>
        </div>
      )}
    </div>
  );
}
