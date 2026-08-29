import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Tone } from '@ciq/shared';
import {
  IconAlert,
  IconCheck,
  IconChevronDown,
  IconFilter,
  IconInfo,
  IconTrash,
  IconX,
} from './Icons';

/**
 * UI primitives.
 *
 * Small, unstyled-by-props components that map onto the classes in
 * components.css. Visual decisions live in CSS; these supply behaviour,
 * accessibility wiring and the class contract.
 */

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

type ButtonVariant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger' | 'danger-quiet';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  iconOnly?: boolean;
  block?: boolean;
  loading?: boolean;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  iconOnly,
  block,
  loading,
  disabled,
  className = '',
  children,
  ...props
}: ButtonProps) {
  const classes = [
    'btn',
    `btn-${variant}`,
    size !== 'md' && `btn-${size}`,
    iconOnly && 'btn-icon',
    block && 'btn-block',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      className={classes}
      disabled={disabled || loading}
      // Announces the pending state to assistive tech, which a spinner alone does not.
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Spinner /> : children}
    </button>
  );
}

function Spinner() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeWidth="3"
        opacity="0.25"
        fill="none"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
      >
        <animateTransform
          attributeName="transform"
          type="rotate"
          from="0 12 12"
          to="360 12 12"
          dur="0.7s"
          repeatCount="indefinite"
        />
      </path>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------

export function Badge({
  tone = 'neutral',
  dot,
  large,
  lozenge,
  children,
}: {
  tone?: Tone;
  dot?: boolean;
  large?: boolean;
  /**
   * The compact uppercase form used for machine states — an activity's status,
   * an order's state. Reads as a state rather than as a word somebody typed,
   * and a column of them scans as a pattern before any of it is read.
   */
  lozenge?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className={`badge${large ? ' badge-lg' : ''}`}
      data-tone={tone}
      data-lozenge={lozenge || undefined}
    >
      {dot && <span className="badge-dot" />}
      {children}
    </span>
  );
}

