import { useEffect, useRef, useState } from "react";
import { getSongGroup, SONG_CATALOG_CHANGE, type SongGroupSummary, type SongPerformance } from "../api";
import { normalizeSongBrowse, songCatalogHref, type SongBrowseState } from "../songCatalogNavigation";
import { SongCatalogOverview } from "./SongCatalogOverview";
import { SongDetailPage } from "./SongDetailPage";
import { AlbumDetailPage } from "./AlbumDetailPage";
import { CatalogLink } from "./SongCatalogShared";
import "./song-catalog.css";

export { ownershipLabel } from "./SongDetailPage";

export function SongCatalog({ songId, albumId = null, onSongSelect, onAlbumSelect, onLiveSelect,
  browse: inputBrowse, onBrowseChange, onBack, backLabel = "歌曲资料", backHref, scrollY = 0 }: {
  songId: number | null; albumId?: number | null;
  onSongSelect: (id: number) => void; onAlbumSelect?: (id: number) => void;
  onLiveSelect: (live: SongPerformance) => void;
  browse?: Partial<SongBrowseState>; onBrowseChange?: (browse: SongBrowseState) => void;
  onBack?: () => void; backLabel?: string; backHref?: string; scrollY?: number;
}) {
  const [localBrowse, setLocalBrowse] = useState(() => normalizeSongBrowse(inputBrowse));
  const browse = inputBrowse ? normalizeSongBrowse(inputBrowse) : localBrowse;
  const changeBrowse = (next: SongBrowseState) => { setLocalBrowse(next); onBrowseChange?.(next); };
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const selectedVersions = useRef(new Map<number, number>());
  const generation = useRef(0);
  useEffect(() => {
    const refresh = () => setRevision(value => value + 1);
    window.addEventListener(SONG_CATALOG_CHANGE, refresh);
    return () => window.removeEventListener(SONG_CATALOG_CHANGE, refresh);
  }, []);
  useEffect(() => { generation.current += 1; setError(""); }, [songId, albumId, browse.query, browse.bandId, browse.page]);
  useEffect(() => () => { generation.current += 1; }, []);
  const selectGroup = async (item: SongGroupSummary) => {
    const request = ++generation.current;
    setError("");
    try {
      const group = await getSongGroup(item.group_id);
      if (request !== generation.current) return;
      const allowed = group.versions.filter(version => item.matched_song_ids.includes(version.song_id));
      const selected = allowed.find(version => version.song_id === selectedVersions.current.get(item.group_id)) ?? allowed[0];
      if (selected) onSongSelect(selected.song_id);
    } catch (reason) { if (request === generation.current) setError(String(reason)); }
  };
  const selectAlbum = onAlbumSelect ?? ((id: number) => window.location.assign(songCatalogHref(songId, id, browse)));
  if (songId === null && albumId === null) return <>
    {error && <p role="alert">{error}</p>}
    <SongCatalogOverview browse={browse} onBrowseChange={changeBrowse} onSelectGroup={item => void selectGroup(item)} onAlbumSelect={selectAlbum} revision={revision} scrollY={scrollY} />
  </>;
  return <main className="song-catalog song-catalog-single">
    <div className="song-catalog-context"><CatalogLink href={backHref ?? songCatalogHref(null, null, browse)} onNavigate={onBack ?? (() => window.location.assign(songCatalogHref(null, null, browse)))}>← {backLabel}</CatalogLink>
      <span>{albumId !== null ? "唱片详情" : "歌曲详情"}</span></div>
    {albumId !== null ? <AlbumDetailPage albumId={albumId} selectedSongId={songId} browse={browse} revision={revision} onSongSelect={onSongSelect} scrollY={scrollY} /> :
      songId !== null && <SongDetailPage songId={songId} browse={browse} revision={revision} onSongSelect={onSongSelect} onAlbumSelect={selectAlbum}
        onLiveSelect={onLiveSelect} rememberVersion={(groupId, id) => selectedVersions.current.set(groupId, id)} scrollY={scrollY} />}
  </main>;
}
