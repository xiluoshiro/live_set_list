import { LruRequestCache, RecentPromiseDebouncer } from "./cache/queryCache";
import { logError, logInfo } from "./logger";

export type DbHealthResponse = {
  ok: boolean;
  result: number | null;
};

export type AuthUser = {
  id: number;
  username: string;
  display_name: string;
  role: string;
};

export type AuthLoginResponse = {
  user: AuthUser;
  csrf_token: string;
  favorite_live_ids: number[];
};

export type AuthMeResponse =
  | {
      authenticated: false;
      user?: null;
      csrf_token?: null;
      favorite_live_ids?: null;
    }
  | {
      authenticated: true;
      user: AuthUser;
      csrf_token: string;
      favorite_live_ids: number[];
    };

export type LiveItem = {
  live_id: number;
  live_date: string;
  live_title: string;
  bands: Array<number | string>;
  url: string | null;
  is_favorite: boolean;
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
  is_favorite: boolean;
  detail_rows: LiveDetailRow[];
};

export type LiveDetailsBatchResponse = {
  items: LiveDetailResponse[];
  missing_live_ids: number[];
};

type AuthErrorPayload = {
  detail?: string | { code?: string; message?: string };
};

type RequestKind =
  | "health"
  | "lives"
  | "favorite_lives"
  | "live_detail"
  | "live_details_batch"
  | "auth_me"
  | "auth_login"
  | "auth_logout"
  | "favorite_add"
  | "favorite_remove";

type RequestLogMeta = {
  requestKind: RequestKind;
  method?: string;
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
const favoriteLivesCache = new LruRequestCache<LivesResponse>(LIVES_CACHE_MAX);
const detailCache = new LruRequestCache<LiveDetailResponse>(DETAIL_CACHE_MAX);
const detailRecentRequest = new RecentPromiseDebouncer<number, LiveDetailResponse>();

export class ApiError extends Error {
  status: number;
  code: string | null;

  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

function livesCacheKey(page: number, pageSize: 15 | 20): string {
  return `lives:${page}:${pageSize}`;
}

function favoriteLivesCacheKey(page: number, pageSize: 15 | 20): string {
  return `favorite_lives:${page}:${pageSize}`;
}

function detailCacheKey(liveId: number): string {
  return `detail:${liveId}`;
}

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
  logInfo("api_request_start", {
    method,
    url: input,
    request_kind: requestKind,
  });
  try {
    const response = await fetch(input, {
      credentials: "include",
      ...init,
      signal: controller.signal,
    });
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

async function readJsonSafely<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

function extractApiErrorPayload(payload: AuthErrorPayload | null, status: number): ApiError {
  if (payload?.detail && typeof payload.detail === "object") {
    return new ApiError(
      payload.detail.message?.trim() || `Request failed: ${status}`,
      status,
      payload.detail.code?.trim() || null,
    );
  }
  if (typeof payload?.detail === "string" && payload.detail.trim() !== "") {
    return new ApiError(payload.detail, status, null);
  }
  return new ApiError(`Request failed: ${status}`, status, null);
}

async function expectJsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const payload = await readJsonSafely<AuthErrorPayload>(response);
    throw extractApiErrorPayload(payload, response.status);
  }
  return (await response.json()) as T;
}

async function expectNoContent(response: Response): Promise<void> {
  if (!response.ok) {
    const payload = await readJsonSafely<AuthErrorPayload>(response);
    throw extractApiErrorPayload(payload, response.status);
  }
}

function jsonHeaders(csrfToken?: string | null): HeadersInit {
  return {
    "Content-Type": "application/json",
    ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
  };
}

export async function checkDbHealth(): Promise<DbHealthResponse> {
  const response = await fetchWithTimeout(`${BASE_URL}/api/health/db`, undefined, {
    requestKind: "health",
  });
  return expectJsonResponse<DbHealthResponse>(response);
}

async function fetchLivesRemote(page: number, pageSize: 15 | 20): Promise<LivesResponse> {
  const query = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
  });
  const response = await fetchWithTimeout(`${BASE_URL}/api/lives?${query.toString()}`, undefined, {
    requestKind: "lives",
  });
  return expectJsonResponse<LivesResponse>(response);
}

