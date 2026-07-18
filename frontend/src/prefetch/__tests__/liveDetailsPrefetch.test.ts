import { beforeEach, describe, expect, test, vi } from "vitest";

import { getLiveDetailsBatch, getPerformances, type LiveItem } from "../../api";
import {
  prefetchCurrentPageDetails,
  scheduleIdleFavoritePagePrefetch,
  scheduleIdleNextPagePrefetch,
} from "../liveDetailsPrefetch";

vi.mock("../../api", () => ({
  getPerformances: vi.fn(),
  getLiveDetailsBatch: vi.fn(),
}));

const getPerformancesMock = vi.mocked(getPerformances);
const getLiveDetailsBatchMock = vi.mocked(getLiveDetailsBatch);

function makeLiveItem(id: number): LiveItem {
  return {
    live_id: id,
    live_date: "2026-03-28",
    live_title: `Live ${id}`,
    live_type: "oneman",
    bands: [1],
    url: null,
    is_favorite: false,
  };
}

describe("liveDetailsPrefetch", () => {
  beforeEach(() => {
    getPerformancesMock.mockReset();
    getLiveDetailsBatchMock.mockReset();
    getLiveDetailsBatchMock.mockResolvedValue({ items: [], missing_live_ids: [] });
    getPerformancesMock.mockResolvedValue({
      items: [],
      pagination: { page: 1, page_size: 20, total: 0, total_pages: 1 },
    });
    Reflect.deleteProperty(window, "requestIdleCallback");
    Reflect.deleteProperty(window, "cancelIdleCallback");
  });

  test("prefetchCurrentPageDetails 会去重并过滤非法 live_id", async () => {
    // 测试点：当前页预读应只发送有效且去重后的 live_ids。
    await prefetchCurrentPageDetails([
      makeLiveItem(2),
      makeLiveItem(2),
      makeLiveItem(1),
      { ...makeLiveItem(3), live_id: 0 },
      { ...makeLiveItem(4), live_id: Number.NaN },
    ]);

    expect(getLiveDetailsBatchMock).toHaveBeenCalledTimes(1);
    expect(getLiveDetailsBatchMock).toHaveBeenCalledWith([2, 1]);
  });

  test("prefetchCurrentPageDetails 无有效 live_id 时不会调用 batch", async () => {
    // 测试点：空/非法数据应短路，避免产生无效请求。
    await prefetchCurrentPageDetails([
      { ...makeLiveItem(1), live_id: 0 },
      { ...makeLiveItem(2), live_id: -3 },
    ]);

    expect(getLiveDetailsBatchMock).not.toHaveBeenCalled();
  });

  test("scheduleIdleNextPagePrefetch 到最后一页时不调度", () => {
    // 测试点：当前已是最后一页，不应挂 idle 预读任务。
    const requestIdleCallback = vi.fn();
    (window as Window & { requestIdleCallback?: unknown }).requestIdleCallback = requestIdleCallback;

    scheduleIdleNextPagePrefetch({ page: 2, pageSize: 20, totalPages: 2 });
    expect(requestIdleCallback).not.toHaveBeenCalled();
    expect(getPerformancesMock).not.toHaveBeenCalled();
  });

  test("scheduleIdleNextPagePrefetch 取消后不会触发下一页请求", async () => {
    // 测试点：调用 cancel 后，即使 idle callback 触发，也不应再请求下一页。
    const state: { triggerIdle?: () => void } = {};
    const requestIdleCallback = vi.fn((callback: (deadline: IdleDeadline) => void) => {
      state.triggerIdle = () => {
        callback({ didTimeout: false, timeRemaining: () => 50 } as IdleDeadline);
      };
      return 7;
    });
    const cancelIdleCallback = vi.fn();
    (window as Window & { requestIdleCallback?: unknown; cancelIdleCallback?: unknown }).requestIdleCallback =
      requestIdleCallback;
    (window as Window & { requestIdleCallback?: unknown; cancelIdleCallback?: unknown }).cancelIdleCallback =
      cancelIdleCallback;

    const cancel = scheduleIdleNextPagePrefetch({ page: 1, pageSize: 20, totalPages: 3 });
    cancel();

    state.triggerIdle?.();
    await Promise.resolve();

    expect(cancelIdleCallback).toHaveBeenCalledWith(7);
    expect(getPerformancesMock).not.toHaveBeenCalled();
    expect(getLiveDetailsBatchMock).not.toHaveBeenCalled();
  });

  test("scheduleIdleNextPagePrefetch 在不支持 requestIdleCallback 时安全降级", () => {
    // 测试点：浏览器不支持 idle API 时应直接返回 noop，不抛错。
    const cancel = scheduleIdleNextPagePrefetch({ page: 1, pageSize: 20, totalPages: 3 });
    expect(() => cancel()).not.toThrow();
    expect(getPerformancesMock).not.toHaveBeenCalled();
  });

  test("scheduleIdleFavoritePagePrefetch 只预读收藏投影中的单场详情", async () => {
    // 测试点：收藏统一投影中的活动组 ID 不会被误当作 live_id 预读。
    getPerformancesMock.mockResolvedValue({
      items: [
        { kind: "live", live: makeLiveItem(8) },
        {
          kind: "performance_group",
          performance_group: {
            kind: "performance_group",
            group_id: 8,
            group_title: "Group 8",
            start_date: "2026-03-28",
            end_date: "2026-03-29",
            day_count: 2,
            live_count: 2,
            display_type: "multi_day",
            bands: [],
            venues: [],
          },
        },
      ],
      pagination: { page: 1, page_size: 20, total: 2, total_pages: 1 },
    });
    const requestIdleCallback = vi.fn((callback: (deadline: IdleDeadline) => void) => {
      callback({ didTimeout: false, timeRemaining: () => 50 } as IdleDeadline);
      return 1;
    });
    (window as Window & { requestIdleCallback?: unknown }).requestIdleCallback = requestIdleCallback;

    scheduleIdleFavoritePagePrefetch(20);
    await vi.waitFor(() => expect(getLiveDetailsBatchMock).toHaveBeenCalledWith([8]));

    expect(getPerformancesMock).toHaveBeenCalledWith(1, 20, "favorites");
  });
});
