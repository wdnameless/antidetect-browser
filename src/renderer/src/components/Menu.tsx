import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  danger?: boolean;
}

export function Menu({
  trigger,
  items,
  title = 'More actions',
  align = 'right',
}: {
  trigger: ReactNode;
  items: MenuItem[];
  title?: string;
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div className="menu-wrap" ref={ref}>
      <button type="button" className={`icon-btn ${open ? 'is-open' : ''}`} title={title} onClick={() => setOpen((v) => !v)}>
        {trigger}
      </button>
      {open ? (
        <div className={`menu ${align === 'left' ? 'menu-left' : ''}`}>
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              className={`menu-item ${it.danger ? 'danger' : ''}`}
              onClick={() => {
                setOpen(false);
                it.onClick();
              }}
            >
              {it.icon}
              {it.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
