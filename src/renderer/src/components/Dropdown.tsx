import { useEffect, useRef, useState } from 'react';
import { IconCheck, IconChevronDown } from '../icons';

export interface DropdownOption {
  value: string;
  label: string;
  hint?: string;
}

export function Dropdown({
  value,
  options,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
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

  const current = options.find((o) => o.value === value);

  return (
    <div className={`dropdown ${className ?? ''}`} ref={ref}>
      <button type="button" className="dropdown-trigger" onClick={() => setOpen((v) => !v)}>
        <span className={current ? '' : 'dropdown-placeholder'}>
          {current ? current.label : placeholder ?? 'Select…'}
        </span>
        <IconChevronDown size={14} />
      </button>
      {open ? (
        <div className="dropdown-menu">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              className={`dropdown-item ${o.value === value ? 'active' : ''}`}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
            >
              <span>
                {o.label}
                {o.hint ? <span className="dropdown-hint"> · {o.hint}</span> : null}
              </span>
              {o.value === value ? <IconCheck size={13} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
