import type { AlbumSummary } from "./api";

export function albumTitle(album: Pick<AlbumSummary, "album_name" | "release_label">): string {
  const label = album.release_label.trim();
  return label ? `${label}「${album.album_name}」` : album.album_name;
}
