import { LruRequestCache, RecentPromiseDebouncer } from "./cache/queryCache";
import {
  liveListFiltersKey,
  normalizedLiveListFilters,
  type LiveListFilters,
} from "./liveListFilters";
import { logError, logInfo } from "./logger";
import { publishConsoleLiveChange } from "./consoleLiveSync";

export type { LiveListFilters, LiveListSort } from "./liveListFilters";

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

export type TourRef = {
  tour_id: number;
  tour_title: string;
};

export type PerformanceGroupRef = {
  group_id: number;
  group_title: string;
};

export type LiveItem = {
  live_id: number;
  live_date: string;
  live_title: string;
  live_type: string;
  bands: Array<number | string>;
  url: string | null;
  is_favorite: boolean;
  tour?: TourRef | null;
  performance_group?: PerformanceGroupRef | null;
  event_status?: EventStatus;
  date_phase?: DatePhase;
  was_rescheduled?: boolean;
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

export type CatalogBandItem = {
  band_id: number;
  band_name: string;
  band_abbr: string;
  band_members?: string[];
  live_count: number;
};

export type CatalogSongItem = {
  song_id: number;
  song_name: string;
  band_id: number;
  band_name: string | null;
  live_count: number;
};

export type CatalogVenueItem = {
  venue_id: number;
  venue_name: string;
  live_count: number;
};

export type CatalogSearchResponse = {
  query: string;
  lives: LiveItem[];
  bands: CatalogBandItem[];
  songs: CatalogSongItem[];
  venues: CatalogVenueItem[];
};

export type CatalogBandListResponse = {
  items: CatalogBandItem[];
};

export type CatalogBandLivesResponse = {
  band: CatalogBandItem;
  items: LiveItem[];
  pagination: LivesResponse["pagination"];
};

export type CatalogStatsResponse = {
  band_count: number;
  song_count: number;
  venue_count: number;
  latest_live_date: string | null;
  years?: number[];
};

export type StatisticsScope = "all" | "favorites";
export type CatalogStatisticsFilters = {
  year?: number;
  liveType?: string;
  bandId?: number;
};
export type StatisticsDimensionItem = { key: string; label: string; live_count: number };
export type StatisticsSongItem = {
  song_id: number; song_name: string; band_id: number; band_name: string | null; is_cover: boolean;
  live_count: number; performance_count: number;
  first_live_id: number; first_live_date: string; first_live_title: string;
  latest_live_id: number; latest_live_date: string; latest_live_title: string;
};
export type StatisticsStaleSongItem = {
  song_id: number; song_name: string; band_name: string | null; is_cover: boolean; live_count: number;
  latest_live_id: number; latest_live_date: string; latest_live_title: string;
  reference_live_date: string; stale_days: number; missed_live_count: number;
};
export type CatalogStatisticsResponse = {
  scope: StatisticsScope;
  filters: { year: number | null; live_type: string | null; band_id: number | null };
  overview: {
    live_count: number; setlist_live_count: number; band_count: number; song_count: number; venue_count: number;
    earliest_live_date: string | null; latest_live_date: string | null;
  };
  years: StatisticsDimensionItem[];
  live_types: StatisticsDimensionItem[];
  top_songs: StatisticsSongItem[];
  stale_songs: StatisticsStaleSongItem[];
  stale_songs_by_kind: {
    original: StatisticsStaleSongItem[];
    cover: StatisticsStaleSongItem[];
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

export type EventStatus = "scheduled" | "postponed" | "cancelled";
export type DatePhase = "upcoming" | "today" | "past";

export type LiveScheduleHistoryItem = {
  previous_live_title: string | null;
  previous_live_date: string;
  previous_opening_time: string;
  previous_start_time: string;
  previous_venue_id: number;
  previous_venue: string | null;
  changed_at: string;
  note: string | null;
};

export type LiveDetailCoverBand = {
  band_id: number;
  band_name: string;
};

export type EventAttendeeMode = "partial" | "full";

export type LiveDetailEventAttendee = {
  band_id: number;
  band_name: string;
  mode: EventAttendeeMode;
  members: string[];
};

export type LiveDetailRow = {
  row_id: string;
  song_name: string;
  band_members: LiveDetailBandMember[];
  other_members: LiveDetailOtherMember[];
  comments: string[];
  cover_band?: LiveDetailCoverBand | null;
};

export type LiveDetailResponse = {
  live_id: number;
  live_date: string;
  live_title: string;
  live_type: string;
  venue: string | null;
  opening_time: string | null;
  start_time: string | null;
  bands: number[];
  band_names: string[];
  url: string | null;
  is_favorite: boolean;
  tour?: TourRef | null;
  performance_group?: PerformanceGroupRef | null;
  event_attendees: LiveDetailEventAttendee[];
  event_status?: EventStatus;
  date_phase?: DatePhase;
  status_note?: string | null;
  was_rescheduled?: boolean;
  schedule_history?: LiveScheduleHistoryItem[];
  detail_rows: LiveDetailRow[];
};

export type TourBandItem = {
  band_id: number;
  band_name: string;
  band_abbr: string;
};

export type TourSummary = {
  tour_id: number;
  tour_title: string;
  url: string | null;
  description: string | null;
  bands: TourBandItem[];
  start_date: string;
  end_date: string;
  collected_live_count: number;
  cancelled_live_count?: number;
  stop_labels: string[];
};

export type TourStopItem = {
  stop_order: number;
  stop_label: string | null;
  live_id: number;
  live_date: string;
  live_title: string;
  live_type: string;
  venue: string | null;
  bands: number[];
  url: string | null;
  is_favorite: boolean;
  has_setlist: boolean;
  event_status?: EventStatus;
  date_phase?: DatePhase;
  was_rescheduled?: boolean;
};

export type ToursResponse = {
  items: TourSummary[];
  pagination: LivesResponse["pagination"];
};

export type TourDetailResponse = TourSummary & {
  stops: TourStopItem[];
};

export type PerformanceGroupBandItem = {
  band_id: number;
  band_name: string;
  band_abbr: string;
};

export type PerformanceGroupLiveItem = {
  live_id: number;
  live_date: string;
  live_title: string;
  live_type: string;
  start_time: string;
  venue: string | null;
  bands: number[];
  url: string | null;
  is_favorite: boolean;
  has_setlist: boolean;
  event_status?: EventStatus;
  date_phase?: DatePhase;
  was_rescheduled?: boolean;
};

export type PerformanceGroupDetailResponse = {
  group_id: number;
  group_title: string;
  start_date: string;
  end_date: string;
  day_count: number;
  live_count: number;
  cancelled_live_count?: number;
  display_type: "single_day_multi_show" | "multi_day";
  bands: PerformanceGroupBandItem[];
  venues: string[];
  lives: PerformanceGroupLiveItem[];
};

export type PerformanceGroupSummary = {
  kind: "performance_group";
  group_id: number;
  group_title: string;
  start_date: string;
  end_date: string;
  day_count: number;
  live_count: number;
  cancelled_live_count?: number;
  display_type: "single_day_multi_show" | "multi_day";
  bands: PerformanceGroupBandItem[];
  venues: string[];
};

export type PerformanceItem =
  | { kind: "live"; live: LiveItem }
  | { kind: "performance_group"; performance_group: PerformanceGroupSummary };

export type PerformancesResponse = {
  items: PerformanceItem[];
  pagination: {
    page: number;
    page_size: number;
    total: number;
    total_pages: number;
  };
};

export type TourStatisticsSongStatus = "common" | "single" | "added" | "removed" | "intermittent";

export type TourStatisticsSongRef = { song_id: number; song_name: string };

export type TourStatisticsResponse = {
  tour_id: number;
  coverage: {
    stop_count: number;
    setlist_stop_count: number;
    comparable_transition_count: number;
  };
  overview: {
    distinct_song_count: number;
    common_song_count: number;
  };
  songs: Array<TourStatisticsSongRef & {
    appearance_count: number;
    first_live_id: number;
    last_live_id: number;
    status: TourStatisticsSongStatus;
  }>;
  transitions: Array<{
    from_live_id: number;
    from_live_date: string;
    from_live_title: string;
    to_live_id: number;
    to_live_date: string;
    to_live_title: string;
    replacements: Array<{
      segment_type: string;
      sub_order: number;
      from_song: TourStatisticsSongRef;
      to_song: TourStatisticsSongRef;
    }>;
    added_songs: TourStatisticsSongRef[];
    removed_songs: TourStatisticsSongRef[];
    moved_songs: Array<TourStatisticsSongRef & { from_order: number; to_order: number }>;
  }>;
};

export type TourListFilters = {
  q?: string;
  year?: number;
  bandId?: number;
  sort?: "date_desc" | "date_asc";
};

export type LiveDetailsBatchResponse = {
  items: LiveDetailResponse[];
  missing_live_ids: number[];
};

export type FavoriteBatchAction = "favorite" | "unfavorite";

export type FavoriteBatchResponse = {
  action: FavoriteBatchAction;
  requested_count: number;
  applied_live_ids: number[];
  noop_live_ids: number[];
  not_found_live_ids: number[];
};

export type ConsoleSongItem = {
  song_id: number;
  song_name: string;
  band_id: number;
  cover: boolean;
  band_name?: string;
};

export type ConsoleSongListResponse = {
  items: ConsoleSongItem[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
};

export type ConsoleSongCreatePayload = {
  song_name: string;
  band_id: number;
  cover: boolean;
};

export type ConsoleSongMutationResponse = {
  ok: boolean;
  item: ConsoleSongItem;
};

export type ConsoleSongBatchCreateResponse = {
  ok: boolean;
  created: ConsoleSongItem[];
};

export type ConsoleBandItem = {
  band_id: number;
  band_name: string;
  band_abbr: string;
  band_members: string[];
};

export type ConsoleBandListResponse = {
  items: ConsoleBandItem[];
};

export type ConsoleVenueItem = {
  venue_id: number;
  venue_name: string;
};

export type ConsoleVenueListResponse = {
  items: ConsoleVenueItem[];
};

export type ConsoleVenueMutationResponse = {
  ok: boolean;
  item: ConsoleVenueItem;
};

export type ConsoleLiveUpsertPayload = {
  live_date: string;
  live_title: string;
  live_type: string;
  url: string;
  opening_time: string;
  start_time: string;
  timezone: string;
  venue_id: number;
  default_band_ids: number[];
  event_attendees: Array<{ band_id: number; members: string[] }>;
  event_status?: EventStatus;
  status_note?: string | null;
};

export type TourStatisticsTransition = TourStatisticsResponse["transitions"][number];

export type ConsoleLiveCreatePayload = ConsoleLiveUpsertPayload;
export type ConsoleLiveUpdatePayload = ConsoleLiveUpsertPayload & {
  schedule_change_kind?: "correction" | "reschedule" | null;
  schedule_change_note?: string | null;
};

export type ConsoleEventAttendee = {
  band_id: number;
  mode: EventAttendeeMode;
  members: string[];
};

export type ConsoleLiveMutationItem = {
  live_id: number;
  live_date: string;
  live_title: string;
  live_type: string;
  url: string;
  opening_time: string;
  start_time: string;
  venue_id: number;
  default_band_ids: number[];
  event_attendees: ConsoleEventAttendee[];
  event_status?: EventStatus;
  status_note?: string | null;
  date_phase?: DatePhase;
};

export type ConsoleLiveMutationResponse = {
  ok: boolean;
  item: ConsoleLiveMutationItem;
};

export type ConsoleLiveSetlistRowPayload = {
  song_id: number;
  absolute_order: number;
  segment_type: string;
  sub_order: number;
  is_short: boolean;
  band_member: Record<string, string[] | string>;
  other_member?: Record<string, string[] | string | null> | null;
  comment?: string | null;
};

export type ConsoleLiveSetlistAppendPayload = {
  setlist_rows: ConsoleLiveSetlistRowPayload[];
};

export type ConsoleLiveSetlistAppendResponse = {
  ok: boolean;
  item: {
    live_id: number;
    inserted_row_count: number;
    total_setlist_row_count: number;
  };
};

export type ConsoleLiveSetlistEditRow = ConsoleLiveSetlistRowPayload & {
  row_id: string;
  song_name: string;
};

export type ConsoleLiveSetlistEditResponse = {
  live_id: number;
  rows: ConsoleLiveSetlistEditRow[];
};

export type ConsoleTourStopPayload = {
  live_id: number;
  stop_label: string | null;
};

export type ConsoleTourUpsertPayload = {
  tour_title: string;
  band_ids: number[];
  stops: ConsoleTourStopPayload[];
};

export type ConsoleTourMutationResponse = {
  ok: boolean;
  item: {
    tour_id: number;
    tour_title: string;
    band_count: number;
    stop_count: number;
  };
};

export type ConsoleTourLiveCandidate = {
  live_id: number;
  live_date: string;
  start_time: string;
  live_title: string;
  venue: string | null;
  tour_id: number | null;
  tour_title: string | null;
  band_ids: number[];
};

export type ConsoleTourLiveCandidatesResponse = {
  items: ConsoleTourLiveCandidate[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
};

export type ConsoleTourEditResponse = {
  tour_id: number;
  tour_title: string;
  band_ids: number[];
  stops: Array<{
    live_id: number;
    live_date: string;
    start_time: string;
    live_title: string;
    venue: string | null;
    stop_label: string | null;
    band_ids: number[];
  }>;
};

export type ConsolePerformanceGroupLiveCandidate = {
  live_id: number;
  live_date: string;
  live_title: string;
  start_time: string;
  venue: string | null;
  band_ids: number[];
};

export type ConsoleLiveCandidate = {
  live_id: number;
  live_date: string;
  live_title: string;
  live_type: string;
  venue_name: string;
  event_status?: EventStatus;
  date_phase?: DatePhase;
};

export type ConsoleLiveCandidatesResponse = {
  items: ConsoleLiveCandidate[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
};

export type ConsoleLiveEditResponse = {
  item: ConsoleLiveMutationItem & {
    timezone: string;
    venue_name: string;
    schedule_history?: LiveScheduleHistoryItem[];
    has_setlist?: boolean;
  };
};

export type ConsolePerformanceGroupListResponse = {
  items: Array<{
    group_id: number;
    group_title: string;
  }>;
};

export type ConsolePerformanceGroupLiveCandidatesResponse = {
  items: ConsolePerformanceGroupLiveCandidate[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
};

export type ConsolePerformanceGroupEditStop = {
  live_id: number;
  live_date: string;
  live_title: string;
  start_time: string;
  venue: string | null;
  band_ids: number[];
};

export type ConsolePerformanceGroupEditResponse = {
  group_id: number;
  group_title: string;
  lives: ConsolePerformanceGroupEditStop[];
};

export type ConsolePerformanceGroupUpsertPayload = {
  group_title: string;
  live_ids: number[];
};

export type ConsolePerformanceGroupMutationResponse = {
  ok: boolean;
  item: {
    group_id: number;
    group_title: string;
    live_count: number;
  };
};

type AuthErrorPayload = {
  detail?: string | { code?: string; message?: string };
};

type RequestKind =
  | "health"
  | "lives"
  | "favorite_lives"
  | "favorite_lives_batch"
  | "live_detail"
  | "live_details_batch"
  | "auth_me"
  | "auth_login"
  | "auth_logout"
  | "favorite_add"
  | "favorite_remove"
  | "console_songs"
  | "console_bands"
  | "console_venues"
  | "console_venue_create"
  | "console_live_candidates"
  | "console_live_detail"
  | "console_live_create"
  | "console_live_update"
  | "console_song_create"
  | "console_song_update"
  | "console_song_batch_create"
  | "console_live_setlist_append"
  | "console_live_setlist_detail"
  | "console_live_setlist_update"
  | "console_tour_live_candidates"
  | "console_tour_detail"
  | "console_tour_create"
  | "console_tour_update"
  | "catalog_search"
  | "catalog_tours"
  | "catalog_tour_detail"
  | "catalog_tour_statistics"
  | "catalog_tour_statistics_comparison"
  | "catalog_bands"
  | "catalog_band_lives"
  | "catalog_stats"
  | "catalog_statistics"
  | "catalog_performance_group_detail"
  | "catalog_performances"
  | "console_performance_group_live_candidates"
  | "console_performance_group_list"
  | "console_performance_group_detail"
  | "console_performance_group_create"
  | "console_performance_group_update";

type RequestLogMeta = {
  requestKind: RequestKind;
  method?: string;
};

const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
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
let authMeInFlight: Promise<AuthMeResponse> | null = null;

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

function appendLiveListFilters(query: URLSearchParams, filters?: LiveListFilters): void {
  const normalized = normalizedLiveListFilters(filters);
  if (normalized.q !== "") query.set("q", normalized.q);
  if (normalized.year !== null) query.set("year", String(normalized.year));
  if (normalized.liveType !== null) query.set("live_type", normalized.liveType);
  if (normalized.bandId !== null) query.set("band_id", String(normalized.bandId));
  if (normalized.sort !== "date_desc") query.set("sort", normalized.sort);
}

function livesCacheKey(
  page: number,
  pageSize: 15 | 20,
  withoutSetlist = false,
  filters?: LiveListFilters,
): string {
  return `lives:${page}:${pageSize}:${withoutSetlist ? "without_setlist" : "all"}:${liveListFiltersKey(filters)}`;
}

function favoriteLivesCacheKey(page: number, pageSize: 15 | 20, filters?: LiveListFilters): string {
  return `favorite_lives:${page}:${pageSize}:${liveListFiltersKey(filters)}`;
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

async function fetchLivesRemote(
  page: number,
  pageSize: 15 | 20,
  withoutSetlist = false,
  filters?: LiveListFilters,
): Promise<LivesResponse> {
  const query = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
  });
  if (withoutSetlist) {
    query.set("without_setlist", "true");
  }
  appendLiveListFilters(query, filters);
  const response = await fetchWithTimeout(`${BASE_URL}/api/lives?${query.toString()}`, undefined, {
    requestKind: "lives",
  });
  return expectJsonResponse<LivesResponse>(response);
}

async function fetchMyFavoriteLivesRemote(
  page: number,
  pageSize: 15 | 20,
  filters?: LiveListFilters,
): Promise<LivesResponse> {
  const query = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
  });
  appendLiveListFilters(query, filters);
  const response = await fetchWithTimeout(`${BASE_URL}/api/me/favorites/lives?${query.toString()}`, undefined, {
    requestKind: "favorite_lives",
  });
  return expectJsonResponse<LivesResponse>(response);
}

export function peekMyFavoriteLives(
  page: number,
  pageSize: 15 | 20,
  filters?: LiveListFilters,
): LivesResponse | undefined {
  return favoriteLivesCache.getFresh(favoriteLivesCacheKey(page, pageSize, filters), LIVES_CACHE_TTL_MS);
}

export function clearMyFavoriteLivesCache(): void {
  favoriteLivesCache.clear();
}

export function clearLivesCache(): void {
  livesCache.clear();
}

function clearLiveCollectionCaches(): void {
  clearLivesCache();
  clearMyFavoriteLivesCache();
}

export function clearLiveDataCaches(): void {
  clearLiveCollectionCaches();
  detailCache.clear();
}

export async function getMyFavoriteLives(
  page: number,
  pageSize: 15 | 20,
  filters?: LiveListFilters,
): Promise<LivesResponse> {
  const requestedKey = favoriteLivesCacheKey(page, pageSize, filters);
  const fresh = favoriteLivesCache.getFresh(requestedKey, LIVES_CACHE_TTL_MS);
  if (fresh !== undefined) {
    return fresh;
  }
  const inFlight = favoriteLivesCache.getInFlight(requestedKey);
  if (inFlight) return inFlight;

  const requestPromise = fetchMyFavoriteLivesRemote(page, pageSize, filters)
    .then((payload) => {
      const updatedAt = Date.now();
      favoriteLivesCache.setData(requestedKey, payload, updatedAt);
      const canonicalKey = favoriteLivesCacheKey(payload.pagination.page, pageSize, filters);
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
  if (!authMeInFlight) {
    authMeInFlight = (async () => {
      const response = await fetchWithTimeout(`${BASE_URL}/api/auth/me`, undefined, {
        requestKind: "auth_me",
      });
      return expectJsonResponse<AuthMeResponse>(response);
    })().finally(() => {
      authMeInFlight = null;
    });
  }
  return authMeInFlight;
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

export async function favoriteLivesBatch(
  action: FavoriteBatchAction,
  liveIds: number[],
  csrfToken: string,
): Promise<FavoriteBatchResponse> {
  const response = await fetchWithTimeout(
    `${BASE_URL}/api/me/favorites/lives:batch`,
    {
      method: "POST",
      headers: jsonHeaders(csrfToken),
      body: JSON.stringify({ action, live_ids: liveIds }),
    },
    {
      requestKind: "favorite_lives_batch",
      method: "POST",
    },
  );
  return expectJsonResponse<FavoriteBatchResponse>(response);
}

function consoleLookupQuery(q?: string, limit = 20, page?: number): string {
  const query = new URLSearchParams({
    limit: String(limit),
  });
  const normalizedQuery = q?.trim();
  if (normalizedQuery) {
    query.set("q", normalizedQuery);
  }
  if (page !== undefined) {
    query.set("page", String(page));
  }
  return query.toString();
}

export async function getConsoleSongs(q?: string, limit = 20, page?: number): Promise<ConsoleSongListResponse> {
  const response = await fetchWithTimeout(`${BASE_URL}/api/console/songs?${consoleLookupQuery(q, limit, page)}`, undefined, {
    requestKind: "console_songs",
  });
  return expectJsonResponse<ConsoleSongListResponse>(response);
}

export async function getConsoleBands(q?: string, limit = 20): Promise<ConsoleBandListResponse> {
  const response = await fetchWithTimeout(`${BASE_URL}/api/console/bands?${consoleLookupQuery(q, limit)}`, undefined, {
    requestKind: "console_bands",
  });
  return expectJsonResponse<ConsoleBandListResponse>(response);
}

export async function getConsoleVenues(q?: string, limit = 20): Promise<ConsoleVenueListResponse> {
  const response = await fetchWithTimeout(`${BASE_URL}/api/console/venues?${consoleLookupQuery(q, limit)}`, undefined, {
    requestKind: "console_venues",
  });
  return expectJsonResponse<ConsoleVenueListResponse>(response);
}

export async function getConsoleTourLiveCandidates(
  q?: string,
  page = 1,
  pageSize = 20,
): Promise<ConsoleTourLiveCandidatesResponse> {
  const query = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  if (q?.trim()) query.set("q", q.trim());
  const response = await fetchWithTimeout(
    `${BASE_URL}/api/console/tours/live-candidates?${query.toString()}`,
    undefined,
    { requestKind: "console_tour_live_candidates" },
  );
  return expectJsonResponse<ConsoleTourLiveCandidatesResponse>(response);
}

export async function getConsoleTour(tourId: number): Promise<ConsoleTourEditResponse> {
  const response = await fetchWithTimeout(`${BASE_URL}/api/console/tours/${tourId}`, undefined, {
    requestKind: "console_tour_detail",
  });
  return expectJsonResponse<ConsoleTourEditResponse>(response);
}

export async function getTours(
  page = 1,
  pageSize: 15 | 20 = 20,
  filters: TourListFilters = {},
): Promise<ToursResponse> {
  const query = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  if (filters.q?.trim()) query.set("q", filters.q.trim());
  if (filters.year !== undefined) query.set("year", String(filters.year));
  if (filters.bandId !== undefined) query.set("band_id", String(filters.bandId));
  if (filters.sort) query.set("sort", filters.sort);
  const response = await fetchWithTimeout(`${BASE_URL}/api/catalog/tours?${query.toString()}`, undefined, {
    requestKind: "catalog_tours",
  });
  return expectJsonResponse<ToursResponse>(response);
}

export async function getTourDetail(tourId: number): Promise<TourDetailResponse> {
  const response = await fetchWithTimeout(`${BASE_URL}/api/catalog/tours/${tourId}`, undefined, {
    requestKind: "catalog_tour_detail",
  });
  return expectJsonResponse<TourDetailResponse>(response);
}

export async function getTourStatistics(tourId: number): Promise<TourStatisticsResponse> {
  const response = await fetchWithTimeout(`${BASE_URL}/api/catalog/tours/${tourId}/statistics`, undefined, {
    requestKind: "catalog_tour_statistics",
  });
  return expectJsonResponse<TourStatisticsResponse>(response);
}

export async function searchCatalog(q: string, limit = 8): Promise<CatalogSearchResponse> {
  const query = new URLSearchParams({
    q,
    limit: String(limit),
  });
  const response = await fetchWithTimeout(`${BASE_URL}/api/catalog/search?${query.toString()}`, undefined, {
    requestKind: "catalog_search",
  });
  return expectJsonResponse<CatalogSearchResponse>(response);
}

export async function getCatalogBands(limit = 20): Promise<CatalogBandListResponse> {
  const query = new URLSearchParams({
    limit: String(limit),
  });
  const response = await fetchWithTimeout(`${BASE_URL}/api/catalog/bands?${query.toString()}`, undefined, {
    requestKind: "catalog_bands",
  });
  return expectJsonResponse<CatalogBandListResponse>(response);
}

export async function getCatalogBandLives(
  bandId: number,
  page: number,
  pageSize: 15 | 20,
): Promise<CatalogBandLivesResponse> {
  const query = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
  });
  const response = await fetchWithTimeout(`${BASE_URL}/api/catalog/bands/${bandId}/lives?${query.toString()}`, undefined, {
    requestKind: "catalog_band_lives",
  });
  return expectJsonResponse<CatalogBandLivesResponse>(response);
}

export async function getCatalogStats(): Promise<CatalogStatsResponse> {
  const response = await fetchWithTimeout(`${BASE_URL}/api/catalog/stats`, undefined, {
    requestKind: "catalog_stats",
  });
  return expectJsonResponse<CatalogStatsResponse>(response);
}

export async function getCatalogStatistics(
  scope: StatisticsScope,
  filters: CatalogStatisticsFilters = {},
  limit = 10,
): Promise<CatalogStatisticsResponse> {
  const query = new URLSearchParams({ scope, limit: String(limit) });
  if (filters.year !== undefined) query.set("year", String(filters.year));
  if (filters.liveType) query.set("live_type", filters.liveType);
  if (filters.bandId !== undefined) query.set("band_id", String(filters.bandId));
  const response = await fetchWithTimeout(`${BASE_URL}/api/catalog/statistics?${query.toString()}`, undefined, {
    requestKind: "catalog_statistics",
  });
  return expectJsonResponse<CatalogStatisticsResponse>(response);
}

export async function createConsoleSong(
  payload: ConsoleSongCreatePayload,
  csrfToken: string,
): Promise<ConsoleSongMutationResponse> {
  const response = await fetchWithTimeout(
    `${BASE_URL}/api/console/songs`,
    {
      method: "POST",
      headers: jsonHeaders(csrfToken),
      body: JSON.stringify(payload),
    },
    {
      requestKind: "console_song_create",
      method: "POST",
    },
  );
  return expectJsonResponse<ConsoleSongMutationResponse>(response);
}

export async function updateConsoleSong(
  songId: number,
  payload: ConsoleSongCreatePayload,
  csrfToken: string,
): Promise<ConsoleSongMutationResponse> {
  const response = await fetchWithTimeout(
    `${BASE_URL}/api/console/songs/${songId}`,
    {
      method: "PUT",
      headers: jsonHeaders(csrfToken),
      body: JSON.stringify(payload),
    },
    { requestKind: "console_song_update", method: "PUT" },
  );
  return expectJsonResponse<ConsoleSongMutationResponse>(response);
}

export async function createConsoleSongsBatch(
  songs: ConsoleSongCreatePayload[],
  csrfToken: string,
): Promise<ConsoleSongBatchCreateResponse> {
  const response = await fetchWithTimeout(
    `${BASE_URL}/api/console/songs:batch`,
    {
      method: "POST",
      headers: jsonHeaders(csrfToken),
      body: JSON.stringify({ songs }),
    },
    {
      requestKind: "console_song_batch_create",
      method: "POST",
    },
  );
  return expectJsonResponse<ConsoleSongBatchCreateResponse>(response);
}

export async function createConsoleVenue(
  venueName: string,
  csrfToken: string,
): Promise<ConsoleVenueMutationResponse> {
  const response = await fetchWithTimeout(
    `${BASE_URL}/api/console/venues`,
    {
      method: "POST",
      headers: jsonHeaders(csrfToken),
      body: JSON.stringify({ venue_name: venueName }),
    },
    {
      requestKind: "console_venue_create",
      method: "POST",
    },
  );
  return expectJsonResponse<ConsoleVenueMutationResponse>(response);
}

export async function createConsoleLive(
  payload: ConsoleLiveCreatePayload,
  csrfToken: string,
): Promise<ConsoleLiveMutationResponse> {
  const response = await fetchWithTimeout(
    `${BASE_URL}/api/console/lives`,
    {
      method: "POST",
      headers: jsonHeaders(csrfToken),
      body: JSON.stringify(payload),
    },
    {
      requestKind: "console_live_create",
      method: "POST",
    },
  );
  const responsePayload = await expectJsonResponse<ConsoleLiveMutationResponse>(response);
  clearLiveCollectionCaches();
  publishConsoleLiveChange("created", responsePayload.item.live_id);
  return responsePayload;
}

export async function appendConsoleLiveSetlist(
  liveId: number,
  payload: ConsoleLiveSetlistAppendPayload,
  csrfToken: string,
): Promise<ConsoleLiveSetlistAppendResponse> {
  const response = await fetchWithTimeout(
    `${BASE_URL}/api/console/lives/${liveId}/setlist`,
    {
      method: "POST",
      headers: jsonHeaders(csrfToken),
      body: JSON.stringify(payload),
    },
    {
      requestKind: "console_live_setlist_append",
      method: "POST",
    },
  );
  const responsePayload = await expectJsonResponse<ConsoleLiveSetlistAppendResponse>(response);
  clearLiveCollectionCaches();
  detailCache.delete(detailCacheKey(liveId));
  publishConsoleLiveChange("setlist_appended", liveId);
  return responsePayload;
}

export async function getConsoleLiveSetlist(liveId: number): Promise<ConsoleLiveSetlistEditResponse> {
  const response = await fetchWithTimeout(`${BASE_URL}/api/console/lives/${liveId}/setlist`, undefined, {
    requestKind: "console_live_setlist_detail",
  });
  return expectJsonResponse<ConsoleLiveSetlistEditResponse>(response);
}

export async function updateConsoleLiveSetlist(
  liveId: number,
  payload: ConsoleLiveSetlistAppendPayload,
  csrfToken: string,
): Promise<ConsoleLiveSetlistAppendResponse> {
  const response = await fetchWithTimeout(
    `${BASE_URL}/api/console/lives/${liveId}/setlist`,
    {
      method: "PUT",
      headers: jsonHeaders(csrfToken),
      body: JSON.stringify(payload),
    },
    { requestKind: "console_live_setlist_update", method: "PUT" },
  );
  const responsePayload = await expectJsonResponse<ConsoleLiveSetlistAppendResponse>(response);
  clearLiveCollectionCaches();
  detailCache.delete(detailCacheKey(liveId));
  publishConsoleLiveChange("updated", liveId);
  return responsePayload;
}

export async function createConsoleTour(
  payload: ConsoleTourUpsertPayload,
  csrfToken: string,
): Promise<ConsoleTourMutationResponse> {
  const response = await fetchWithTimeout(
    `${BASE_URL}/api/console/tours`,
    {
      method: "POST",
      headers: jsonHeaders(csrfToken),
      body: JSON.stringify(payload),
    },
    { requestKind: "console_tour_create", method: "POST" },
  );
  const result = await expectJsonResponse<ConsoleTourMutationResponse>(response);
  clearLiveCollectionCaches();
  detailCache.clear();
  return result;
}

export async function updateConsoleTour(
  tourId: number,
  payload: ConsoleTourUpsertPayload,
  csrfToken: string,
): Promise<ConsoleTourMutationResponse> {
  const response = await fetchWithTimeout(
    `${BASE_URL}/api/console/tours/${tourId}`,
    {
      method: "PUT",
      headers: jsonHeaders(csrfToken),
      body: JSON.stringify(payload),
    },
    { requestKind: "console_tour_update", method: "PUT" },
  );
  const result = await expectJsonResponse<ConsoleTourMutationResponse>(response);
  clearLiveCollectionCaches();
  detailCache.clear();
  return result;
}

export async function getPerformanceGroupDetail(groupId: number): Promise<PerformanceGroupDetailResponse> {
  const response = await fetchWithTimeout(
    `${BASE_URL}/api/catalog/performance-groups/${groupId}`,
    undefined,
    { requestKind: "catalog_performance_group_detail" },
  );
  if (!response.ok) {
    if (response.status === 404) throw new Error(`Group ${groupId} not found`);
    throw new Error(`Failed to fetch group detail: ${response.status}`);
  }
  return expectJsonResponse<PerformanceGroupDetailResponse>(response);
}

export async function getPerformances(
  page: number,
  pageSize: number,
  scope: "all" | "favorites" = "all",
  filters?: Record<string, string | number | undefined>,
): Promise<PerformancesResponse> {
  const params = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
    scope,
  });
  if (filters) {
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined) params.set(key, String(value));
    }
  }
  const response = await fetchWithTimeout(
    `${BASE_URL}/api/catalog/performances?${params.toString()}`,
    undefined,
    { requestKind: "catalog_performances" },
  );
  if (!response.ok) {
    if (response.status === 401) throw new Error("Authentication required");
    throw new Error(`Failed to fetch performances: ${response.status}`);
  }
  return expectJsonResponse<PerformancesResponse>(response);
}

export async function getConsolePerformanceGroupLiveCandidates(
  q: string,
  page: number,
  pageSize: number,
): Promise<ConsolePerformanceGroupLiveCandidatesResponse> {
  const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  if (q) params.set("q", q);
  const response = await fetchWithTimeout(
    `${BASE_URL}/api/console/performance-groups/live-candidates?${params.toString()}`,
    undefined,
    { requestKind: "console_performance_group_live_candidates" },
  );
  if (!response.ok) throw new Error(`Failed to fetch candidates: ${response.status}`);
  return expectJsonResponse<ConsolePerformanceGroupLiveCandidatesResponse>(response);
}

export async function getTourStatisticsComparison(tourId: number, fromLiveId: number, toLiveId: number): Promise<TourStatisticsTransition> {
  const query = new URLSearchParams({ from_live_id: String(fromLiveId), to_live_id: String(toLiveId) });
  const response = await fetchWithTimeout(`${BASE_URL}/api/catalog/tours/${tourId}/statistics/comparison?${query.toString()}`, undefined, {
    requestKind: "catalog_tour_statistics_comparison",
  });
  return expectJsonResponse<TourStatisticsTransition>(response);
}

export async function getConsoleLiveCandidates(
  q = "",
  page = 1,
  pageSize = 20,
  liveType = "",
  hasSetlist?: boolean,
  eventStatus = "",
): Promise<ConsoleLiveCandidatesResponse> {
  const query = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  if (q.trim()) query.set("q", q.trim());
  if (liveType) query.set("live_type", liveType);
  if (hasSetlist !== undefined) query.set("has_setlist", String(hasSetlist));
  if (eventStatus) query.set("event_status", eventStatus);
  const response = await fetchWithTimeout(
    `${BASE_URL}/api/console/lives?${query.toString()}`,
    undefined,
    { requestKind: "console_live_candidates" },
  );
  return expectJsonResponse<ConsoleLiveCandidatesResponse>(response);
}

export async function getConsoleLive(liveId: number): Promise<ConsoleLiveEditResponse> {
  const response = await fetchWithTimeout(`${BASE_URL}/api/console/lives/${liveId}`, undefined, {
    requestKind: "console_live_detail",
  });
  return expectJsonResponse<ConsoleLiveEditResponse>(response);
}

export async function updateConsoleLive(
  liveId: number,
  payload: ConsoleLiveUpdatePayload,
  csrfToken: string,
): Promise<ConsoleLiveMutationResponse> {
  const response = await fetchWithTimeout(
    `${BASE_URL}/api/console/lives/${liveId}`,
    {
      method: "PUT",
      headers: jsonHeaders(csrfToken),
      body: JSON.stringify(payload),
    },
    { requestKind: "console_live_update", method: "PUT" },
  );
  const result = await expectJsonResponse<ConsoleLiveMutationResponse>(response);
  clearLiveCollectionCaches();
  detailCache.delete(detailCacheKey(liveId));
  publishConsoleLiveChange("updated", liveId);
  return result;
}

export async function getConsolePerformanceGroups(): Promise<ConsolePerformanceGroupListResponse> {
  const response = await fetchWithTimeout(
    `${BASE_URL}/api/console/performance-groups`,
    undefined,
    { requestKind: "console_performance_group_list" },
  );
  if (!response.ok) throw new Error(`Failed to fetch performance groups: ${response.status}`);
  return expectJsonResponse<ConsolePerformanceGroupListResponse>(response);
}

export async function getConsolePerformanceGroup(groupId: number): Promise<ConsolePerformanceGroupEditResponse> {
  const response = await fetchWithTimeout(
    `${BASE_URL}/api/console/performance-groups/${groupId}`,
    undefined,
    { requestKind: "console_performance_group_detail" },
  );
  if (!response.ok) {
    if (response.status === 404) throw new Error(`Group ${groupId} not found`);
    throw new Error(`Failed to fetch group: ${response.status}`);
  }
  return expectJsonResponse<ConsolePerformanceGroupEditResponse>(response);
}

export async function createConsolePerformanceGroup(
  payload: ConsolePerformanceGroupUpsertPayload,
  csrfToken: string,
): Promise<ConsolePerformanceGroupMutationResponse> {
  const response = await fetchWithTimeout(
    `${BASE_URL}/api/console/performance-groups`,
    {
      method: "POST",
      headers: jsonHeaders(csrfToken),
      body: JSON.stringify(payload),
    },
    { requestKind: "console_performance_group_create", method: "POST" },
  );
  if (!response.ok) {
    if (response.status === 409) {
      const detail = await readJsonSafely(response);
      throw Object.assign(new Error("Live already belongs to another group"), { detail, status: 409 });
    }
    throw new Error(`Failed to create group: ${response.status}`);
  }
  const result = await expectJsonResponse<ConsolePerformanceGroupMutationResponse>(response);
  clearLiveCollectionCaches();
  detailCache.clear();
  return result;
}

export async function updateConsolePerformanceGroup(
  groupId: number,
  payload: ConsolePerformanceGroupUpsertPayload,
  csrfToken: string,
): Promise<ConsolePerformanceGroupMutationResponse> {
  const response = await fetchWithTimeout(
    `${BASE_URL}/api/console/performance-groups/${groupId}`,
    {
      method: "PUT",
      headers: jsonHeaders(csrfToken),
      body: JSON.stringify(payload),
    },
    { requestKind: "console_performance_group_update", method: "PUT" },
  );
  if (!response.ok) {
    if (response.status === 404) throw new Error(`Group ${groupId} not found`);
    if (response.status === 409) {
      const detail = await readJsonSafely(response);
      throw Object.assign(new Error("Live already belongs to another group"), { detail, status: 409 });
    }
    throw new Error(`Failed to update group: ${response.status}`);
  }
  const result = await expectJsonResponse<ConsolePerformanceGroupMutationResponse>(response);
  clearLiveCollectionCaches();
  detailCache.clear();
  return result;
}

export async function getLives(
  page: number,
  pageSize: 15 | 20,
  withoutSetlistOrFilters: boolean | LiveListFilters = false,
): Promise<LivesResponse> {
  const withoutSetlist = typeof withoutSetlistOrFilters === "boolean" ? withoutSetlistOrFilters : false;
  const filters = typeof withoutSetlistOrFilters === "boolean" ? undefined : withoutSetlistOrFilters;
  const requestedKey = livesCacheKey(page, pageSize, withoutSetlist, filters);
  if (!withoutSetlist) {
    const fresh = livesCache.getFresh(requestedKey, LIVES_CACHE_TTL_MS);
    if (fresh !== undefined) {
      return fresh;
    }
  }
  const inFlight = livesCache.getInFlight(requestedKey);
  if (inFlight) return inFlight;

  const requestPromise = fetchLivesRemote(page, pageSize, withoutSetlist, filters)
    .then((payload) => {
      if (withoutSetlist) return payload;
      const updatedAt = Date.now();
      livesCache.setData(requestedKey, payload, updatedAt);
      const canonicalKey = livesCacheKey(payload.pagination.page, pageSize, withoutSetlist, filters);
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
