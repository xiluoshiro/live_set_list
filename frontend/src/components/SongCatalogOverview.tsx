import { useEffect, useRef, useState } from "react";
import { getAlbums, getSongGroups, type AlbumDirectoryPage, type AlbumSort, type SongDirectoryPage, type SongGroupSummary, type SongSort } from "../api";
import { albumTitle } from "../albumTitle";
import { songCatalogHref, type SongBrowseState } from "../songCatalogNavigation";
import { getBandIconSrc } from "./BandIconsCell";
import { PageTitle } from "./PageTitle";
import { SectionTabs } from "./SectionTabs";
import { CatalogArt, CatalogLink, CatalogPagination, catalogDate, useCatalogScroll, useFittedCatalogPage } from "./SongCatalogShared";

export function SongCatalogOverview({ browse, onBrowseChange, onSelectGroup, onAlbumSelect, revision, scrollY }: {
  browse: SongBrowseState; onBrowseChange: (state: SongBrowseState) => void;
  onSelectGroup: (group: SongGroupSummary) => void; onAlbumSelect: (id: number) => void;
  revision: number; scrollY: number;
}) {
  const [query, setQuery] = useState(browse.query);
  const albums = browse.view === "albums";
  const noun = albums ? "专辑" : "歌曲";
  const [loaded, setLoaded] = useState<{ view: SongBrowseState["view"]; data: SongDirectoryPage | AlbumDirectoryPage } | null>(null);
  const data = loaded?.view === browse.view ? loaded.data : null;
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const layoutRef = useRef<HTMLElement>(null);
  const rowsRef = useRef<HTMLTableSectionElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const readingPosition = useRef({ browse, first: (browse.page - 1) * browse.pageSize });
  const previous = readingPosition.current.browse;
  if (previous.view !== browse.view || previous.albumSort !== browse.albumSort || previous.query !== browse.query || previous.bandId !== browse.bandId || previous.sort !== browse.sort ||
    previous.page !== browse.page || previous.pageSize !== browse.pageSize) {
    readingPosition.current = { browse, first: (browse.page - 1) * browse.pageSize };
  }
  const changeBrowse = (next: SongBrowseState) => {
    readingPosition.current = { browse: next, first: (next.page - 1) * next.pageSize };
    if (viewportRef.current) viewportRef.current.scrollTop = 0;
    onBrowseChange(next);
  };
  const lastFacets = useRef<Partial<Record<SongBrowseState["view"], SongDirectoryPage["facets"] | AlbumDirectoryPage["facets"]>>>({});
  useEffect(() => setQuery(browse.query), [browse.query]);
  useEffect(() => {
    let current = true;
    setError(""); setLoaded(null);
    const request = albums
      ? getAlbums(browse.query, browse.page, browse.bandId ?? undefined, { sort: browse.albumSort, pageSize: browse.pageSize })
      : getSongGroups(browse.query, browse.page, browse.bandId ?? undefined, undefined, { sort: browse.sort, pageSize: browse.pageSize });
    void request.then(result => {
      if (!current) return;
      if (browse.page > result.total_pages) changeBrowse({ ...browse, page: result.total_pages });
      else { lastFacets.current[browse.view] = result.facets; setLoaded({ view: browse.view, data: result }); }
    }).catch(reason => { if (current) setError(String(reason)); });
    return () => { current = false; };
  }, [browse.view, browse.albumSort, browse.query, browse.page, browse.bandId, browse.sort, browse.pageSize, revision, retry]);
  useFittedCatalogPage(rowsRef, viewportRef, browse.pageSize, pageSize => {
    const next = { ...browse, pageSize, page: Math.floor(readingPosition.current.first / pageSize) + 1 };
    readingPosition.current.browse = next;
    onBrowseChange(next);
  }, layoutRef);
  useCatalogScroll(data !== null, scrollY);
  // Keep filter controls mounted while rows load, preserving focus and horizontal scroll.
  const facets = data?.facets ?? lastFacets.current[browse.view];
  const bands = facets?.bands ?? [];
  const selectedBand = bands.find(b => b.band_id === browse.bandId);
  return <main className="song-catalog song-directory" aria-label="歌曲资料" ref={layoutRef}>
    <header className="page-heading song-directory-heading">
      <div className="page-heading-main song-directory-heading-title"><PageTitle title="歌曲资料" />
        <SectionTabs label="资料类型" value={browse.view} options={[{ value: "songs", label: "歌曲" }, { value: "albums", label: "专辑" }]}
          onChange={view => { if (view !== browse.view) changeBrowse({ ...browse, view, page: 1 }); }} /></div>
      <form className="home-search-row page-heading-search" role="search" onSubmit={event => {
        event.preventDefault(); changeBrowse({ ...browse, query: query.trim(), page: 1 });
      }}><input aria-label={`搜索${noun}、乐队`} placeholder={albums ? "搜索专辑、乐队" : "搜索歌名、乐队"} value={query} onChange={event => setQuery(event.target.value)} />
        <button type="submit">搜索</button></form>
    </header>
    {error && <div role="alert">{error} <button className="console-ghost-btn" onClick={() => setRetry(value => value + 1)}>重试</button></div>}
    <div className="song-directory-layout">
      <aside className="song-band-directory" aria-label="按乐队筛选">
        <h2>按乐队</h2>
        <div className="song-band-options">
          <button type="button" aria-pressed={browse.bandId === null} onClick={() => changeBrowse({ ...browse, bandId: null, page: 1 })}>
            <span>全部{noun}</span><small>{facets?.total ?? "—"}</small>
          </button>
          {bands.map(band => <button key={band.band_id} type="button" aria-pressed={browse.bandId === band.band_id}
            onClick={() => changeBrowse({ ...browse, bandId: band.band_id, page: 1 })}>
            {getBandIconSrc(band.band_id) && <img src={getBandIconSrc(band.band_id)!} alt="" />}
            <span title={band.band_name}>{band.band_name}</span><small>{"album_count" in band ? band.album_count : band.song_count}</small>
          </button>)}
        </div>
      </aside>
      <section className="song-directory-results" aria-label={`${noun}列表`} aria-busy={!data && !error}>
        <div className="song-section-heading"><div className="song-directory-scope"><h2>{selectedBand?.band_name ?? (browse.bandId ? "筛选结果" : `全部${noun}`)} <small>{data?.total ?? "—"}</small></h2>
          {(browse.query || browse.bandId !== null) && <button type="button" className="all-lives-button"
            onClick={() => changeBrowse({ ...browse, query: "", bandId: null, page: 1 })}>清除筛选</button>}</div>
          {albums ? <label className="song-sort-label">排序 <select aria-label="专辑排序" value={browse.albumSort}
            onChange={event => changeBrowse({ ...browse, albumSort: event.target.value as AlbumSort, page: 1 })}>
            <option value="recent">发行日期（晚→早）</option><option value="release">发行日期（早→晚）</option><option value="name">专辑名称</option>
          </select></label> : <label className="song-sort-label">排序 <select aria-label="歌曲排序" value={browse.sort}
            onChange={event => changeBrowse({ ...browse, sort: event.target.value as SongSort, page: 1 })}>
            <option value="plays">演奏次数</option><option value="name">歌曲名称</option>
            <option value="recent">最近演出</option><option value="release">首次发行（早→晚）</option>
          </select></label>}</div>
        <div className="song-directory-viewport" ref={viewportRef} tabIndex={0} role="region" aria-label={`${noun}目录`}>
        <table className={`song-directory-table${albums ? " album-directory-table" : ""}`}><thead>{albums
          ? <tr><th>专辑</th><th>发行日期</th><th>曲目数</th></tr>
          : <tr><th>歌曲</th><th>首次发行</th><th>首发唱片</th><th>演奏次数</th><th>最近演出</th></tr>}</thead>
          <tbody ref={rowsRef}>{albums ? (data as AlbumDirectoryPage | null)?.items.map(item => <tr key={item.album_id} onClick={event => {
            if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey ||
              (event.target as Element).closest("a")) return;
            onAlbumSelect(item.album_id);
          }}>
            <td><div className="song-directory-title"><CatalogArt url={item.cover_urls[0]?.url} title={albumTitle(item)} />
              <div><CatalogLink className="song-directory-link" title={albumTitle(item)} href={songCatalogHref(null, item.album_id, browse)} onNavigate={() => onAlbumSelect(item.album_id)}><span>{albumTitle(item)}</span></CatalogLink>
                <small className="song-mobile-release">发行日期 {catalogDate(item.release_date)}</small></div></div></td>
            <td><time dateTime={item.release_date ?? undefined}>{catalogDate(item.release_date)}</time></td><td>{item.track_count}</td>
          </tr>) : (data as SongDirectoryPage | null)?.items.map(item => <tr key={item.group_id} onClick={event => {
            if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey ||
              (event.target as Element).closest("a")) return;
            onSelectGroup(item);
          }}>
            <td><div className="song-directory-title"><CatalogArt url={item.display_cover?.url} title={item.display_cover?.source === "album" ? `封面选自《${item.display_cover.album_name}》` : item.group_name} />
              <div><CatalogLink className="song-directory-link" title={item.group_name} href={songCatalogHref(item.matched_song_ids[0], null, browse)} onNavigate={() => onSelectGroup(item)}><span>{item.group_name}</span></CatalogLink>
                <small className="song-mobile-release">首次发行 {catalogDate(item.first_release_date)}</small></div></div></td>
            <td><time dateTime={item.first_release_date ?? undefined}>{catalogDate(item.first_release_date)}</time></td>
            <td><div className="song-first-releases">{item.first_release_albums.length ? item.first_release_albums.map(album =>
              <CatalogLink key={album.album_id} title={album.album_name} href={songCatalogHref(null, album.album_id, browse)} onNavigate={() => onAlbumSelect(album.album_id)}>{album.album_name}</CatalogLink>) : "—"}</div></td>
            <td>{item.performance_count}</td><td><time dateTime={item.latest_performance_date ?? undefined}>{catalogDate(item.latest_performance_date)}</time></td>
          </tr>)}</tbody>
        </table>
        {!data && !error && <p role="status">加载中…</p>}
        {data?.total === 0 && <p className="song-empty">暂无{noun}</p>}
        </div>
        <div className="song-directory-pagination">{data && <CatalogPagination data={data} expanded label={`${noun}列表分页`} onPage={page => changeBrowse({ ...browse, page })} />}</div>
      </section>
    </div>
  </main>;
}
