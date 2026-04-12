import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ApiError, favoriteLive, favoriteLivesBatch, unfavoriteLive } from "../api";
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
  setFavoritesBatch: (liveIds: number[], desired: boolean) => Promise<void>;
  reconcileFavorites: () => Promise<void>;
};

const FavoritesContext = createContext<FavoritesContextValue | null>(null);

export function FavoriteProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const [state, setState] = useState<FavoritesState>(anonymousFavoritesState);
  const stateRef = useRef(state);
  const authRef = useRef(auth);
  const hasPendingFavoriteChangesRef = useRef(false);

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
    hasPendingFavoriteChangesRef.current = false;
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

  // 单条收藏同步机：同一 liveId 串行发送，确保“最后一次点击意图”最终落库。
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
      hasPendingFavoriteChangesRef.current = shouldFlushAgain;

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
      hasPendingFavoriteChangesRef.current = true;

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
        hasPendingFavoriteChangesRef.current = true;
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
      // 批量收藏走一次后端 batch，再把 applied/noop/not_found 三类结果统一收敛到本地状态。
      setFavoritesBatch: async (liveIds: number[], desired: boolean) => {
        const latestAuth = authRef.current;
        if (!latestAuth.isAuthenticated || !latestAuth.csrfToken) {
          throw new ApiError("登录状态已失效，请重新登录", 401, "AUTH_SESSION_EXPIRED");
        }
        // 仅保留正整数 liveId，并去重，避免脏输入污染批量接口语义。
        const dedupedLiveIds = Array.from(
          new Set(liveIds.filter((liveId) => Number.isInteger(liveId) && liveId > 0)),
        );
        if (dedupedLiveIds.length === 0) {
          return;
        }

        logInfo("favorite_batch_click", { desired, count: dedupedLiveIds.length });
        hasPendingFavoriteChangesRef.current = true;

        // 先统一打乐观状态与 inFlight，保证 UI 在请求期间即时反映批量目标态。
        setState((prev) => {
          const nextFavoriteSyncById = { ...prev.favoriteSyncById };
          const nextOptimisticFavoriteIntents = { ...prev.optimisticFavoriteIntents };
          dedupedLiveIds.forEach((liveId) => {
            const prevSync = nextFavoriteSyncById[liveId];
            nextFavoriteSyncById[liveId] = {
              inFlight: true,
              lastAttemptSeq: (prevSync?.lastAttemptSeq ?? 0) + 1,
              lastErrorCode: null,
              lastErrorAt: null,
            };
            nextOptimisticFavoriteIntents[liveId] = desired;
          });
          return {
            ...prev,
            optimisticFavoriteIntents: nextOptimisticFavoriteIntents,
            favoriteSyncById: nextFavoriteSyncById,
          };
        });

        try {
          const payload = await favoriteLivesBatch(
            desired ? "favorite" : "unfavorite",
            dedupedLiveIds,
            latestAuth.csrfToken,
          );
          logInfo("favorite_batch_sync_success", {
            desired,
            requested_count: payload.requested_count,
            applied_count: payload.applied_live_ids.length,
            noop_count: payload.noop_live_ids.length,
            not_found_count: payload.not_found_live_ids.length,
          });

          const settledLiveIdSet = new Set([
            ...payload.applied_live_ids,
            ...payload.noop_live_ids,
            ...payload.not_found_live_ids,
          ]);
          // 后端返回后按三类结果做最终收敛：
          // applied/noop 会对齐服务端真值，not_found 只做本地同步状态收口。
          setState((prev) => {
            let nextServerFavoriteIds = prev.serverFavoriteIds;
            const nextOptimisticFavoriteIntents = { ...prev.optimisticFavoriteIntents };
            const nextFavoriteSyncById = { ...prev.favoriteSyncById };

            payload.applied_live_ids.forEach((liveId) => {
              nextServerFavoriteIds = applyFavoriteState(nextServerFavoriteIds, liveId, desired);
            });
            payload.noop_live_ids.forEach((liveId) => {
              nextServerFavoriteIds = applyFavoriteState(nextServerFavoriteIds, liveId, desired);
            });
            settledLiveIdSet.forEach((liveId) => {
              if (nextOptimisticFavoriteIntents[liveId] === desired) {
                delete nextOptimisticFavoriteIntents[liveId];
              }
              nextFavoriteSyncById[liveId] = {
                inFlight: false,
                lastAttemptSeq: nextFavoriteSyncById[liveId]?.lastAttemptSeq ?? 1,
                lastErrorCode: null,
                lastErrorAt: null,
              };
            });

            return {
              ...prev,
              serverFavoriteIds: nextServerFavoriteIds,
              optimisticFavoriteIntents: nextOptimisticFavoriteIntents,
              favoriteSyncById: nextFavoriteSyncById,
              favoriteConsecutiveFailureCount: 0,
              favoriteSyncWarning: null,
            };
          });
          hasPendingFavoriteChangesRef.current = false;
        } catch (error) {
          const isAuthError = isAuthSessionError(error);
          let warningShown = false;
          // 批量失败不回滚乐观意图：允许后续重试/手动刷新再收敛，同时累计失败阈值提示。
          setState((prev) => {
            const nextFailureCount = prev.favoriteConsecutiveFailureCount + 1;
            warningShown = nextFailureCount >= 3 && prev.favoriteSyncWarning !== FAVORITE_SYNC_WARNING_MESSAGE;
            const nextFavoriteSyncById = { ...prev.favoriteSyncById };
            dedupedLiveIds.forEach((liveId) => {
              nextFavoriteSyncById[liveId] = {
                inFlight: false,
                lastAttemptSeq: nextFavoriteSyncById[liveId]?.lastAttemptSeq ?? 1,
                lastErrorCode: error instanceof ApiError ? error.code : null,
                lastErrorAt: Date.now(),
              };
            });

            return {
              ...prev,
              favoriteSyncById: nextFavoriteSyncById,
              favoriteConsecutiveFailureCount: nextFailureCount,
              favoriteSyncWarning:
                nextFailureCount >= 3 ? FAVORITE_SYNC_WARNING_MESSAGE : prev.favoriteSyncWarning,
            };
          });
          logInfo("favorite_batch_sync_failed", {
            desired,
            count: dedupedLiveIds.length,
            message: error instanceof Error ? error.message : String(error),
            is_auth_error: isAuthError,
          });
          if (warningShown) {
            logInfo("favorite_sync_warning_shown", { liveId: -1 });
          }
          hasPendingFavoriteChangesRef.current = true;

          if (isAuthError) {
            throw error;
          }
        }
      },
      reconcileFavorites: async () => {
        if (!hasPendingFavoriteChangesRef.current && !stateRef.current.favoriteSyncWarning) {
          return;
        }
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
  setFavoritesBatch: async () => undefined,
  reconcileFavorites: async () => undefined,
};

export function useFavorites(): FavoritesContextValue {
  return useContext(FavoritesContext) ?? fallbackContext;
}
