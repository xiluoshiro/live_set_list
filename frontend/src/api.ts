import { LruRequestCache, RecentPromiseDebouncer } from "./cache/queryCache";
import { logError, logInfo } from "./logger";

export type DbHealthResponse = {
  ok: boolean;
  result: number | null;
};

export type LiveItem = {
  live_id: number;
  live_date: string;
  live_title: string;
  bands: Array<number | string>;
  url: string | null;
};

export type LivesResponse = {
  items: LiveItem[];
  pagination: {
    page: number;
    page_size: number;
    total: number;
    total_pages: number;
  };
};

export type LiveDetailBandMember = {
  band_id: number | null;
  band_name: string;
  present_members: string[];
  present_count: number;
  total_count: number;
  is_full: boolean;
};

export type LiveDetailOtherMember = {
  key: string;
  value: string[];
};

export type LiveDetailRow = {
  row_id: string;
  song_name: string;
  band_members: LiveDetailBandMember[];
  other_members: LiveDetailOtherMember[];
  comments: string[];
};

export type LiveDetailResponse = {
  live_id: number;
  live_date: string;
  live_title: string;
  venue: string | null;
  opening_time: string | null;
  start_time: string | null;
  bands: number[];
  band_names: string[];
  url: string | null;
  detail_rows: LiveDetailRow[];
};

export type LiveDetailsBatchResponse = {
  items: LiveDetailResponse[];
  missing_live_ids: number[];
};

const BASE_URL = "http://localhost:8000";
const REQUEST_TIMEOUT_MS = 10000;
const LIVES_CACHE_TTL_MS = 15 * 60 * 1000;
const DETAIL_CACHE_TTL_MS = 30 * 60 * 1000;
const LIVES_CACHE_MAX = 20;
const DETAIL_CACHE_MAX = 100;
const DETAIL_REQUEST_DEBOUNCE_MS = 300;
const DETAIL_BATCH_MAX_IDS = 100;

const livesCache = new LruRequestCache<LivesResponse>(LIVES_CACHE_MAX);
const detailCache = new LruRequestCache<LiveDetailResponse>(DETAIL_CACHE_MAX);
const detailRecentRequest = new RecentPromiseDebouncer<number, LiveDetailResponse>();

function livesCacheKey(page: number, pageSize: 15 | 20): string {
  return `lives:${page}:${pageSize}`;
}

function detailCacheKey(liveId: number): string {
  return `detail:${liveId}`;
}

type RequestKind = "health" | "lives" | "live_detail" | "live_details_batch";

type RequestLogMeta = {
  requestKind: RequestKind;
  method?: string;
};

async function fetchWithTimeout(
  input: string,
  init?: RequestInit,
  meta?: RequestLogMeta,
): Promise<Response> {
  const method = meta?.method ?? init?.method ?? "GET";
  const requestKind = meta?.requestKind ?? "lives";
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const startedAt = performance.now();
  // 只在真实发起 fetch 时记录网络日志，缓存命中路径不会走到这里。
  logInfo("api_request_start", {
    method,
    url: input,
    request_kind: requestKind,
  });
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    const durationMs = Math.round((performance.now() - startedAt) * 100) / 100;
    const payload = {
      method,
      url: input,
      request_kind: requestKind,
      status: response.status,
      duration_ms: durationMs,
    };
    if (response.ok) {
      logInfo("api_request_success", payload);
    } else {
      // 非 2xx 也先记录下来，再交给调用方统一抛错。
      logError("api_request_error", {
        ...payload,
        message: `Request failed: ${response.status}`,
      });
    }
    return response;
  } catch (error) {
    const durationMs = Math.round((performance.now() - startedAt) * 100) / 100;
    const message =
      error instanceof DOMException && error.name === "AbortError"
        ? "Request timeout"
        : error instanceof Error
          ? error.message
          : String(error);
    logError("api_request_error", {
      method,
      url: input,
      request_kind: requestKind,
      duration_ms: durationMs,
      message,
    });
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Request timeout");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function checkDbHealth(): Promise<DbHealthResponse> {
  const response = await fetchWithTimeout(`${BASE_URL}/api/health/db`, undefined, {
    requestKind: "health",
  });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return (await response.json()) as DbHealthResponse;
}

async function fetchLivesRemote(page: number, pageSize: 15 | 20): Promise<LivesResponse> {
  const query = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
  });
  const response = await fetchWithTimeout(`${BASE_URL}/api/lives?${query.toString()}`, undefined, {
    requestKind: "lives",
  });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return (await response.json()) as LivesResponse;
}

