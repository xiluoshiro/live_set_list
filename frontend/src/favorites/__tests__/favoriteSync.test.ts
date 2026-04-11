import { ApiError } from "../../api";
import {
  applyFavoriteState,
  buildEffectiveFavoriteIds,
  getEffectiveFavoriteState,
  isAuthSessionError,
  type FavoritesState,
} from "../favoriteSync";

describe("favoriteSync helpers", () => {
  test("applyFavoriteState 能正确执行 add/remove 且保持幂等", () => {
    // 测试点：重复 add 不应产生重复项，remove 不存在项不应污染集合。
    const afterAdd = applyFavoriteState([1, 2], 3, true);
    expect(afterAdd).toEqual([1, 2, 3]);

    const afterDuplicateAdd = applyFavoriteState(afterAdd, 3, true);
    expect(afterDuplicateAdd).toEqual([1, 2, 3]);

    const afterRemove = applyFavoriteState(afterDuplicateAdd, 2, false);
    expect(afterRemove).toEqual([1, 3]);

    const afterRemoveMissing = applyFavoriteState(afterRemove, 99, false);
    expect(afterRemoveMissing).toEqual([1, 3]);
  });

  test("buildEffectiveFavoriteIds 以 server 为基准再应用 optimistic 覆盖", () => {
    // 测试点：乐观层 true/false 覆盖 server 真值，最终结果按升序输出。
    const ids = buildEffectiveFavoriteIds(
      [2, 4],
      {
        1: true,
        2: false,
        3: true,
      },
    );
    expect(ids).toEqual([1, 3, 4]);
  });

  test("getEffectiveFavoriteState 优先读取 optimistic，没有时回退 server", () => {
    // 测试点：同一 liveId 有 intent 时以 intent 为准，否则看 serverFavoriteIds。
    const state: FavoritesState = {
      serverFavoriteIds: [1, 2],
      optimisticFavoriteIntents: {
        1: false,
        3: true,
      },
      favoriteSyncById: {},
      favoriteConsecutiveFailureCount: 0,
      favoriteSyncWarning: null,
    };

    expect(getEffectiveFavoriteState(state, 1)).toBe(false);
    expect(getEffectiveFavoriteState(state, 2)).toBe(true);
    expect(getEffectiveFavoriteState(state, 3)).toBe(true);
    expect(getEffectiveFavoriteState(state, 99)).toBe(false);
  });

  test("isAuthSessionError 仅识别 ApiError(401/403)", () => {
    // 测试点：401/403 认证错误必须被识别，普通错误和其他状态码不应误判。
    expect(isAuthSessionError(new ApiError("expired", 401, "AUTH_SESSION_EXPIRED"))).toBe(true);
    expect(isAuthSessionError(new ApiError("forbidden", 403, "AUTH_FORBIDDEN"))).toBe(true);
    expect(isAuthSessionError(new ApiError("bad request", 400, "BAD_REQUEST"))).toBe(false);
    expect(isAuthSessionError(new Error("timeout"))).toBe(false);
    expect(isAuthSessionError("unknown")).toBe(false);
  });
});
