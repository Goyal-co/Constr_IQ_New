import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { Permission } from '@ciq/shared';
import { useAuth } from '@/lib/auth';
import { AppShell } from '@/components/layout/AppShell';
import { EmptyState, SkeletonRows } from '@/components/ui';
import { IconAlert } from '@/components/ui/Icons';
import { LoginPage } from '@/pages/LoginPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { ProjectsPage } from '@/pages/ProjectsPage';
import { ProjectDetailPage } from '@/pages/ProjectDetailPage';

// Split the heavier administrative screens out of the initial bundle — most
// users never open them, and the report page pulls in chart and export code.
const ProcurementPage = lazy(() =>
  import('@/pages/ProcurementPage').then((m) => ({ default: m.ProcurementPage })),
);
const SettingsPage = lazy(() =>
  import('@/pages/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);
const PeoplePage = lazy(() =>
  import('@/pages/PeoplePage').then((m) => ({ default: m.PeoplePage })),
);
const AuditPage = lazy(() => import('@/pages/AuditPage').then((m) => ({ default: m.AuditPage })));

export function App() {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) return <BootScreen />;

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        {/* Remember where they were headed so sign-in returns them there. */}
        <Route
          path="*"
          element={<Navigate to="/login" replace state={{ from: location.pathname }} />}
        />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route element={<AppShell />}>
        <Route index element={<DashboardPage />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="projects/:projectId" element={<ProjectDetailPage />} />
        <Route
          path="procurement"
          element={
            <Lazy>
              <ProcurementPage />
            </Lazy>
          }
        />
        <Route
          path="settings/*"
          element={
            <Guard permission="org:read">
              <Lazy>
                <SettingsPage />
              </Lazy>
            </Guard>
          }
        />
        <Route
          path="people"
          element={
            <Guard permission="user:read">
              <Lazy>
                <PeoplePage />
              </Lazy>
            </Guard>
          }
        />
        <Route
          path="audit"
          element={
            <Guard permission="audit:read">
              <Lazy>
                <AuditPage />
              </Lazy>
            </Guard>
          }
        />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

function Lazy({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<SkeletonRows rows={4} height={90} />}>{children}</Suspense>;
}

/**
 * Route-level permission gate.
 *
 * Cosmetic only — the API refuses the underlying requests regardless. This
 * exists so someone following a stale link gets an explanation rather than a
 * page of failed requests.
 */
function Guard({ permission, children }: { permission: Permission; children: React.ReactNode }) {
  const { can } = useAuth();
  if (!can(permission)) {
    return (
      <EmptyState
        icon={<IconAlert size={20} />}
        title="You do not have access to this area"
        message="Your role does not include this permission. An administrator can change that from the People screen."
      />
    );
  }
  return <>{children}</>;
}

function NotFound() {
  return (
    <EmptyState
      title="Page not found"
      message="That address does not match anything in the app. Check the link, or head back to the dashboard."
    />
  );
}

function BootScreen() {
  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
      <div className="stack gap-3" style={{ width: 260, alignItems: 'center' }}>
        <span className="sidebar-mark" style={{ width: 40, height: 40 }}>
          CIQ
        </span>
        <div className="text-sm text-tertiary">Loading your workspace…</div>
      </div>
    </div>
  );
}
