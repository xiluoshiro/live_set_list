import { useEffect, useRef, useState } from "react";
import { Dialog } from "radix-ui";
import { getSongGroup, getSongPerformances, getSongVersion, type SongGroup, type SongPerformance, type SongPerformancePage, type SongVersion } from "../api";
import { songCatalogHref, type SongBrowseState } from "../songCatalogNavigation";
import { CatalogArt, CatalogLink, CatalogPagination, catalogDate, useCatalogScroll } from "./SongCatalogShared";
import { AlbumCoverGallery } from "./AlbumCover";
import { useSongDetailLayout } from "./useSongDetailLayout";
import "./song-detail.css";

export function ownershipLabel(song: Pick<SongVersion, "ownership">) {
  const owner = song.ownership;
  if (owner.mode === "pending") return "待回填";
  return [...owner.bands.map(b => b.band_name), ...owner.groups.map(g => `${g.band_name}：${g.members.map(m => m.display_name).join("、")}`)].join(" / ");
}

export function SongDetailPage({ songId, browse, revision, onSongSelect, onAlbumSelect, onLiveSelect, rememberVersion, scrollY }: {
  songId: number; browse: SongBrowseState; revision: number; scrollY: number;
  onSongSelect: (id: number) => void; onAlbumSelect: (id: number) => void; onLiveSelect: (live: SongPerformance) => void;
  rememberVersion: (groupId: number, songId: number) => void;
}) {
  const [detail, setDetail] = useState<{ song: SongVersion; group: SongGroup } | null>(null);
  const [records, setRecords] = useState<SongPerformancePage | null>(null);
  const [year, setYear] = useState<number | undefined>();
  const [availableYears, setAvailableYears] = useState<number[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(8);
  const [error, setError] = useState("");
  const [recordsError, setRecordsError] = useState("");
  const [retry, setRetry] = useState(0);
  const groupIdRef = useRef<number | null>(null);
  const layoutRef = useRef<HTMLElement>(null);
  const rowsRef = useRef<HTMLTableSectionElement>(null);
  const recordsViewportRef = useRef<HTMLDivElement>(null);
  const releasesRef = useRef<HTMLDivElement>(null);
  const recordAnchor = useRef(0);
  const [allReleasesOpen, setAllReleasesOpen] = useState(false);
  const [coverOpen, setCoverOpen] = useState(false);
  useEffect(() => {
    let current = true;
    setError(""); setDetail(null); setAllReleasesOpen(false); setCoverOpen(false);
    void getSongVersion(songId).then(async song => {
      const group = await getSongGroup(song.group_id);
      if (!current) return;
      if (groupIdRef.current !== group.group_id) { setYear(undefined); setPage(1); setAvailableYears([]); recordAnchor.current = 0; }
      groupIdRef.current = group.group_id;
      rememberVersion(group.group_id, song.song_id);
      setDetail({ song, group });
    }).catch(reason => { if (current) setError(String(reason)); });
    return () => { current = false; };
  }, [songId, revision, retry]);
  useEffect(() => {
    let current = true;
    setRecords(null); setRecordsError("");
    if (detail) void getSongPerformances(detail.song.song_id, page, { year, pageSize }).then(result => {
      if (!current) return;
      setAvailableYears(result.available_years);
      if (page > result.total_pages) {
        recordAnchor.current = (result.total_pages - 1) * pageSize;
        setPage(result.total_pages);
      } else setRecords(result);
    }).catch(reason => { if (current) setRecordsError(String(reason)); });
    return () => { current = false; };
  }, [detail, page, pageSize, year]);
  useSongDetailLayout(layoutRef, recordsViewportRef, rowsRef, releasesRef, pageSize, size => {
    setPage(Math.floor(recordAnchor.current / size) + 1); setPageSize(size);
  });
  useCatalogScroll(detail !== null, scrollY);
  if (error) return <div role="alert">{error} <button className="console-ghost-btn" onClick={() => setRetry(value => value + 1)}>重试</button></div>;
  if (!detail) return <p role="status">加载中…</p>;
  const { song, group } = detail;
  const albums = [...song.albums].sort((a, b) => (a.release_date ?? "9999").localeCompare(b.release_date ?? "9999"));
  const releases = albums.map((album, index) => <CatalogLink className={`song-release${index === 0 ? " song-release-first" : ""}${album.cover_urls.length ? "" : " song-release-no-art"}`} key={album.album_id} href={songCatalogHref(songId, album.album_id, browse)}
    onNavigate={() => { setAllReleasesOpen(false); onAlbumSelect(album.album_id); }} aria-label={`查看唱片 ${album.album_name}`}>
    {!!album.cover_urls.length && <span className="song-release-art"><CatalogArt url={album.cover_urls[0].url} title={`${album.album_name} ${album.cover_urls[0].name || "封面"}`} /></span>}
    <span className="song-release-copy"><span className="song-release-date">{index === 0 && album.release_date && "最早收录 · "}<time dateTime={album.release_date ?? undefined}>{catalogDate(album.release_date)}</time></span>
      <strong>{album.album_name}</strong>{album.release_label && <small>{album.release_label.replace(`${ownershipLabel(song)} `, "")}</small>}</span>
  </CatalogLink>);
  return <article className="song-detail" aria-label="歌曲详情" ref={layoutRef}>
      <header className="song-detail-heading"><p className="song-owner">{ownershipLabel(song)}</p><h1>{group.group_name}</h1>
        {(group.versions.length > 1 || song.cover_urls.length > 0) && <div className="song-detail-options">
        {group.versions.length > 1 && <div className="song-catalog-versions" role="group" aria-label="歌曲版本">
          {group.versions.map(version => <button key={version.song_id} type="button" className="section-tab-btn" aria-pressed={version.song_id === songId}
            onClick={() => onSongSelect(version.song_id)}>{version.version_label || "原版"}</button>)}
        </div>}
        {!!song.cover_urls.length && <Dialog.Root open={coverOpen} onOpenChange={setCoverOpen}>
          <Dialog.Trigger asChild><button className="song-text-button" type="button">歌曲封面</button></Dialog.Trigger>
          <Dialog.Portal><Dialog.Overlay className="modal-mask"><Dialog.Content className="modal song-cover-dialog" aria-describedby={undefined}>
            <div className="modal-head"><Dialog.Title>{song.song_name}</Dialog.Title><Dialog.Close asChild><button type="button" className="song-text-button">关闭 ×</button></Dialog.Close></div>
            <AlbumCoverGallery key={song.song_id} covers={song.cover_urls} title={song.song_name} label="歌曲封面" />
          </Dialog.Content></Dialog.Overlay></Dialog.Portal>
        </Dialog.Root>}
        </div>}
      </header>
    <div className="song-detail-columns">
    <section className="song-performance-section" aria-label="演出记录" aria-busy={!records && !recordsError}>
      <div className="song-section-heading"><h2>演出记录 <small>{song.performance_count} 次{group.versions.length > 1 && " · 全部版本"}</small></h2>
        <select aria-label="演出年份" value={year ?? "all"} onChange={event => {
          setYear(event.target.value === "all" ? undefined : Number(event.target.value)); setPage(1); recordAnchor.current = 0;
        }}><option value="all">全部年份</option>{availableYears.map(value => <option key={value} value={value}>{value} 年</option>)}</select>
      </div>
      <div className="song-records-viewport" ref={recordsViewportRef} tabIndex={0} role="region" aria-label="演出记录列表">
      {recordsError && <p role="alert">{recordsError} <button className="console-ghost-btn" onClick={() => setRetry(value => value + 1)}>重试</button></p>}
      <table className="song-performance-table" aria-label="演出记录"><thead><tr><th scope="col">日期</th><th scope="col">演出</th><th scope="col">曲序</th></tr></thead>
        <tbody ref={rowsRef}>{records?.items.map(item => <tr key={item.setlist_id}>
          <td><time dateTime={item.live_date}>{catalogDate(item.live_date)}</time></td>
          <td><CatalogLink href={`/lives/${item.live_id}`} onNavigate={() => onLiveSelect(item)}>{item.live_title}</CatalogLink>
            {(item.is_short || item.live_cover === "cover") && <small className="song-record-flags">{[item.is_short ? "短版" : "", item.live_cover === "cover" ? "翻唱" : ""].filter(Boolean).join(" · ")}</small>}</td>
          <td>{item.segment_type} {String(item.sub_order).padStart(2, "0")}</td>
        </tr>)}</tbody>
      </table>
      {!records && !recordsError && <p role="status">加载中…</p>}
      {records?.total === 0 && <p className="song-empty">暂无演奏记录</p>}
      </div>
      <div className="song-detail-pagination">{records && <CatalogPagination data={records} label="演出记录分页" onPage={next => {
        recordAnchor.current = (next - 1) * pageSize; setPage(next);
        if (recordsViewportRef.current) recordsViewportRef.current.scrollTop = 0;
      }} expanded />}</div>
    </section>
    <aside className="song-release-section" aria-label="收录唱片">
      <div className="song-section-heading"><h2>收录唱片</h2>
        {!!albums.length && <Dialog.Root open={allReleasesOpen} onOpenChange={setAllReleasesOpen}>
          <Dialog.Trigger asChild><button type="button" className="song-text-button">全部收录</button></Dialog.Trigger>
          <Dialog.Portal><Dialog.Overlay className="modal-mask"><Dialog.Content className="modal song-releases-dialog" aria-describedby={undefined}>
            <div className="modal-head"><Dialog.Title>收录唱片 <small>{albums.length}</small></Dialog.Title><Dialog.Close asChild><button type="button" className="song-text-button">关闭 ×</button></Dialog.Close></div>
            <div className="song-all-releases">{releases}</div>
          </Dialog.Content></Dialog.Overlay></Dialog.Portal>
        </Dialog.Root>}
      </div>
      <div className="song-release-list" ref={releasesRef} tabIndex={0} role="region" aria-label="收录唱片列表">
        {releases}{!albums.length && <p className="song-empty">暂无收录唱片</p>}
      </div>
    </aside>
    </div>
  </article>;
}
