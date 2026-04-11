import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { getAuthMe, login, logout, type AuthUser } from "../api";
import { logError } from "../logger";

type AuthContextValue = {
  isLoading: boolean;
  isAuthenticated: boolean;
  user: AuthUser | null;
  csrfToken: string | null;
  sessionFavoriteLiveIds: number[];
  favoriteSnapshotVersion: number;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setAnonymous: () => void;
};

type AuthState = {
  isLoading: boolean;
  isAuthenticated: boolean;
  user: AuthUser | null;
  csrfToken: string | null;
  sessionFavoriteLiveIds: number[];
  favoriteSnapshotVersion: number;
};

const anonymousState: AuthState = {
  isLoading: false,
  isAuthenticated: false,
  user: null,
  csrfToken: null,
  sessionFavoriteLiveIds: [],
  favoriteSnapshotVersion: 0,
};

const AuthContext = createContext<AuthContextValue | null>(null);

function toAuthenticatedState(params: {
  user: AuthUser;
  csrfToken: string;
  favoriteLiveIds: number[];
}): AuthState {
  return {
    isLoading: false,
    isAuthenticated: true,
    user: params.user,
    csrfToken: params.csrfToken,
    sessionFavoriteLiveIds: params.favoriteLiveIds,
    favoriteSnapshotVersion: Date.now(),
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    ...anonymousState,
    isLoading: true,
  });

  useEffect(() => {
    let canceled = false;

    // 启动时先恢复一次登录态，避免页面先按匿名渲染再闪回已登录状态。
    const restoreSession = async () => {
      try {
        const payload = await getAuthMe();
        if (canceled) return;
        if (!payload.authenticated) {
          setState(anonymousState);
          return;
        }
        setState(
          toAuthenticatedState({
            user: payload.user,
            csrfToken: payload.csrf_token,
            favoriteLiveIds: payload.favorite_live_ids,
          }),
        );
      } catch (error) {
        if (canceled) return;
        logError("restore_auth_session_failed", {
          message: error instanceof Error ? error.message : String(error),
        });
        setState(anonymousState);
      }
    };

    void restoreSession();
    return () => {
      canceled = true;
    };
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    return {
      isLoading: state.isLoading,
      isAuthenticated: state.isAuthenticated,
      user: state.user,
      csrfToken: state.csrfToken,
      // favorites 域据此判断“当前服务端快照是否整体换了一份”，从而重建本地同步状态。
      sessionFavoriteLiveIds: state.sessionFavoriteLiveIds,
      favoriteSnapshotVersion: state.favoriteSnapshotVersion,
      login: async (username: string, password: string) => {
        const payload = await login(username, password);
        setState(
          toAuthenticatedState({
            user: payload.user,
            csrfToken: payload.csrf_token,
            favoriteLiveIds: payload.favorite_live_ids,
          }),
        );
      },
      logout: async () => {
        await logout(state.csrfToken);
        setState(anonymousState);
      },
      setAnonymous: () => setState(anonymousState),
    };
  }, [state]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

const fallbackContext: AuthContextValue = {
  ...anonymousState,
  sessionFavoriteLiveIds: [],
  favoriteSnapshotVersion: 0,
  login: async () => undefined,
  logout: async () => undefined,
  setAnonymous: () => undefined,
};

export function useAuth(): AuthContextValue {
  return useContext(AuthContext) ?? fallbackContext;
}
