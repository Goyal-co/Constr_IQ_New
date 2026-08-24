import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { useUnreadCount } from '@/lib/queries';
import { getTheme, toggleTheme, type Theme } from '@/lib/theme';
import { Avatar, Button, Menu, MenuItem } from '@/components/ui';
import { BrandLogo } from '@/components/brand/Brand';
import {
  IconAudit,
  IconBell,
  IconDashboard,
  IconLogout,
  IconMenu,
  IconMoon,
  IconProcurement,
  IconProjects,
  IconReport,
  IconSettings,
  IconSun,
  IconUsers,
} from '@/components/ui/Icons';
import { NotificationDrawer } from './NotificationDrawer';
import type { Permission } from '@ciq/shared';

interface NavEntry {
  to: string;
  label: string;
  icon: React.ReactNode;
  /** Hidden entirely when the role lacks this permission. */
  permission?: Permission;
  end?: boolean;
}

const PRIMARY_NAV: NavEntry[] = [
  { to: '/', label: 'Dashboard', icon: <IconDashboard size={17} />, end: true },
  { to: '/projects', label: 'Projects', icon: <IconProjects size={17} /> },
  { to: '/procurement', label: 'Procurement', icon: <IconProcurement size={17} /> },
  { to: '/reports', label: 'Reports', icon: <IconReport size={17} />, permission: 'report:read' },
];

const ADMIN_NAV: NavEntry[] = [
  { to: '/settings', label: 'Settings', icon: <IconSettings size={17} />, permission: 'org:read' },
  { to: '/people', label: 'People', icon: <IconUsers size={17} />, permission: 'user:read' },
  { to: '/audit', label: 'Audit trail', icon: <IconAudit size={17} />, permission: 'audit:read' },
];

export function AppShell() {
  const { user, logout, can } = useAuth();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [theme, setThemeState] = useState<Theme>(getTheme);

  const unread = useUnreadCount();

  // Close the mobile drawer on navigation, otherwise it stays over the page the
  // user just asked for.
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const visible = (entries: NavEntry[]) =>
    entries.filter((entry) => !entry.permission || can(entry.permission));

  const adminEntries = visible(ADMIN_NAV);

  return (
    <div className="shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>

      {mobileOpen && (
        <div
          className="overlay no-print"
          style={{ zIndex: 'var(--z-overlay)' }}
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside className="sidebar no-print" data-open={mobileOpen}>
        <div className="sidebar-brand">
          <Link to="/" className="sidebar-brand-link" aria-label="Dashboard">
            <BrandLogo surface="dark" />
          </Link>
        </div>

        <nav className="sidebar-nav" aria-label="Main">
          {visible(PRIMARY_NAV).map((entry) => (
            <NavLink key={entry.to} to={entry.to} end={entry.end} className="nav-item">
              {entry.icon}
              {entry.label}
            </NavLink>
          ))}

          {adminEntries.length > 0 && (
            <>
              <div className="sidebar-section">Administration</div>
              {adminEntries.map((entry) => (
                <NavLink key={entry.to} to={entry.to} className="nav-item">
                  {entry.icon}
                  {entry.label}
                </NavLink>
              ))}
            </>
          )}
        </nav>

        <div className="sidebar-footer">
          <Menu
            align="left"
            trigger={(props) => (
              <button type="button" className="nav-item" style={{ width: '100%' }} {...props}>
                <Avatar name={user?.name ?? '?'} size="sm" />
                <span className="grow truncate" style={{ textAlign: 'left' }}>
                  {user?.name}
                </span>
              </button>
            )}
          >
            {(close) => (
              <>
                <div className="menu-label">{user?.email}</div>
                <MenuItem
                  onClick={() => {
                    setThemeState(toggleTheme());
                    close();
                  }}
                >
                  {theme === 'dark' ? <IconSun size={15} /> : <IconMoon size={15} />}
                  {theme === 'dark' ? 'Light theme' : 'Dark theme'}
                </MenuItem>
                <div className="menu-divider" />
                <MenuItem danger onClick={() => void logout()}>
                  <IconLogout size={15} />
                  Sign out
                </MenuItem>
              </>
            )}
          </Menu>
        </div>
      </aside>

      <div className="main">
        <header className="topbar no-print">
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            className="mobile-only"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
          >
            <IconMenu size={18} />
          </Button>

          <Link to="/" className="mobile-only sidebar-brand-link" aria-label="Dashboard">
            <BrandLogo surface="auto" className="topbar-logo" />
          </Link>

          <div className="grow" />

          <Button
            variant="ghost"
            size="sm"
            iconOnly
            onClick={() => setNotificationsOpen(true)}
            aria-label={
              unread.data?.count ? `Notifications, ${unread.data.count} unread` : 'Notifications'
            }
            style={{ position: 'relative' }}
          >
            <IconBell size={18} />
            {(unread.data?.count ?? 0) > 0 && (
              <span
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  top: 4,
                  right: 4,
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: 'var(--danger-solid)',
                  border: '1.5px solid var(--surface-raised)',
                }}
              />
            )}
          </Button>

          <Button
            variant="ghost"
            size="sm"
            iconOnly
            onClick={() => setThemeState(toggleTheme())}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            {theme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
          </Button>
        </header>

        <main className="content" id="main-content">
          <Outlet />
        </main>
      </div>

      {notificationsOpen && <NotificationDrawer onClose={() => setNotificationsOpen(false)} />}

      <style>{`
        .mobile-only { display: none; }
        @media (max-width: 860px) { .mobile-only { display: inline-flex; } }
      `}</style>
    </div>
  );
}
