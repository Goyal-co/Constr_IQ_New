import { useCallback, useRef, useState } from 'react';

/**
 * Drag-to-reorder for a list of rows.
 *
 * Built on pointer events rather than HTML5 drag-and-drop, which does not fire
 * on touch at all — and this list is read on site, on a phone, as often as at a
 * desk. Pointer events cover mouse, touch and pen through one code path.
 *
 * The order is previewed locally while dragging and sent once on release, so a
 * drag is one request rather than one per row crossed.
 *
 * Reordering is also available from the keyboard: focus a handle and press
 * Alt+ArrowUp / Alt+ArrowDown. A drag that can only be performed by dragging is
 * unusable for anybody who cannot, and on a dense table it is fiddly even for
 * those who can.
 *
 * The live order lives in a ref, with state used only to trigger a render.
 * Deriving it from state inside the release handler meant reading it through a
 * `setState` updater — and React may replay an updater, which fired the save
 * five times for a single drag and let a stale replay win.
 */
export function useReorderable<T extends { id: string }>({
  items,
  onCommit,
}: {
  items: T[];
  /** Called once, on release, with the ids in their new order. */
  onCommit: (ids: string[]) => void;
}) {
  /**
   * The live order and the row being carried, both in refs.
   *
   * `dragId` was state, which meant the move and release handlers read it from
   * a closure captured on the last render — so they depended on React having
   * re-rendered between pointerdown and the first pointermove. That happens to
   * hold for a real pointer, whose events land in separate frames, but tying
   * correctness to render scheduling is not something to leave standing.
   */
  const order = useRef<string[] | null>(null);
  const dragging = useRef<string | null>(null);
  const [, forceRender] = useState(0);

  // Row midpoints, measured once per drag. Reading them on every pointermove
  // would force a layout each frame for rows that are not moving.
  const midpoints = useRef<number[]>([]);

  const preview = order.current;
  const ordered = preview
    ? (preview.map((id) => items.find((i) => i.id === id)).filter(Boolean) as T[])
    : items;

  const move = (list: string[], from: number, to: number) => {
    if (to < 0 || to >= list.length || from === to || from < 0) return list;
    const next = [...list];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return next;
  };

  const begin = useCallback(
    (id: string, event: React.PointerEvent) => {
      // Only a primary press starts a drag; a right-click or a second finger
      // should not.
      if (event.button !== 0) return;
      event.preventDefault();
      (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);

      const row = (event.currentTarget as HTMLElement).closest('tr, [data-reorder-row]');
      const container = row?.parentElement;
      if (!container) return;

      midpoints.current = [...container.children].map((child) => {
        const box = child.getBoundingClientRect();
        return box.top + box.height / 2;
      });

      order.current = items.map((item) => item.id);
      dragging.current = id;
      forceRender((n) => n + 1);
    },
    [items],
  );

  const drag = useCallback((event: React.PointerEvent) => {
    const current = order.current;
    const id = dragging.current;
    if (!id || !current) return;

    const from = current.indexOf(id);
    // The row whose midpoint the pointer has passed is the row to swap with.
    let to = midpoints.current.findIndex((mid) => event.clientY < mid);
    if (to === -1) to = current.length - 1;

    const next = move(current, from, to);
    if (next !== current) {
      order.current = next;
      forceRender((n) => n + 1);
    }
  }, []);

  const end = useCallback(() => {
    if (!dragging.current) return;

    // Read and clear before any state update, so the commit happens exactly
    // once with the order that was actually on screen.
    const finalOrder = order.current;
    order.current = null;
    dragging.current = null;
    forceRender((n) => n + 1);

    // Only send when the order actually changed — a click on the handle that
    // moved nothing should not write to the database.
    if (finalOrder && finalOrder.join() !== items.map((i) => i.id).join()) {
      onCommit(finalOrder);
    }
  }, [items, onCommit]);

  const nudge = useCallback(
    (id: string, direction: -1 | 1) => {
      const current = items.map((i) => i.id);
      const from = current.indexOf(id);
      const next = move(current, from, from + direction);
      if (next !== current) onCommit(next);
    },
    [items, onCommit],
  );

  /** Spread onto the drag handle of each row. */
  const handleProps = useCallback(
    (id: string) => ({
      onPointerDown: (event: React.PointerEvent) => begin(id, event),
      onPointerMove: drag,
      onPointerUp: end,
      onPointerCancel: end,
      onKeyDown: (event: React.KeyboardEvent) => {
        if (!event.altKey) return;
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          nudge(id, -1);
        } else if (event.key === 'ArrowDown') {
          event.preventDefault();
          nudge(id, 1);
        }
      },
    }),
    [begin, drag, end, nudge],
  );

  const dragId = dragging.current;
  return { ordered, dragId, handleProps, nudge, isDragging: dragId !== null };
}
