import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ApiError, favoriteLive, unfavoriteLive } from "../api";
import { useAuth } from "../auth/AuthProvider";

const FAVORITE_SYNC_WARNING_MESSAGE = "收藏同步失败，请稍后重试或刷新页面确认";

type FavoriteSyncState = {
  inFlight: boolean;
  lastAttemptSeq: number;
  lastErrorCode: string | null;
  lastErrorAt: number | null;
};

type FavoritesState = {
  serverFavoriteIds: number[];
  optimisticFavoriteIntents: Record<number, boolean>;
  favoriteSyncById: Record<number, FavoriteSyncState>;
  favoriteConsecutiveFailureCount: number;
  favoriteSyncWarning: string | null;
};

type FavoritesContextValue = {
  favoriteLiveIds: number[];
  favoriteLiveIdSet: ReadonlySet<number>;
  favoriteSyncWarning: string | null;
  isFavoriteSyncing: (liveId: number) => boolean;
  toggleFavorite: (liveId: number) => Promise<void>;
};

const anonymousFavoritesState: FavoritesState = {
  serverFavoriteIds: [],
  optimisticFavoriteIntents: {},
  favoriteSyncById: {},
  favoriteConsecutiveFailureCount: 0,
  favoriteSyncWarning: null,
};

const FavoritesContext = createContext<FavoritesContextValue | null>(null);

function applyFavoriteState(ids: number[], liveId: number, desired: boolean): number[] {
  if (desired) {
    return ids.includes(liveId) ? ids : [...ids, liveId];
  }
  return ids.filter((id) => id !== liveId);
}

function buildEffectiveFavoriteIds(
  serverFavoriteIds: number[],
  optimisticFavoriteIntents: Record<number, boolean>,
): number[] {
  // 展示层优先看用户最新意图，再回退到最近一次服务端确认结果。
  const effective = new Set(serverFavoriteIds);
  Object.entries(optimisticFavoriteIntents).forEach(([rawLiveId, desired]) => {
    const liveId = Number(rawLiveId);
    if (!Number.isInteger(liveId)) return;
    if (desired) {
      effective.add(liveId);
    } else {
      effective.delete(liveId);
    }
  });
  return Array.from(effective).sort((left, right) => left - right);
}

function getEffectiveFavoriteState(state: FavoritesState, liveId: number): boolean {
  const intent = state.optimisticFavoriteIntents[liveId];
  if (intent !== undefined) {
    return intent;
  }
  return state.serverFavoriteIds.includes(liveId);
}

function isAuthSessionError(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 401 || error.status === 403);
}