async function fetchLiveDetailRemote(liveId: number): Promise<LiveDetailResponse> {
  const response = await fetchWithTimeout(`${BASE_URL}/api/lives/${liveId}`, undefined, {
    requestKind: "live_detail",
  });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return (await response.json()) as LiveDetailResponse;
}

async function fetchLiveDetailsBatchRemote(liveIds: number[]): Promise<LiveDetailsBatchResponse> {
  const response = await fetchWithTimeout(`${BASE_URL}/api/lives/details:batch`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ live_ids: liveIds }),
  }, {
    requestKind: "live_details_batch",
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return (await response.json()) as LiveDetailsBatchResponse;
}

export async function getLives(page: number, pageSize: 15 | 20): Promise<LivesResponse> {
  const requestedKey = livesCacheKey(page, pageSize);
  const fresh = livesCache.getFresh(requestedKey, LIVES_CACHE_TTL_MS);
  if (fresh !== undefined) {
    return fresh;
  }
  const inFlight = livesCache.getInFlight(requestedKey);
  if (inFlight) return inFlight;

  const requestPromise = fetchLivesRemote(page, pageSize)
    .then((payload) => {
      const updatedAt = Date.now();
      livesCache.setData(requestedKey, payload, updatedAt);
      // 后端可能会把超大页码钳回最后一页，这里顺手写入规范 key。
      const canonicalKey = livesCacheKey(payload.pagination.page, pageSize);
      if (canonicalKey !== requestedKey) {
        livesCache.setData(canonicalKey, payload, updatedAt);
      }
      return payload;
    })
    .finally(() => {
      livesCache.clearInFlightIfMatch(requestedKey, requestPromise);
    });

  livesCache.setInFlight(requestedKey, requestPromise);
  return requestPromise;
}

export async function getLiveDetail(liveId: number): Promise<LiveDetailResponse> {
  const key = detailCacheKey(liveId);
  const fresh = detailCache.getFresh(key, DETAIL_CACHE_TTL_MS);
  if (fresh !== undefined) {
    return fresh;
  }
  const inFlight = detailCache.getInFlight(key);
  if (inFlight) return inFlight;

  const recent = detailRecentRequest.getRecent(liveId, DETAIL_REQUEST_DEBOUNCE_MS);
  if (recent) return recent;

  const requestPromise = fetchLiveDetailRemote(liveId)
    .then((payload) => {
      detailCache.setData(key, payload);
      return payload;
    })
    .finally(() => {
      detailCache.clearInFlightIfMatch(key, requestPromise);
    });

  detailRecentRequest.setRecent(liveId, requestPromise);
  detailCache.setInFlight(key, requestPromise);
  return requestPromise;
}

function normalizeLiveIds(liveIds: number[]): number[] {
  const deduped: number[] = [];
  const seen = new Set<number>();
  liveIds.forEach((id) => {
    if (!Number.isInteger(id) || id < 1 || seen.has(id)) return;
    seen.add(id);
    deduped.push(id);
  });
  return deduped;
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  if (items.length === 0) return [];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

export async function getLiveDetailsBatch(liveIds: number[]): Promise<LiveDetailsBatchResponse> {
  const normalized = normalizeLiveIds(liveIds);
  if (normalized.length === 0) {
    return {
      items: [],
      missing_live_ids: [],
    };
  }

  const needFetch = normalized.filter((liveId) => {
    const key = detailCacheKey(liveId);
    const hasFresh = detailCache.getFresh(key, DETAIL_CACHE_TTL_MS) !== undefined;
    if (hasFresh) return false;
    const hasInFlight = detailCache.getInFlight(key) !== undefined;
    return !hasInFlight;
  });

  if (needFetch.length === 0) {
    return {
      items: [],
      missing_live_ids: [],
    };
  }

  const chunks = chunkArray(needFetch, DETAIL_BATCH_MAX_IDS);
  const merged: LiveDetailsBatchResponse = {
    items: [],
    missing_live_ids: [],
  };
  for (const chunk of chunks) {
    // 分片遵循后端 live_ids <= 100 的契约，避免单次 body 过大。
    const payload = await fetchLiveDetailsBatchRemote(chunk);
    payload.items.forEach((item) => {
      detailCache.setData(detailCacheKey(item.live_id), item);
      merged.items.push(item);
    });
    merged.missing_live_ids.push(...payload.missing_live_ids);
  }
  return merged;
}
