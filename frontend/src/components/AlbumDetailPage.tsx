import { useEffect, useState } from "react";
import { getAlbumDetail, type AlbumDetail } from "../api";
import { songCatalogHref, type SongBrowseState } from "../songCatalogNavigation";
import { AlbumCoverGallery } from "./AlbumCover";
import { CatalogArt, CatalogLink, catalogDate, useCatalogScroll } from "./SongCatalogShared";

export function AlbumDetailPage({ albumId, selectedSongId, browse, revision, onSongSelect, scrollY }: {
  albumId: number; selectedSongId: number | null; browse: SongBrowseState; revision: number;
  onSongSelect: (id: number) => void; scrollY: number;
}) {
  const [album, setAlbum] = useState<AlbumDetail | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let current = true;
    setAlbum(null); setError("");
    void getAlbumDetail(albumId).then(value => { if (current) setAlbum(value); })
      .catch(reason => { if (current) setError(String(reason)); });
    return () => { current = false; };
  }, [albumId, revision, retry]);
  useCatalogScroll(album !== null, scrollY);
  if (error) return <div role="alert">{error} <button className="console-ghost-btn" onClick={() => setRetry(value => value + 1)}>重试</button></div>;
  if (!album) return <p role="status">加载中…</p>;
  const sections = [...new Set(album.tracks.map(track => track.section_name ?? ""))];
  return <article className="song-album-page" aria-label="唱片详情">
    <aside className="song-album-aside" aria-label="发行资料">
      <div className="song-album-art">{album.cover_urls.length ? <AlbumCoverGallery urls={album.cover_urls} title={album.album_name} /> : <CatalogArt title={album.album_name} />}</div>
      <dl className="song-album-facts"><div><dt>发行时间</dt><dd><time dateTime={album.release_date ?? undefined}>{catalogDate(album.release_date)}</time></dd></div>
        <div><dt>收录曲目</dt><dd>{album.tracks.length} 首</dd></div></dl>
      {album.album_url && <a className="song-album-source" href={album.album_url} target="_blank" rel="noopener noreferrer">专辑页面 ↗</a>}
    </aside>
    <div className="song-album-content"><header className="song-album-heading"><h1>{album.album_name}</h1>{album.release_label && <p>{album.release_label}</p>}</header>
      <div className="song-section-heading"><h2>曲目 <small>{album.tracks.length}</small></h2><span>唱片曲序</span></div>
      {!album.tracks.length && <p className="song-empty">暂无收录曲目</p>}
      {sections.map(section => <section key={section} aria-label={section || "曲目"}>
        {section && <h3 className="song-album-section-name">{section}</h3>}
        <ol className="song-album-tracks">{album.tracks.filter(track => (track.section_name ?? "") === section).map(track =>
          <li key={track.album_track_id} value={track.track_order} aria-current={track.song_id === selectedSongId ? "true" : undefined}>
            <span className="song-track-order" aria-hidden="true">{String(track.track_order).padStart(2, "0")}</span>
            <CatalogLink href={songCatalogHref(track.song_id, null, browse)} onNavigate={() => onSongSelect(track.song_id)}>
              {track.song_name}{track.version_label && <small> · {track.version_label}</small>}{track.edition_label && <small> · {track.edition_label}</small>}
            </CatalogLink>
          </li>)}</ol>
      </section>)}
    </div>
  </article>;
}
