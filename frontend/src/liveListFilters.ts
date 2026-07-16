export type LiveListSort = "date_desc" | "date_asc";

export type LiveListFilters = {
  q: string;
  year: number | null;
  liveType: string | null;
  bandId: number | null;
  sort: LiveListSort;
};

export const DEFAULT_LIVE_LIST_FILTERS: LiveListFilters = {
  q: "",
  year: null,
  liveType: null,
  bandId: null,
  sort: "date_desc",
};

export function normalizedLiveListFilters(filters?: LiveListFilters): LiveListFilters {
  return {
    q: filters?.q.trim() ?? "",
    year: filters?.year ?? null,
    liveType: filters?.liveType ?? null,
    bandId: filters?.bandId ?? null,
    sort: filters?.sort ?? "date_desc",
  };
}

export function liveListFiltersKey(filters?: LiveListFilters): string {
  const normalized = normalizedLiveListFilters(filters);
  return [
    normalized.q,
    normalized.year ?? "",
    normalized.liveType ?? "",
    normalized.bandId ?? "",
    normalized.sort,
  ].join(":");
}

export function hasActiveLiveListFilters(filters?: LiveListFilters): boolean {
  const normalized = normalizedLiveListFilters(filters);
  return (
    normalized.q !== ""
    || normalized.year !== null
    || normalized.liveType !== null
    || normalized.bandId !== null
    || normalized.sort !== "date_desc"
  );
}