async function fetchMyFavoriteLivesRemote(page: number, pageSize: 15 | 20): Promise<LivesResponse> {
  const query = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
  });
  const response = await fetchWithTimeout(`${BASE_URL}/api/me/favorites/lives?${query.toString()}`, undefined, {
    requestKind: "favorite_lives",
  });
  return expectJsonResponse<LivesResponse>(response);
}

export function peekMyFavoriteLives(page: number, pageSize: 15 | 20): LivesResponse | undefined {
  return favoriteLivesCache.getFresh(favoriteLivesCacheKey(page, pageSize), LIVES_CACHE_TTL_MS);
}

export function clearMyFavoriteLivesCache(): void {
  favoriteLivesCache.clear();
}

export async function getMyFavoriteLives(page: number, pageSize: 15 | 20): Promise<LivesResponse> {
  const requestedKey = favoriteLivesCacheKey(page, pageSize);
  const fresh = favoriteLivesCache.getFresh(requestedKey, LIVES_CACHE_TTL_MS);
  if (fresh !== undefined) {
    return fresh;
  }
  const inFlight = favoriteLivesCache.getInFlight(requestedKey);
  if (inFlight) return inFlight;

  const requestPromise = fetchMyFavoriteLivesRemote(page, pageSize)
    .then((payload) => {
      const updatedAt = Date.now();
      favoriteLivesCache.setData(requestedKey, payload, updatedAt);
      const canonicalKey = favoriteLivesCacheKey(payload.pagination.page, pageSize);
      if (canonicalKey !== requestedKey) {
        favoriteLivesCache.setData(canonicalKey, payload, updatedAt);
      }
      return payload;
    })
    .finally(() => {
      favoriteLivesCache.clearInFlightIfMatch(requestedKey, requestPromise);
    });

  favoriteLivesCache.setInFlight(requestedKey, requestPromise);
  return requestPromise;
}

async function fetchLiveDetailRemote(liveId: number): Promise<LiveDetailResponse> {
  const response = await fetchWithTimeout(`${BASE_URL}/api/lives/${liveId}`, undefined, {
    requestKind: "live_detail",
  });
  return expectJsonResponse<LiveDetailResponse>(response);
}

async function fetchLiveDetailsBatchRemote(liveIds: number[]): Promise<LiveDetailsBatchResponse> {
  const response = await fetchWithTimeout(
    `${BASE_URL}/api/lives/details:batch`,
    {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ live_ids: liveIds }),
    },
    {
      requestKind: "live_details_batch",
      method: "POST",
    },
  );
  return expectJsonResponse<LiveDetailsBatchResponse>(response);
}

export async function getAuthMe(): Promise<AuthMeResponse> {
  const response = await fetchWithTimeout(`${BASE_URL}/api/auth/me`, undefined, {
    requestKind: "auth_me",
  });
  return expectJsonResponse<AuthMeResponse>(response);
}

export async function login(username: string, password: string): Promise<AuthLoginResponse> {
  const response = await fetchWithTimeout(
    `${BASE_URL}/api/auth/login`,
    {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ username, password }),
    },
    {
      requestKind: "auth_login",
      method: "POST",
    },
  );
  return expectJsonResponse<AuthLoginResponse>(response);
}

export async function logout(csrfToken: string | null): Promise<void> {
  const response = await fetchWithTimeout(
    `${BASE_URL}/api/auth/logout`,
    {
      method: "POST",
      headers: csrfToken ? { "X-CSRF-Token": csrfToken } : undefined,
    },
    {
      requestKind: "auth_logout",
      method: "POST",
    },
  );
  return expectNoContent(response);
}

export async function favoriteLive(liveId: number, csrfToken: string): Promise<void> {
  const response = await fetchWithTimeout(
    `${BASE_URL}/api/me/favorites/lives/${liveId}`,
    {
      method: "PUT",
      headers: { "X-CSRF-Token": csrfToken },
    },
    {
      requestKind: "favorite_add",
      method: "PUT",
    },
  );
  return expectNoContent(response);
}

export async function unfavoriteLive(liveId: number, csrfToken: string): Promise<void> {
  const response = await fetchWithTimeout(
    `${BASE_URL}/api/me/favorites/lives/${liveId}`,
    {
      method: "DELETE",
      headers: { "X-CSRF-Token": csrfToken },
    },
    {
      requestKind: "favorite_remove",
      method: "DELETE",
    },
  );
  return expectNoContent(response);
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
