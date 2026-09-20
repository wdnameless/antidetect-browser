/**
 * Toast notification system for quiet agent activity updates.
 *
 * Why quiet, non-modal, auto-dismissing toasts:
 * As requested by the operator, when the agent invokes an API / tool, the operator should
 * see what is happening via Telegram-like floating toasts without audio, modal interruption,
 * or OS-level Notification popups.
 *
 * Requirements:
 * - Fixed bottom-right positioning, above standard UI chrome but below modal dialogs (z-index: 900 vs 1000).
 * - Only reacts to `agent-activity` events (ignores `profile-status` and `hello` to prevent chatty clutter).
 * - Pause dismissal timer while hovering over the toast stack (Telegram behavior allowing safe short ~5s timer).
 * - Max 4 visible toasts: drops oldest on overflow to prevent screen flooding during burst agent actions.
 * - Dynamic enable check: reads `localStorage.getItem('nt.toasts.enabled') !== '0'` (absent = enabled)
 *   on each incoming event so toggling settings takes effect immediately without reload.
 */

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { subscribeToEvents, StreamMessage } from '../eventsStream';
import { IconClose } from '../icons';

export interface ToastItem {
  id: string;
  title: string;
  body: string;
  createdAt: number;
}

export interface PushToastOptions {
  title: string;
  body?: string;
}

const MAX_VISIBLE_TOASTS = 4;
const TOAST_DURATION_MS = 5000;
const STORAGE_KEY_TOASTS_ENABLED = 'nt.toasts.enabled';

type ToastSubscriber = (toasts: ToastItem[]) => void;
const internalListeners = new Set<ToastSubscriber>();
let currentToasts: ToastItem[] = [];

function notifyListeners(): void {
  for (const listener of internalListeners) {
    try {
      listener(currentToasts);
    } catch {
      // Isolate listener errors
    }
  }
}

/**
 * Checks whether quiet toasts are enabled by the operator.
 * Absent or non-'0' value means enabled by default.
 */
export function areToastsEnabled(): boolean {
  if (typeof localStorage === 'undefined') return true;
  try {
    return localStorage.getItem(STORAGE_KEY_TOASTS_ENABLED) !== '0';
  } catch {
    return true;
  }
}

/**
 * Maps machine kind (e.g. `profile.start`) to a concise human title.
 */
export function formatActivityTitle(kind: string): string {
  switch (kind) {
    case 'profile.start':
      return 'Profile started';
    case 'profile.stop':
      return 'Profile stopped';
    case 'browser.navigate':
      return 'Browser navigate';
    case 'browser.click':
      return 'Browser click';
    case 'browser.type':
      return 'Browser input';
    case 'flow.start':
      return 'Flow started';
    case 'flow.step':
      return 'Flow step';
    case 'flow.finish':
      return 'Flow finished';
    default: {
      // E.g. "profile.cookie_sync" -> "Profile cookie sync"
      const parts = kind.split('.');
      if (parts.length > 1) {
        const action = parts.slice(1).join(' ').replace(/_/g, ' ');
        const section = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
        return `${section}: ${action}`;
      }
      return kind.charAt(0).toUpperCase() + kind.slice(1);
    }
  }
}

export function dismissToast(id: string): void {
  const next = currentToasts.filter((t) => t.id !== id);
  if (next.length !== currentToasts.length) {
    currentToasts = next;
    notifyListeners();
  }
}

/**
 * Module-level trigger allowing any part of the app to show a quiet toast.
 */
export function pushToast(options: PushToastOptions): void {
  if (!areToastsEnabled()) {
    return;
  }

  const item: ToastItem = {
    id: `toast_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    title: options.title,
    body: options.body ?? '',
    createdAt: Date.now(),
  };

  // Prepend newest or append? Telegram toasts stack vertically.
  // We keep newest, capping total at MAX_VISIBLE_TOASTS (dropping oldest).
  const updated = [...currentToasts, item];
  if (updated.length > MAX_VISIBLE_TOASTS) {
    currentToasts = updated.slice(updated.length - MAX_VISIBLE_TOASTS);
  } else {
    currentToasts = updated;
  }
  notifyListeners();
}

/**
 * React container rendering the stack of quiet toasts at bottom-right.
 */
export function ToastStack(): React.ReactElement | null {
  const [toasts, setToasts] = useState<ToastItem[]>(() => currentToasts);
  const [isHovered, setIsHovered] = useState(false);
  const isHoveredRef = useRef(false);
  isHoveredRef.current = isHovered;

  useEffect(() => {
    const onToastsChange = (items: ToastItem[]) => {
      setToasts([...items]);
    };
    internalListeners.add(onToastsChange);
    return () => {
      internalListeners.delete(onToastsChange);
    };
  }, []);

  // Listen to the SSE stream for agent-activity events only
  useEffect(() => {
    const unsubscribe = subscribeToEvents((msg: StreamMessage) => {
      // Explicit requirement: MUST NOT react to profile-status events.
      // Only react to agent-activity events.
      if (msg.type === 'agent-activity') {
        const { event } = msg;
        // Re-read enabled flag per event so Settings changes take immediate effect
        if (!areToastsEnabled()) {
          return;
        }

        const title = formatActivityTitle(event.kind);
        pushToast({
          title,
          body: event.summary,
        });
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // Auto-dismiss interval: ticks every 500ms and removes toasts older than TOAST_DURATION_MS,
  // unless hovered (hovering pauses dismissal).
  useEffect(() => {
    if (toasts.length === 0) return;

    const interval = setInterval(() => {
      if (isHoveredRef.current) {
        return;
      }
      const now = Date.now();
      const next = currentToasts.filter((t) => now - t.createdAt < TOAST_DURATION_MS);
      if (next.length !== currentToasts.length) {
        currentToasts = next;
        notifyListeners();
      }
    }, 500);

    return () => {
      clearInterval(interval);
    };
  }, [toasts.length]);

  const handleMouseEnter = useCallback(() => {
    setIsHovered(true);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setIsHovered(false);
  }, []);

  if (toasts.length === 0) {
    return null;
  }

  return (
    <div
      className="toast-stack"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      role="region"
      aria-label="Agent notifications"
      aria-live="polite"
    >
      {toasts.map((item) => (
        <div
          key={item.id}
          className="toast"
          onClick={() => dismissToast(item.id)}
          role="status"
        >
          <div className="toast-content">
            <div className="toast-title">{item.title}</div>
            {item.body ? <div className="toast-body">{item.body}</div> : null}
          </div>
          <button
            type="button"
            className="toast-close"
            onClick={(e) => {
              e.stopPropagation();
              dismissToast(item.id);
            }}
            aria-label="Close notification"
          >
            <IconClose size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
