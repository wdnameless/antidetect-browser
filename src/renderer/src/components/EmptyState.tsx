import { type ReactNode } from 'react';

export interface EmptyStateProps {
  /** Column span when rendering inside a table row. If omitted, renders a standalone block. */
  colSpan?: number;
  /** Primary icon for the empty state. */
  icon: ReactNode;
  /** Bold one-line headline. */
  title: string;
  /** Explanatory line stating what the page/list is for. Optional: a state that is
   *  self-explanatory (e.g. "No groups matching search") does not need a second line,
   *  and callers already pass undefined for it. */
  description?: string;
  /** Optional primary action button or element. */
  action?: ReactNode;
  /** Optional container style overrides. */
  style?: React.CSSProperties;
}

export function EmptyState({
  colSpan,
  icon,
  title,
  description,
  action,
  style,
}: EmptyStateProps) {
  const content = (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: '36px 20px',
        gap: 10,
        ...style,
      }}
    >
      <div style={{ opacity: 0.35, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {icon}
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
        {title}
      </div>
      {description ? (
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', maxWidth: 420, lineHeight: 1.5 }}>
          {description}
        </div>
      ) : null}
      {action ? <div style={{ marginTop: 6 }}>{action}</div> : null}
    </div>
  );

  if (colSpan !== undefined) {
    return (
      <tr>
        <td colSpan={colSpan} style={{ padding: 0, border: 'none' }}>
          {content}
        </td>
      </tr>
    );
  }

  return content;
}
