import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  DEFAULT_SETTINGS,
  roleHasAll,
  roleHasAny,
  type CurrentUser,
  type LoginDto,
  type LoginResult,
  type OrganisationSettings,
  type Permission,
} from '@ciq/shared';
import { api, onSessionExpired, tokenStore } from './api';

interface AuthContextValue {
  user: CurrentUser | null;
  /** Organisation settings, or documented defaults before sign-in. */
  settings: OrganisationSettings;
  isLoading: boolean;
  login: (credentials: LoginDto) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  /** True when the signed-in role carries every permission listed. */
  can: (...permissions: Permission[]) => boolean;
  /** True when the role carries at least one. */
  canAny: (...permissions: Permission[]) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const queryClient = useQueryClient();

  const loadUser = useCallback(async () => {
    if (!tokenStore.access) {
      setUser(null);
      setIsLoading(false);
      return;
    }
    try {
      setUser(await api.get<CurrentUser>('/auth/me'));
    } catch {
      // A failure here means the token is unusable; the client has already
      // cleared it, so simply fall back to signed-out.
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadUser();
  }, [loadUser]);

  // The API client raises this when a refresh fails. Clearing the cache matters:
  // without it, the next user to sign in on this browser briefly sees the
  // previous user's projects rendered from stale query data.
  useEffect(
    () =>
      onSessionExpired(() => {
        setUser(null);
        queryClient.clear();
      }),
    [queryClient],
  );

  const login = useCallback(
    async (credentials: LoginDto) => {
      const result = await api.post<LoginResult>('/auth/login', credentials, { anonymous: true });
      tokenStore.set(result);
      setUser(result.user);
      queryClient.clear();
    },
    [queryClient],
  );

  const logout = useCallback(async () => {
    const refreshToken = tokenStore.refresh;
    // Best effort: clear locally even if the server call fails, so a network
    // problem cannot leave someone apparently signed in.
    try {
      if (refreshToken) await api.post('/auth/logout', { refreshToken }, { anonymous: true });
    } catch {
      /* ignore */
    }
    tokenStore.clear();
    setUser(null);
    queryClient.clear();
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      settings: user?.settings ?? DEFAULT_SETTINGS,
      isLoading,
      login,
      logout,
      refreshUser: loadUser,
      // These only decide whether a control is rendered. The API enforces the
      // same matrix on every request — hiding a button is not access control.
      can: (...permissions) => (user ? roleHasAll(user.role, permissions) : false),
      canAny: (...permissions) => (user ? roleHasAny(user.role, permissions) : false),
    }),
    [user, isLoading, login, logout, loadUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}

/** Convenience for the common `settings.orderSoonWindowDays` style read. */
export function useSettings(): OrganisationSettings {
  return useAuth().settings;
}
