import { useCallback, useState } from 'react';

/**
 * Per-row expansion, for tables that stack into cards on mobile.
 *
 * A stacked activity row shows nine lines — name, four dates, slippage, status,
 * assignee, actions — so ten activities became a page you scroll for a minute
 * to find one name. Collapsed, a row shows what identifies it and what it is
 * doing; the rest waits for a tap.
 *
 * The state is deliberately per row rather than a global "compact" toggle:
 * somebody opening one activity to check its dates does not want the other nine
 * to open with it, and a global switch is a setting nobody finds.
 *
 * Above the stacking breakpoint none of this applies — the CSS ignores the
 * attributes and the table is a table.
 */
export function useRowExpansion() {
  const [open, setOpen] = useState<Set<string>>(new Set());

  const toggle = useCallback((id: string) => {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  /**
   * Spread onto the `<tr>`. The whole row is the target, so there is no small
   * chevron to aim at — but a click landing on a control inside the row must
   * not also collapse it, which is what the target check prevents.
   */
  const rowProps = useCallback(
    (id: string) => ({
      'data-collapsible': 'true' as const,
      'data-expanded': open.has(id) ? ('true' as const) : undefined,
      onClick: (event: React.MouseEvent<HTMLTableRowElement>) => {
        const target = event.target as HTMLElement;
        if (target.closest('input, select, textarea, button, a, label')) return;
        toggle(id);
      },
    }),
    [open, toggle],
  );

  return { isOpen: (id: string) => open.has(id), toggle, rowProps };
}