/** Phase chip, coloured from the phase row rather than a fixed palette. */
export function PhaseChip({ name, colour }: { name: string; colour: string }) {
  return (
    <span className="phase-chip">
      <span className="phase-swatch" style={{ background: colour }} />
      {name}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

export function Progress({
  value,
  colour,
  size = 'md',
  label,
}: {
  value: number;
  colour?: string;
  size?: 'sm' | 'md' | 'lg';
  label?: string;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className="progress-row">
      <div
        className={`progress${size !== 'md' ? ` progress-${size}` : ''}`}
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div
          className="progress-fill"
          style={{
            width: `${clamped}%`,
            ...(colour ? ({ '--progress-colour': colour } as never) : {}),
          }}
        />
      </div>
      <span className="progress-value">{clamped}%</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

export function Card({
  title,
  description,
  icon,
  actions,
  children,
  padded = true,
  className = '',
  style,
}: {
  title?: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  padded?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <section className={`card ${className}`} style={style}>
      {(title || actions) && (
        <header className="card-head">
          <div>
            <div className="card-title">
              {icon}
              {title}
            </div>
            {description && <p className="card-desc">{description}</p>}
          </div>
          {actions && <div className="row gap-2 shrink-0">{actions}</div>}
        </header>
      )}
      <div className={padded ? 'card-body' : ''}>{children}</div>
    </section>
  );
}

export function Kpi({
  value,
  label,
  hint,
  tone,
}: {
  value: ReactNode;
  label: string;
  hint?: ReactNode;
  tone?: Tone;
}) {
  return (
    <div className="kpi" data-tone={tone}>
      <div className="kpi-value">{value}</div>
      <div className="kpi-label">{label}</div>
      {hint && <div className="kpi-hint">{hint}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Form field
// ---------------------------------------------------------------------------

export function Field({
  label,
  hint,
  error,
  required,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  children: (props: {
    id: string;
    'aria-invalid': boolean;
    'aria-describedby': string;
  }) => ReactNode;
}) {
  const id = useId();
  const describedBy = `${id}-desc`;

  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
        {required && (
          <span aria-hidden="true" style={{ color: 'var(--danger-text)' }}>
            {' '}
            *
          </span>
        )}
      </label>
      {children({ id, 'aria-invalid': Boolean(error), 'aria-describedby': describedBy })}
      <div id={describedBy}>
        {error ? (
          <span className="field-error" role="alert">
            <IconAlert size={12} />
            {error}
          </span>
        ) : (
          hint && <span className="field-hint">{hint}</span>
        )}
      </div>
    </div>
  );
}

/** Checkbox rendered as a button so it can carry the animated tick styling. */
export function Checkbox({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      className="checkbox"
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      {checked && <IconCheck size={12} strokeWidth={3} />}
    </button>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="switch"
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  );
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

export function Modal({
  title,
  description,
  onClose,
  children,
  footer,
  size = 'md',
}: {
  title: string;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'md' | 'lg' | 'xl';
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // Escape closes, and focus moves into the dialog on open so a keyboard user is
  // not left behind on the page underneath.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);

    const previouslyFocused = document.activeElement as HTMLElement | null;
    dialogRef.current
      ?.querySelector<HTMLElement>(
        'input, select, textarea, button, [tabindex]:not([tabindex="-1"])',
      )
      ?.focus();

    // Scroll lock: without it the page behind scrolls under the overlay.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [onClose]);

  return createPortal(
    <div
      className="overlay"
      onMouseDown={(event) => {
        // Only a press that both starts and ends on the backdrop closes, so a
        // drag that ends outside a text selection does not discard the form.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className={`modal${size !== 'md' ? ` modal-${size}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="modal-head">
          <div>
            <h2 className="modal-title" id={titleId}>
              {title}
            </h2>
            {description && <p className="card-desc">{description}</p>}
          </div>
          <Button variant="ghost" size="sm" iconOnly onClick={onClose} aria-label="Close">
            <IconX size={16} />
          </Button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  destructive,
  loading,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button
            variant={destructive ? 'danger' : 'primary'}
            loading={loading}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-secondary">{message}</p>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------

export function Menu({
  trigger,
  children,
  align = 'right',
}: {
  trigger: (props: { onClick: () => void; 'aria-expanded': boolean }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      {trigger({ onClick: () => setOpen((v) => !v), 'aria-expanded': open })}
      {open && (
        <div
          className="menu"
          role="menu"
          style={{ top: 'calc(100% + 6px)', [align]: 0 } as React.CSSProperties}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

/**
 * A menu entry.
 *
 * If the action needs confirming, the dialog must be owned by the component
 * that renders the `Menu`, not by a child of it: selecting an item closes the
 * menu, `Menu` unmounts its children while closed, and a dialog living in there
 * would be torn down in the same tick it was opened. Close the menu, set state
 * in the parent, and render the dialog as the parent's sibling.
 */
export function MenuItem({
  onClick,
  danger,
  children,
}: {
  onClick: () => void;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className="menu-item"
      data-danger={danger}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Destructive actions
// ---------------------------------------------------------------------------

/**
 * A delete control that always confirms first.
 *
 * Deleting from a dense table is a one-pixel mistake — the trash icon sits a few
 * millimetres from the fields beside it, and on a touch card it is a full-width
 * tap target. So the confirmation is built into the control rather than left to
 * each caller to remember, and the dialog names the row and says what else the
 * delete touches.
 */
export function DeleteButton({
  label,
  title = 'Delete',
  message,
  confirmLabel = 'Delete',
  onDelete,
  loading,
  variant = 'icon',
  disabled,
}: {
  /** What is being deleted, e.g. the row name. Used in the accessible name. */
  label: string;
  title?: string;
  message: ReactNode;
  confirmLabel?: string;
  onDelete: () => void;
  loading?: boolean;
  variant?: 'icon' | 'button';
  disabled?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);

  const dialog = confirming && (
    <ConfirmDialog
      title={title}
      message={message}
      confirmLabel={confirmLabel}
      destructive
      loading={loading}
      onCancel={() => setConfirming(false)}
      onConfirm={() => {
        setConfirming(false);
        onDelete();
      }}
    />
  );

  if (variant === 'button') {
    return (
      <>
        <Button
          variant="danger-quiet"
          size="sm"
          disabled={disabled}
          onClick={() => setConfirming(true)}
        >
          <IconTrash size={14} />
          {title}
        </Button>
        {dialog}
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        className="row-action row-action-danger"
        aria-label={`${title} ${label}`}
        disabled={disabled}
        onClick={() => setConfirming(true)}
      >
        <IconTrash size={13} />
      </button>
      {dialog}
    </>
  );
}

// ---------------------------------------------------------------------------
// Filter bar
// ---------------------------------------------------------------------------

/**
 * Filters, collapsible on small screens.
 *
 * On a phone the full filter block was taller than the results it filtered —
 * search, scope, sort, a category pill row and a status pill row pushed the
 * first project card off the bottom of the screen. Rather than dropping filters
 * on mobile, the block collapses behind a summary row that states how many are
 * active, so the state is never hidden even when the controls are.
 *
 * Above the breakpoint the toggle disappears and the panel is always open —
 * `hidden` is driven by CSS, so no JavaScript resize listener is involved and
 * there is no flash of the wrong state on load.
 */
export function FilterBar({
  activeCount = 0,
  onClear,
  summary,
  children,
}: {
  /** Number of filters narrowing the current view. Shown on the toggle. */
  activeCount?: number;
  onClear?: () => void;
  /** Always-visible row — typically the search box. */
  summary?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <section className="filter-bar no-print" data-open={open}>
      <div className="filter-bar-head">
        {summary && <div className="filter-bar-summary">{summary}</div>}
        <button
          type="button"
          className="filter-bar-toggle"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((v) => !v)}
        >
          <IconFilter size={14} />
          Filters
          {activeCount > 0 && <span className="filter-bar-badge tnum">{activeCount}</span>}
          <IconChevronDown size={14} className="filter-bar-caret" />
        </button>
      </div>

      <div className="filter-bar-panel" id={panelId}>
        {children}
        {onClear && activeCount > 0 && (
          <button type="button" className="filter-bar-clear" onClick={onClear}>
            Clear {activeCount} filter{activeCount === 1 ? '' : 's'}
          </button>
        )}
      </div>
    </section>
  );
}

/**
 * A horizontally scrolling row of filter pills.
 *
 * Wrapping is right on a wide screen and wrong on a narrow one, where eight
 * category pills become a five-line block. Below the breakpoint this scrolls
 * sideways with scroll-snap instead, keeping the row one line tall.
 */
export function FilterPills({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="filter-pills" role="group" aria-label={label}>
      {children}
    </div>
  );
}

/**
 * The chevron on a collapsible table row.
 *
 * Hidden above the stacking breakpoint, where nothing collapses. The row's own
 * handler does the toggling — this only shows which way it will move — so the
 * click is stopped here to keep it from counting twice and cancelling itself.
 */
export function RowToggle({ expanded, label }: { expanded: boolean; label: string }) {
  return (
    <button
      type="button"
      className="row-toggle"
      aria-expanded={expanded}
      aria-label={`${expanded ? 'Hide' : 'Show'} details for ${label}`}
      onClick={(event) => event.stopPropagation()}
      tabIndex={-1}
    >
      <IconChevronDown size={16} />
    </button>
  );
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

export function EmptyState({
  icon,
  title,
  message,
  action,
}: {
  icon?: ReactNode;
  title: string;
  message?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      {icon && <div className="empty-icon">{icon}</div>}
      <div className="empty-title">{title}</div>
      {message && <p className="empty-text">{message}</p>}
      {action}
    </div>
  );
}

/** Placeholder block sized to the content it stands in for. */
export function Skeleton({
  height = 16,
  width = '100%',
}: {
  height?: number;
  width?: number | string;
}) {
  return <div className="skeleton" style={{ height, width }} />;
}

export function SkeletonRows({ rows = 4, height = 56 }: { rows?: number; height?: number }) {
  return (
    <div className="stack gap-2">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} height={height} />
      ))}
    </div>
  );
}

export function Callout({ tone = 'info', children }: { tone?: Tone; children: ReactNode }) {
  const Icon = tone === 'danger' || tone === 'warning' ? IconAlert : IconInfo;
  return (
    <div className="callout" data-tone={tone}>
      <Icon size={16} />
      <div>{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

interface Toast {
  id: number;
  tone: Tone;
  title: string;
  body?: string;
}

interface ToastContextValue {
  notify: (toast: Omit<Toast, 'id'>) => void;
  success: (title: string, body?: string) => void;
  error: (title: string, body?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const notify = useCallback(
    (toast: Omit<Toast, 'id'>) => {
      const id = nextId.current++;
      setToasts((current) => [...current, { ...toast, id }]);
      // Errors linger: they usually carry something the user must read and act
      // on, where a success confirmation has done its job in a couple of seconds.
      setTimeout(() => dismiss(id), toast.tone === 'danger' ? 8000 : 4000);
    },
    [dismiss],
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      notify,
      success: (title, body) => notify({ tone: 'success', title, body }),
      error: (title, body) => notify({ tone: 'danger', title, body }),
    }),
    [notify],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      {createPortal(
        <div className="toast-region" role="region" aria-label="Notifications">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className="toast"
              data-tone={toast.tone}
              // Errors interrupt; confirmations wait their turn in the queue.
              role={toast.tone === 'danger' ? 'alert' : 'status'}
            >
              <div className="grow">
                <div className="font-medium text-sm">{toast.title}</div>
                {toast.body && <div className="text-xs text-secondary">{toast.body}</div>}
              </div>
              <button
                type="button"
                className="row-action"
                style={{ opacity: 1 }}
                onClick={() => dismiss(toast.id)}
                aria-label="Dismiss"
              >
                <IconX size={14} />
              </button>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside <ToastProvider>');
  return context;
}

// ---------------------------------------------------------------------------
// Avatar
// ---------------------------------------------------------------------------

export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' }) {
  const letters = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join('');

  return (
    <span
      className={`avatar${size !== 'md' ? ` avatar-${size}` : ''}`}
      title={name}
      aria-hidden="true"
    >
      {letters || '?'}
    </span>
  );
}
