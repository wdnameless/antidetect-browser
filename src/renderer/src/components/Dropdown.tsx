import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { IconCheck, IconChevronDown } from '../icons';

export interface DropdownOption {
  value: string;
  label: string;
  hint?: string;
}

/**
 * The app's select control.
 *
 * It exists because a native `<select>` cannot be styled where it matters: on WebView2 the popup
 * list is drawn by the OS with system colours, so a light popup opened over this app's near-black
 * ground — the operator's «поломанные с цветами... как будто классические». Only the closed
 * trigger is styleable, and a control whose closed state matches the app while its open state does
 * not is worse than one that never tried. This renders the list itself, from the same tokens as
 * everything else, in both themes.
 *
 * The menu is positioned `fixed` from the trigger's rect: inside a table container (or any
 * ancestor with `overflow`), an absolutely-positioned menu would be clipped, which is the defect
 * the profiles kebab menu already had to work around. Fixed coordinates are immune to that, and the
 * flip keeps the list on screen when the trigger sits near the bottom of the window.
 */
export function Dropdown({
  value,
  options,
  onChange,
  placeholder,
  className,
  disabled,
  ariaLabel,
  size = 'md',
  align = 'left',
}: {
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  ariaLabel?: string;
  /**
   * `sm` is the compact filter-toolbar density; `md` is a standalone form control. They differ
   * only in height and type size, both from the token set.
   */
  size?: 'sm' | 'md';
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const current = options.find((o) => o.value === value);

  // Position before paint so the menu never flashes at the wrong place for a frame.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.max(rect.width, 150);
      // Flip horizontally when the menu would run off the right edge.
      const left = align === 'right' ? Math.max(8, rect.right - width) : Math.min(rect.left, window.innerWidth - width - 8);
      // Flip vertically when there is more room above than below.
      const below = window.innerHeight - rect.bottom;
      const top = below < 200 && rect.top > below ? Math.max(8, rect.top - 8 - Math.min(options.length * 30 + 8, 260)) : rect.bottom + 4;
      setMenuPos({ top, left, width });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, align, options.length]);

  // Open on the selected option, so a keyboard user does not have to hunt for it.
  useEffect(() => {
    if (open) setActiveIndex(options.findIndex((o) => o.value === value));
  }, [open, options, value]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node) && listRef.current && !listRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const commit = (next: string) => {
    onChange(next);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (!open) {
      // Enter/Space/ArrowDown open the list; Home/End jump straight to an edge option.
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        setOpen(false);
        break;
      case 'ArrowDown':
        e.preventDefault();
        setActiveIndex((i) => Math.min(options.length - 1, i + 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex((i) => Math.max(0, i - 1));
        break;
      case 'Home':
        e.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        e.preventDefault();
        setActiveIndex(options.length - 1);
        break;
      case 'Enter':
      case ' ': {
        e.preventDefault();
        const option = options[activeIndex];
        if (option) commit(option.value);
        break;
      }
      default:
        break;
    }
  };

  return (
    <div className={`dropdown ${size === 'sm' ? 'dropdown-sm' : ''} ${className ?? ''}`} ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        className="dropdown-trigger"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onKeyDown}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
      >
        <span className={current ? 'dropdown-value' : 'dropdown-placeholder'}>
          {current ? current.label : placeholder ?? 'Select…'}
        </span>
        <IconChevronDown size={14} />
      </button>
      {open ? (
        <div
          id={listId}
          ref={listRef}
          className="dropdown-menu"
          role="listbox"
          tabIndex={-1}
          style={menuPos ? { top: menuPos.top, left: menuPos.left, minWidth: menuPos.width } : { visibility: 'hidden' }}
        >
          {options.map((o, index) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              className={`dropdown-item ${o.value === value ? 'is-selected' : ''} ${index === activeIndex ? 'is-active' : ''}`}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => commit(o.value)}
            >
              <span className="dropdown-item-label">
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
