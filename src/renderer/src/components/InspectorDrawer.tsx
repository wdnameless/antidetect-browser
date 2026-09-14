import React, { useEffect, useRef } from 'react';

export interface InspectorDrawerProps {
  isOpen?: boolean;
  open?: boolean;
  onClose: () => void;
  triggerRef?: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
  width?: number | string;
  title?: string;
  /** Test ID for the drawer root */
  'data-testid'?: string;
}

/**
 * InspectorDrawer component for responsive overlay mode (<1100px).
 *
 * Implements accessible modal dialog:
 * - role="dialog"
 * - aria-modal="true"
 * - Traps or moves initial focus into the drawer container when opened
 * - Returns focus to the triggerRef button when closed
 * - Closes on Esc key press
 * - Closes when clicking the backdrop / scrim
 * - Fully noir token compliant (no literal hex or chromatic values)
 */
export const InspectorDrawer: React.FC<InspectorDrawerProps> = ({
  isOpen: isOpenProp,
  open: openProp,
  onClose,
  triggerRef,
  children,
  width = 340,
  title = 'Inspector & Config',
  'data-testid': testId = 'inspector-drawer',
}) => {
  const isOpen = Boolean(openProp ?? isOpenProp);
  const drawerRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Focus management: move focus into drawer on open, return to trigger on close
  useEffect(() => {
    if (isOpen) {
      // Focus drawer container or close button
      if (closeButtonRef.current) {
        closeButtonRef.current.focus();
      } else if (drawerRef.current) {
        drawerRef.current.focus();
      }

      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      };

      window.addEventListener('keydown', handleKeyDown, true);
      return () => {
        window.removeEventListener('keydown', handleKeyDown, true);
        if (triggerRef && triggerRef.current) {
          triggerRef.current.focus();
        }
      };
    }
    return undefined;
  }, [isOpen, onClose, triggerRef]);

  if (!isOpen) return null;

  return (
    <div
      data-testid={testId}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        justifyContent: 'flex-end',
      }}
    >
      {/* Scrim / Backdrop */}
      <div
        data-testid="inspector-drawer-scrim"
        onClick={onClose}
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0,0,0,0.6)',
          backdropFilter: 'blur(4px)',
        }}
      />

      {/* Drawer Dialog Surface */}
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        data-testid="inspector-drawer-panel"
        style={{
          position: 'relative',
          width: typeof width === 'number' ? `${width}px` : width,
          maxWidth: '85vw',
          background: 'var(--panel)',
          borderLeft: '1px solid var(--border)',
          boxShadow: 'var(--shadow-lg)',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 51,
          outline: 'none',
        }}
      >
        {/* Drawer Header with Title and Close Button */}
        <div
          style={{
            padding: '14px 16px',
            borderBottom: '1px solid var(--divider)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--panel)',
          }}
        >
          <span
            style={{
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              color: 'var(--text-secondary)',
            }}
          >
            {title}
          </span>
          <button
            ref={closeButtonRef}
            data-testid="btn-close-inspector-drawer"
            onClick={onClose}
            aria-label="Close Inspector"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              padding: '4px 8px',
              borderRadius: 'var(--radius-sm)',
              fontSize: 14,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.color = 'var(--text)';
              (e.currentTarget as HTMLElement).style.background = 'var(--control-bg-hover)';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)';
              (e.currentTarget as HTMLElement).style.background = 'transparent';
            }}
          >
            ✕
          </button>
        </div>

        {/* Drawer Content */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
};
