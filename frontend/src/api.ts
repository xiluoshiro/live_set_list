import { LruRequestCache, RecentPromiseDebouncer } from "./cache/queryCache";

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
  bands: number[];
  band_names: string[];
  url: string | null;
  detail_rows: LiveDetailRow[];
};

const BASE_URL = "http://localhost:8000";
const REQUEST_TIMEOUT_MS = 10000;
const LIVES_CACHE_TTL_MS = 15 * 60 * 1000;
const DETAIL_CACHE_TTL_MS = 30 * 60 * 1000;
const LIVES_CACHE_MAX = 20;
const DETAIL_CACHE_MAX = 100;
const DETAIL_REQUEST_DEBOUNCE_MS = 300;

const livesCache = new LruRequestCache<LivesResponse>(LIVES_CACHE_MAX);
const detailCache = new LruRequestCache<LiveDetailResponse>(DETAIL_CACHE_MAX);
const detailRecentRequest = new RecentPromiseDebouncer<number, LiveDetailResponse>();

function livesCacheKey(page: number, pageSize: 15 | 20): string {
  return `lives:${page}:${pageSize}`;
}

function detailCacheKey(liveId: number): string {
  return `detail:${liveId}`;
}

async function fetchWithTimeout(input: string): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(input, { signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Request timeout");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function checkDbHealth(): Promise<DbHealthResponse> {
  const response = await fetchWithTimeout(`${BASE_URL}/api/health/db`);
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
  const response = await fetchWithTimeout(`${BASE_URL}/api/lives?${query.toString()}`);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return (await response.json()) as LivesResponse;
}

async function fetchLiveDetailRemote(liveId: number): Promise<LiveDetailResponse> {
  const response = await fetchWithTimeout(`${BASE_URL}/api/lives/${liveId}`);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return (await response.json()) as LiveDetailResponse;
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
