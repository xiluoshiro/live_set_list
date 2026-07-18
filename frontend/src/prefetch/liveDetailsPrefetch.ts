import { getLiveDetailsBatch, getPerformances, type LiveItem, type PerformanceItem } from "../api";

type IdleWindow = Window & {
  requestIdleCallback?: (callback: IdleRequestCallback) => number;
  cancelIdleCallback?: (handle: number) => void;
};

type IdlePrefetchParams = {
  page: number;
  pageSize: 15 | 20;
  totalPages: number;
};

function normalizeLiveIds(items: LiveItem[]): number[] {
  const seen = new Set<number>();
  const ids: number[] = [];
  items.forEach((item) => {
    const id = item.live_id;
    if (!Number.isInteger(id) || id < 1 || seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  });
  return ids;
}

export async function prefetchCurrentPageDetails(items: LiveItem[]): Promise<void> {
  const liveIds = normalizeLiveIds(items);
  if (liveIds.length === 0) return;
  await getLiveDetailsBatch(liveIds);
}

function performanceLiveItems(items: PerformanceItem[]): LiveItem[] {
  return items.flatMap((item) => item.kind === "live" ? [item.live] : []);
}

export function scheduleIdleNextPagePrefetch(params: IdlePrefetchParams): () => void {
  const { page, pageSize, totalPages } = params;
  if (page >= totalPages) return () => undefined;

  const win = (typeof window !== "undefined" ? window : undefined) as IdleWindow | undefined;
  if (!win?.requestIdleCallback) return () => undefined;

  let canceled = false;
  const handle = win.requestIdleCallback(() => {
    if (canceled) return;
    void (async () => {
      try {
        const nextPageData = await getPerformances(page + 1, pageSize, "all");
        if (canceled) return;
        await prefetchCurrentPageDetails(performanceLiveItems(nextPageData.items));
      } catch {
        // 预读失败不影响主流程。
      }
    })();
  });

  return () => {
    canceled = true;
    if (win.cancelIdleCallback) {
      win.cancelIdleCallback(handle);
    }
  };
}

export function scheduleIdleFavoritePagePrefetch(pageSize: 15 | 20): () => void {
  const win = (typeof window !== "undefined" ? window : undefined) as IdleWindow | undefined;
  if (!win?.requestIdleCallback) return () => undefined;

  let canceled = false;
  const handle = win.requestIdleCallback(() => {
    if (canceled) return;
    void getPerformances(1, pageSize, "favorites")
      .then((data) => prefetchCurrentPageDetails(performanceLiveItems(data.items)))
      .catch(() => undefined);
  });

  return () => {
    canceled = true;
    if (win.cancelIdleCallback) {
      win.cancelIdleCallback(handle);
    }
  };
}
