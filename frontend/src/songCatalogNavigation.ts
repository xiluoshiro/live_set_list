import type { SongSort } from "./api";

export type SongBrowseState = { query: string; page: number; bandId: number | null; sort: SongSort; pageSize: number };
export const DEFAULT_SONG_BROWSE: SongBrowseState = { query: "", page: 1, bandId: null, sort: "plays", pageSize: 12 };

export function normalizeSongBrowse(value?: Partial<SongBrowseState>): SongBrowseState {
  const positive = (n: number | undefined, fallback: number) => Number.isInteger(n) && Number(n) > 0 ? Number(n) : fallback;
  return {
    query: value?.query ?? "", page: positive(value?.page, 1),
    bandId: positive(value?.bandId ?? undefined, 0) || null,
    sort: value?.sort && ["name", "plays", "recent", "release"].includes(value.sort) ? value.sort : "plays",
    pageSize: Math.min(100, positive(value?.pageSize, 12)),
  };
}

export function songBrowseFromSearch(search: string): SongBrowseState {
  const query = new URLSearchParams(search);
  return normalizeSongBrowse({ query: query.get("q") ?? "", page: Number(query.get("page")),
    bandId: Number(query.get("band")), sort: query.get("sort") as SongSort, pageSize: Number(query.get("size")) });
}

export function songCatalogHref(songId: number | null, albumId: number | null, browse: SongBrowseState): string {
  const query = new URLSearchParams();
  if (browse.query) query.set("q", browse.query);
  if (browse.bandId) query.set("band", String(browse.bandId));
  if (browse.sort !== "plays") query.set("sort", browse.sort);
  if (browse.page > 1) query.set("page", String(browse.page));
  if (browse.pageSize !== 12) query.set("size", String(browse.pageSize));
  const path = albumId !== null ? `/albums/${albumId}` : songId !== null ? `/songs/${songId}` : "/songs";
  return query.size ? `${path}?${query}` : path;
}
