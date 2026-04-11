import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  ApiError,
  favoriteLive as favoriteLiveRequest,
  getAuthMe,
  login,
  logout,
  unfavoriteLive as unfavoriteLiveRequest,
  type AuthUser,
} from "../api";
import { logError } from "../logger";

type AuthContextValue = {
  isLoading: boolean;
  isAuthenticated: boolean;
  user: AuthUser | null;
  csrfToken: string | null;
  favoriteLiveIds: number[];
  favoriteLiveIdSet: ReadonlySet<number>;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  favoriteLive: (liveId: number) => Promise<void>;
  unfavoriteLive: (liveId: number) => Promise<void>;
  setAnonymous: () => void;
};

type AuthState = {
  isLoading: boolean;
  isAuthenticated: boolean;
  user: AuthUser | null;
  csrfToken: string | null;
  favoriteLiveIds: number[];
};

const anonymousState: AuthState = {
  isLoading: false,
  isAuthenticated: false,
  user: null,
  csrfToken: null,
  favoriteLiveIds: [],
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
    favoriteLiveIds: params.favoriteLiveIds,
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
    const favoriteLiveIdSet = new Set(state.favoriteLiveIds);

    return {
      ...state,
      favoriteLiveIdSet,
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
      favoriteLive: async (liveId: number) => {
        if (!state.csrfToken) {
          throw new ApiError("登录状态已失效，请重新登录", 401, "AUTH_SESSION_EXPIRED");
        }
        await favoriteLiveRequest(liveId, state.csrfToken);
        setState((prev) => ({
          ...prev,
          favoriteLiveIds: prev.favoriteLiveIds.includes(liveId)
            ? prev.favoriteLiveIds
            : [...prev.favoriteLiveIds, liveId],
        }));
      },
      unfavoriteLive: async (liveId: number) => {
        if (!state.csrfToken) {
          throw new ApiError("登录状态已失效，请重新登录", 401, "AUTH_SESSION_EXPIRED");
        }
        await unfavoriteLiveRequest(liveId, state.csrfToken);
        setState((prev) => ({
          ...prev,
          favoriteLiveIds: prev.favoriteLiveIds.filter((id) => id !== liveId),
        }));
      },
      setAnonymous: () => setState(anonymousState),
    };
  }, [state]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

const fallbackContext: AuthContextValue = {
  ...anonymousState,
  favoriteLiveIdSet: new Set<number>(),
  login: async () => undefined,
  logout: async () => undefined,
  favoriteLive: async () => undefined,
  unfavoriteLive: async () => undefined,
  setAnonymous: () => undefined,
};

export function useAuth(): AuthContextValue {
  return useContext(AuthContext) ?? fallbackContext;
}
