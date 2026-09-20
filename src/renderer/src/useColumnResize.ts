import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

/**
 * Drag-to-resize columns for a dense table, without horizontal scrolling.
 *
 * The operator's report was «уберём этот стрёмный скрол горизонтальный и дадим возможность
 * Сущность профилей / прокси стат двигать, сужать или расширять, чтобы всё помещалось».
 * So the table must NEVER overflow its container — dragging is what replaces the scrollbar.
 *
 * That invariant is why widths are stored as FRACTIONS of the container rather than pixels:
 * a pixel width saved on a 1600px window would overflow a 1024px one, and the table would need
 * the scrollbar back. A fraction scales with the container, so the contract holds at any window
 * size with no ResizeObserver.
 *
 * The last column is deliberately NOT resizable and gets no fraction: with
 * `table-layout: fixed` it absorbs whatever the resizable columns leave, which is what makes
 * "everything fits" a property of the layout instead of a number we have to keep correct.
 */

export interface ResizableColumn {
  /** Stable id; also the persisted key. */
  key: string;
  /** Share of the container width before the operator drags anything. */
  defaultFraction: number;
  /** Floor in pixels, so a column cannot be dragged down to an unreadable sliver. */
  minWidth: number;
}

/**
 * Room the non-resizable trailing column keeps for itself.
 *
 * Measured against the profile row's action buttons: four 26px icon buttons plus their gaps
 * need ~130px, and the cell carries 16px padding on each side.
 */
const TAIL_MIN_WIDTH = 170;

const STORAGE_PREFIX = 'nt.colw.';

/** Clamp helper; `Number.isFinite` guards a corrupted store rather than throwing at render. */
function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/**
 * The width fraction a drag may land on.
 *
 * Exported and pure because it carries the one invariant the whole no-scroll design rests on:
 * the resizable columns plus the trailing column must never exceed 100%. `tailMinWidth` is the
 * room reserved for that trailing column, so the upper bound here is what physically prevents
 * the operator from dragging the table past its container and bringing the scrollbar back.
 *
 * A plausible bug this defends: dropping the `tailMinWidth` term (or the `othersTotal` sum)
 * still looks correct in every narrow case, and only overflows when the operator drags the
 * first column far to the right on a wide window.
 */
export function clampDraggedFraction(args: {
  startFraction: number;
  deltaPx: number;
  containerWidth: number;
  /** Sum of the fractions belonging to the OTHER resizable columns. */
  othersTotal: number;
  minWidth: number;
  tailMinWidth: number;
}): number {
  const { startFraction, deltaPx, containerWidth, othersTotal, minWidth, tailMinWidth } = args;
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) return startFraction;
  const min = minWidth / containerWidth;
  const max = 1 - othersTotal - tailMinWidth / containerWidth;
  // The floor is only honoured when it leaves room for the tail: fit beats floor. A column
  // squeezed past its declared minimum is merely tight, whereas a table wider than its container
  // is the horizontal scrollbar the operator explicitly asked to be rid of. (An earlier version
  // used `Math.max(min, max)` as the bound, which silently chose the floor when the two crossed
  // and let the table overflow — measured at 1% over on a 1000px container of 130px columns.)
  const floor = Math.min(min, max);
  return clamp(startFraction + deltaPx / containerWidth, floor, max);
}

/** Stored fractions for one table, ignoring anything that is not a usable number. */
function readStored(tableId: string, columns: ResizableColumn[]): Record<string, number> {
  const fallback = Object.fromEntries(columns.map((c) => [c.key, c.defaultFraction]));
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + tableId);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out = { ...fallback };
    for (const column of columns) {
      const value = parsed[column.key];
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) out[column.key] = value;
    }
    return out;
  } catch {
    // A blocked or full store must not stop the table from rendering.
    return fallback;
  }
}

export function useColumnResize(tableId: string, columns: ResizableColumn[]) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [fractions, setFractions] = useState<Record<string, number>>(() => readStored(tableId, columns));
  const [dragging, setDragging] = useState<string | null>(null);
  // The drag is tracked in a ref, not state: pointermove fires faster than React commits, and
  // reading the start values from state would lag a frame behind the pointer.
  const dragRef = useRef<{
    key: string;
    startX: number;
    startFraction: number;
    containerWidth: number;
    othersTotal: number;
  } | null>(null);

  const persist = useCallback(
    (next: Record<string, number>) => {
      try {
        window.localStorage.setItem(STORAGE_PREFIX + tableId, JSON.stringify(next));
      } catch {
        // Persisting is a convenience; the drag already applied in-memory.
      }
    },
    [tableId],
  );

  const beginResize = useCallback(
    (key: string, event: ReactPointerEvent<HTMLElement>) => {
      const container = containerRef.current;
      if (!container) return;
      const containerWidth = container.clientWidth;
      if (containerWidth <= 0) return;
      const othersTotal = columns.reduce(
        (sum, column) => (column.key === key ? sum : sum + (fractions[column.key] ?? column.defaultFraction)),
        0,
      );
      dragRef.current = {
        key,
        startX: event.clientX,
        startFraction: fractions[key] ?? columns.find((c) => c.key === key)?.defaultFraction ?? 0,
        containerWidth,
        othersTotal,
      };
      setDragging(key);
      event.preventDefault();
      event.stopPropagation();
    },
    [columns, fractions],
  );

  useEffect(() => {
    if (!dragging) return;
    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const column = columns.find((c) => c.key === drag.key);
      if (!column) return;
      const delta = event.clientX - drag.startX;
      setFractions((prev) => ({
        ...prev,
        [drag.key]: clampDraggedFraction({
          startFraction: drag.startFraction,
          deltaPx: delta,
          containerWidth: drag.containerWidth,
          othersTotal: drag.othersTotal,
          minWidth: column.minWidth,
          tailMinWidth: TAIL_MIN_WIDTH,
        }),
      }));
    };
    const onUp = () => {
      setDragging(null);
      dragRef.current = null;
      setFractions((prev) => {
        persist(prev);
        return prev;
      });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    // A cancelled pointer (Escape, window losing capture) must end the drag too, or the table
    // keeps resizing on the next pointer move.
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [dragging, columns, persist]);

  /** Restore one column to its declared share (double-click on the handle). */
  const resetColumn = useCallback(
    (key: string) => {
      const column = columns.find((c) => c.key === key);
      if (!column) return;
      setFractions((prev) => {
        const next = { ...prev, [key]: column.defaultFraction };
        persist(next);
        return next;
      });
    },
    [columns, persist],
  );

  /** Percentage width for each resizable column; the caller renders one more `<col>` for the tail. */
  const colWidths = columns.map((column) => ({
    key: column.key,
    percent: (fractions[column.key] ?? column.defaultFraction) * 100,
  }));

  return { containerRef, colWidths, beginResize, resetColumn, dragging };
}
