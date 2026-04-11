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
import { logInfo } from "../logger";
import {
  FAVORITE_SYNC_WARNING_MESSAGE,
  anonymousFavoritesState,
  applyFavoriteState,
  buildEffectiveFavoriteIds,
  getEffectiveFavoriteState,
  isAuthSessionError,
  type FavoritesState,
} from "./favoriteSync";

type FavoritesContextValue = {
  favoriteLiveIds: number[];
  favoriteLiveIdSet: ReadonlySet<number>;
  favoriteSyncWarning: string | null;
  isFavoriteSyncing: (liveId: number) => boolean;
  toggleFavorite: (liveId: number) => Promise<void>;
  reconcileFavorites: () => Promise<void>;
};

const FavoritesContext = createContext<FavoritesContextValue | null>(null);

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
    logInfo("favorite_sync_reconcile", {
      source: "auth_snapshot",
      favorite_count: auth.sessionFavoriteLiveIds.length,
    });
  }, [auth.isAuthenticated, auth.user?.id, auth.favoriteSnapshotVersion]);

  const flushFavoriteIntentRef = useRef<
    (
      liveId: number,
      desiredOverride?: boolean,
      options?: { allowInFlightBypass?: boolean },
    ) => Promise<void>
  >(async () => undefined);

  flushFavoriteIntentRef.current = async (
    liveId: number,
    desiredOverride?: boolean,
    options?: { allowInFlightBypass?: boolean },
  ) => {
    // 同一 liveId 始终只允许一条同步请求在飞，避免快速连点把旧响应写回最新意图。
    const snapshot = stateRef.current;
    const authSnapshot = authRef.current;
    const currentSync = snapshot.favoriteSyncById[liveId];
    if (currentSync?.inFlight && !options?.allowInFlightBypass) {
      return;
    }
    if (!authSnapshot.isAuthenticated || !authSnapshot.csrfToken) {
      throw new ApiError("登录状态已失效，请重新登录", 401, "AUTH_SESSION_EXPIRED");
    }

    const desired = desiredOverride ?? getEffectiveFavoriteState(snapshot, liveId);
    const attemptSeq = (currentSync?.lastAttemptSeq ?? 0) + 1;
    logInfo("favorite_sync_start", { liveId, desired, attempt_seq: attemptSeq });
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
      logInfo("favorite_sync_success", { liveId, desired, attempt_seq: attemptSeq });

      // 注意：setState(updater) 不是同步立即执行，补发判定要先基于 stateRef 快照算出来，
      // 不能依赖 updater 回调里对外部变量的赋值结果。
      const latestDesiredIntent = stateRef.current.optimisticFavoriteIntents[liveId];
      const shouldFlushAgain = latestDesiredIntent !== undefined && latestDesiredIntent !== desired;
      setState((prev) => {
        // 请求返回后再次读取当前意图；如果用户在飞行期间改过目标态，则补发下一轮同步。
        const nextServerFavoriteIds = applyFavoriteState(prev.serverFavoriteIds, liveId, desired);
        const nextOptimisticFavoriteIntents = { ...prev.optimisticFavoriteIntents };
        const latestDesired = nextOptimisticFavoriteIntents[liveId];
        if (latestDesired === desired) {
          delete nextOptimisticFavoriteIntents[liveId];
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

      if (shouldFlushAgain && latestDesiredIntent !== undefined) {
        // 补发链路允许绕过旧快照里的 inFlight 窗口：
        // 此时上一轮已成功并即将落地为 inFlight=false，如果不 bypass 会被错误短路。
        void flushFavoriteIntentRef.current(liveId, latestDesiredIntent, {
          allowInFlightBypass: true,
        });
      }
    } catch (error) {
      const isAuthError = isAuthSessionError(error);

      let warningShown = false;
      setState((prev) => {
        const nextFailureCount = prev.favoriteConsecutiveFailureCount + 1;
        warningShown = nextFailureCount >= 3 && prev.favoriteSyncWarning !== FAVORITE_SYNC_WARNING_MESSAGE;
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
      logInfo("favorite_sync_failed", {
        liveId,
        desired,
        attempt_seq: attemptSeq,
        message: error instanceof Error ? error.message : String(error),
        is_auth_error: isAuthError,
      });
      if (warningShown) {
        logInfo("favorite_sync_warning_shown", { liveId });
      }

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
        logInfo("favorite_click", { liveId, desired: nextDesired });
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
      reconcileFavorites: async () => {
        // 进入“收藏”页时用最新 session 快照整体收敛一次，清理前面残留的乐观偏差。
        logInfo("favorite_sync_reconcile", { source: "favorites_tab" });
        await authRef.current.refreshSession();
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
  reconcileFavorites: async () => undefined,
};

export function useFavorites(): FavoritesContextValue {
  return useContext(FavoritesContext) ?? fallbackContext;
}