export function FavoriteProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const [state, setState] = useState<FavoritesState>(anonymousFavoritesState);
  const stateRef = useRef(state);
  const authRef = useRef(auth);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    authRef.current = auth;
  }, [auth]);

  useEffect(() => {
    if (!auth.isAuthenticated) {
      setState(anonymousFavoritesState);
      return;
    }
    // 登录恢复或重新登录后，用当前会话载荷重建服务端真值并清理旧同步状态。
    setState({
      serverFavoriteIds: auth.sessionFavoriteLiveIds,
      optimisticFavoriteIntents: {},
      favoriteSyncById: {},
      favoriteConsecutiveFailureCount: 0,
      favoriteSyncWarning: null,
    });
  }, [auth.isAuthenticated, auth.user?.id, auth.favoriteSnapshotVersion]);

  const flushFavoriteIntentRef = useRef<
    (liveId: number, desiredOverride?: boolean) => Promise<void>
  >(async () => undefined);

  flushFavoriteIntentRef.current = async (liveId: number, desiredOverride?: boolean) => {
    // 同一 liveId 始终只允许一条同步请求在飞，避免快速连点把旧响应写回最新意图。
    const snapshot = stateRef.current;
    const authSnapshot = authRef.current;
    const currentSync = snapshot.favoriteSyncById[liveId];
    if (currentSync?.inFlight) {
      return;
    }
    if (!authSnapshot.isAuthenticated || !authSnapshot.csrfToken) {
      throw new ApiError("登录状态已失效，请重新登录", 401, "AUTH_SESSION_EXPIRED");
    }

    const desired = desiredOverride ?? getEffectiveFavoriteState(snapshot, liveId);
    const attemptSeq = (currentSync?.lastAttemptSeq ?? 0) + 1;
    setState((prev) => ({
      ...prev,
      favoriteSyncById: {
        ...prev.favoriteSyncById,
        [liveId]: {
          inFlight: true,
          lastAttemptSeq: attemptSeq,
          lastErrorCode: null,
          lastErrorAt: null,
        },
      },
    }));

    try {
      if (desired) {
        await favoriteLive(liveId, authSnapshot.csrfToken);
      } else {
        await unfavoriteLive(liveId, authSnapshot.csrfToken);
      }

      let shouldFlushAgain = false;
      setState((prev) => {
        // 请求返回后再次读取当前意图；如果用户在飞行期间改过目标态，则补发下一轮同步。
        const nextServerFavoriteIds = applyFavoriteState(prev.serverFavoriteIds, liveId, desired);
        const nextOptimisticFavoriteIntents = { ...prev.optimisticFavoriteIntents };
        const latestDesired = nextOptimisticFavoriteIntents[liveId];
        if (latestDesired === desired) {
          delete nextOptimisticFavoriteIntents[liveId];
        } else if (latestDesired !== undefined) {
          shouldFlushAgain = true;
        }

        return {
          ...prev,
          serverFavoriteIds: nextServerFavoriteIds,
          optimisticFavoriteIntents: nextOptimisticFavoriteIntents,
          favoriteSyncById: {
            ...prev.favoriteSyncById,
            [liveId]: {
              inFlight: false,
              lastAttemptSeq: attemptSeq,
              lastErrorCode: null,
              lastErrorAt: null,
            },
          },
          favoriteConsecutiveFailureCount: 0,
          favoriteSyncWarning: null,
        };
      });

      if (shouldFlushAgain) {
        void flushFavoriteIntentRef.current(liveId);
      }
    } catch (error) {
      const isAuthError = isAuthSessionError(error);

      setState((prev) => {
        const nextFailureCount = prev.favoriteConsecutiveFailureCount + 1;
        return {
          ...prev,
          favoriteSyncById: {
            ...prev.favoriteSyncById,
            [liveId]: {
              inFlight: false,
              lastAttemptSeq: attemptSeq,
              lastErrorCode: error instanceof ApiError ? error.code : null,
              lastErrorAt: Date.now(),
            },
          },
          favoriteConsecutiveFailureCount: nextFailureCount,
          favoriteSyncWarning:
            nextFailureCount >= 3 ? FAVORITE_SYNC_WARNING_MESSAGE : prev.favoriteSyncWarning,
        };
      });

      if (isAuthError) {
        throw error;
      }
    }
  };

  const value = useMemo<FavoritesContextValue>(() => {
    const favoriteLiveIds = buildEffectiveFavoriteIds(
      state.serverFavoriteIds,
      state.optimisticFavoriteIntents,
    );
    const favoriteLiveIdSet = new Set(favoriteLiveIds);

    return {
      favoriteLiveIds,
      favoriteLiveIdSet,
      favoriteSyncWarning: state.favoriteSyncWarning,
      isFavoriteSyncing: (liveId: number) => Boolean(state.favoriteSyncById[liveId]?.inFlight),
      toggleFavorite: async (liveId: number) => {
        // 点击时先切换乐观展示，再在后台按当前最终意图发起单飞同步。
        const latestAuth = authRef.current;
        const latestState = stateRef.current;
        if (!latestAuth.isAuthenticated || !latestAuth.csrfToken) {
          throw new ApiError("登录状态已失效，请重新登录", 401, "AUTH_SESSION_EXPIRED");
        }
        const nextDesired = !getEffectiveFavoriteState(latestState, liveId);
        setState((prev) => ({
          ...prev,
          optimisticFavoriteIntents: {
            ...prev.optimisticFavoriteIntents,
            [liveId]: nextDesired,
          },
        }));
        const syncState = stateRef.current.favoriteSyncById[liveId];
        if (!syncState?.inFlight) {
          await flushFavoriteIntentRef.current(liveId, nextDesired);
        }
      },
    };
  }, [state]);

  return <FavoritesContext.Provider value={value}>{children}</FavoritesContext.Provider>;
}

const fallbackContext: FavoritesContextValue = {
  favoriteLiveIds: [],
  favoriteLiveIdSet: new Set<number>(),
  favoriteSyncWarning: null,
  isFavoriteSyncing: () => false,
  toggleFavorite: async () => undefined,
};

export function useFavorites(): FavoritesContextValue {
  return useContext(FavoritesContext) ?? fallbackContext;
}
