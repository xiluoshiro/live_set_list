import { beforeEach, describe, expect, test, vi } from "vitest";

import { getLiveDetailsBatch, getLives, type LiveItem } from "../../api";
import { prefetchCurrentPageDetails, scheduleIdleNextPagePrefetch } from "../liveDetailsPrefetch";

vi.mock("../../api", () => ({
  getLives: vi.fn(),
  getLiveDetailsBatch: vi.fn(),
}));

const getLivesMock = vi.mocked(getLives);
const getLiveDetailsBatchMock = vi.mocked(getLiveDetailsBatch);

function makeLiveItem(id: number): LiveItem {
  return {
    live_id: id,
    live_date: "2026-03-28",
    live_title: `Live ${id}`,
    bands: [1],
    url: null,
  };
}

describe("liveDetailsPrefetch", () => {
  beforeEach(() => {
    getLivesMock.mockReset();
    getLiveDetailsBatchMock.mockReset();
    getLiveDetailsBatchMock.mockResolvedValue({ items: [], missing_live_ids: [] });
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
    expect(getLivesMock).not.toHaveBeenCalled();
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
    expect(getLivesMock).not.toHaveBeenCalled();
    expect(getLiveDetailsBatchMock).not.toHaveBeenCalled();
  });

  test("scheduleIdleNextPagePrefetch 在不支持 requestIdleCallback 时安全降级", () => {
    // 测试点：浏览器不支持 idle API 时应直接返回 noop，不抛错。
    const cancel = scheduleIdleNextPagePrefetch({ page: 1, pageSize: 20, totalPages: 3 });
    expect(() => cancel()).not.toThrow();
    expect(getLivesMock).not.toHaveBeenCalled();
  });
});
