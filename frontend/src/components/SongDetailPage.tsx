import { useEffect, useRef, useState } from "react";
import { getSongGroup, getSongPerformances, getSongVersion, type SongGroup, type SongPerformance, type SongPerformancePage, type SongVersion } from "../api";
import { songCatalogHref, type SongBrowseState } from "../songCatalogNavigation";
import { CatalogArt, CatalogLink, CatalogPagination, catalogDate, useCatalogScroll, useFittedCatalogPage } from "./SongCatalogShared";
import { AlbumCoverGallery } from "./AlbumCover";

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
  const rowsRef = useRef<HTMLTableSectionElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const [railOverflow, setRailOverflow] = useState(false);
  useEffect(() => {
    let current = true;
    setError(""); setDetail(null);
    void getSongVersion(songId).then(async song => {
      const group = await getSongGroup(song.group_id);
      if (!current) return;
      if (groupIdRef.current !== group.group_id) { setYear(undefined); setPage(1); setAvailableYears([]); }
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
      if (page > result.total_pages) setPage(result.total_pages); else setRecords(result);
    }).catch(reason => { if (current) setRecordsError(String(reason)); });
    return () => { current = false; };
  }, [detail, page, pageSize, year]);
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const measure = () => setRailOverflow(rail.scrollWidth > rail.clientWidth + 1);
    measure();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    observer?.observe(rail); window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, [detail]);
  useFittedCatalogPage(rowsRef, footerRef, pageSize, size => {
    setPage(Math.floor((page - 1) * pageSize / size) + 1); setPageSize(size);
  });
  useCatalogScroll(detail !== null, scrollY);
  if (error) return <div role="alert">{error} <button className="console-ghost-btn" onClick={() => setRetry(value => value + 1)}>重试</button></div>;
  if (!detail) return <p role="status">加载中…</p>;
  const { song, group } = detail;
  const cover = song.display_cover;
  return <article className="song-detail" aria-label="歌曲详情">
    <div className="song-detail-overview">
      <div className={`song-detail-art${song.cover_urls.length ? " song-detail-art-gallery" : ""}`}>{song.cover_urls.length ? <AlbumCoverGallery key={song.song_id} urls={song.cover_urls} title={song.song_name} label="歌曲封面" /> : cover?.source === "album" ? <CatalogLink href={songCatalogHref(null, cover.album_id, browse)} onNavigate={() => onAlbumSelect(cover.album_id)} title={`封面选自《${cover.album_name}》`}>
        <CatalogArt url={cover.url} title={`歌曲展示封面，选自《${cover.album_name}》`} /></CatalogLink> : <CatalogArt title={group.group_name} />}</div>
      <header className="song-detail-heading"><div><h1>{group.group_name}</h1><p className="song-owner">{ownershipLabel(song)}</p>
        {group.versions.length > 1 && <div className="song-catalog-versions" role="group" aria-label="歌曲版本">
          {group.versions.map(version => <button key={version.song_id} type="button" className="section-tab-btn" aria-pressed={version.song_id === songId}
            onClick={() => onSongSelect(version.song_id)}>{version.version_label || "默认版本"}</button>)}
        </div>}</div>
        <div className="song-performance-total"><span>演奏次数</span><strong>{song.performance_count}<small> 次</small></strong></div>
      </header>
      <section className="song-release-section" aria-label="收录唱片">
        <div className="song-section-heading"><h2>收录唱片 <small>{song.albums.length}</small></h2>
          {railOverflow && <div className="song-rail-controls"><button className="console-ghost-btn" aria-label="上一组唱片" onClick={() => railRef.current?.scrollBy({ left: -railRef.current.clientWidth, behavior: "smooth" })}>←</button>
            <button className="console-ghost-btn" aria-label="下一组唱片" onClick={() => railRef.current?.scrollBy({ left: railRef.current.clientWidth, behavior: "smooth" })}>→</button></div>}
        </div>
        <div className="song-release-rail" ref={railRef} tabIndex={song.albums.length ? 0 : undefined} aria-label="收录唱片横向列表">
          {song.albums.map(album => <CatalogLink className="song-release" key={album.album_id} href={songCatalogHref(songId, album.album_id, browse)}
            onNavigate={() => onAlbumSelect(album.album_id)} aria-label={`查看唱片 ${album.album_name}`}>
            <span className="song-release-art"><CatalogArt url={album.cover_urls[0]} title={`${album.album_name} 封面`} /></span>
            <span className="song-release-copy"><small>{album.release_label}</small><strong>{album.album_name}</strong><time dateTime={album.release_date ?? undefined}>{catalogDate(album.release_date)}</time></span>
          </CatalogLink>)}
          {!song.albums.length && <p className="song-empty">暂无收录唱片</p>}
        </div>
      </section>
    </div>
    <section className="song-performance-section" aria-label="演出记录" aria-busy={!records && !recordsError}>
      <div className="song-section-heading"><h2>演出记录 <small>{records?.total ?? "—"}</small></h2>
        <label className="song-sort-label"><span>最新在前</span><select aria-label="演出年份" value={year ?? "all"} onChange={event => {
          setYear(event.target.value === "all" ? undefined : Number(event.target.value)); setPage(1);
        }}><option value="all">全部年份</option>{availableYears.map(value => <option key={value} value={value}>{value} 年</option>)}</select></label>
      </div>
      {recordsError && <p role="alert">{recordsError} <button className="console-ghost-btn" onClick={() => setRetry(value => value + 1)}>重试</button></p>}
      <table className="song-performance-table"><thead><tr><th>日期</th><th>演出</th><th>曲序</th></tr></thead>
        <tbody ref={rowsRef}>{records?.items.map(item => <tr key={item.setlist_id}>
          <td><time dateTime={item.live_date}>{catalogDate(item.live_date)}</time></td>
          <td><CatalogLink href={`/lives/${item.live_id}`} onNavigate={() => onLiveSelect(item)}>{item.live_title}</CatalogLink>
            {(item.is_short || item.live_cover === "cover") && <small className="song-record-flags">{[item.is_short ? "短版" : "", item.live_cover === "cover" ? "翻唱" : ""].filter(Boolean).join(" · ")}</small>}</td>
          <td>{item.segment_type} {String(item.sub_order).padStart(2, "0")}</td>
        </tr>)}</tbody>
      </table>
      {!records && !recordsError && <p role="status">加载中…</p>}
      {records?.total === 0 && <p className="song-empty">暂无演奏记录</p>}
      {records && <CatalogPagination data={records} footerRef={footerRef} label="演出记录分页" onPage={setPage} />}
    </section>
  </article>;
}
