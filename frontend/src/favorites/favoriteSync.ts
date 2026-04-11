import { ApiError } from "../api";

export const FAVORITE_SYNC_WARNING_MESSAGE = "收藏同步失败，请稍后重试或刷新页面确认";

export type FavoriteSyncState = {
  inFlight: boolean;
  lastAttemptSeq: number;
  lastErrorCode: string | null;
  lastErrorAt: number | null;
};

export type FavoritesState = {
  serverFavoriteIds: number[];
  optimisticFavoriteIntents: Record<number, boolean>;
  favoriteSyncById: Record<number, FavoriteSyncState>;
  favoriteConsecutiveFailureCount: number;
  favoriteSyncWarning: string | null;
};

export const anonymousFavoritesState: FavoritesState = {
  serverFavoriteIds: [],
  optimisticFavoriteIntents: {},
  favoriteSyncById: {},
  favoriteConsecutiveFailureCount: 0,
  favoriteSyncWarning: null,
};

export function applyFavoriteState(ids: number[], liveId: number, desired: boolean): number[] {
  if (desired) {
    return ids.includes(liveId) ? ids : [...ids, liveId];
  }
  return ids.filter((id) => id !== liveId);
}

export function buildEffectiveFavoriteIds(
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

export function getEffectiveFavoriteState(state: FavoritesState, liveId: number): boolean {
  const intent = state.optimisticFavoriteIntents[liveId];
  if (intent !== undefined) {
    return intent;
  }
  return state.serverFavoriteIds.includes(liveId);
}

export function isAuthSessionError(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 401 || error.status === 403);
}
