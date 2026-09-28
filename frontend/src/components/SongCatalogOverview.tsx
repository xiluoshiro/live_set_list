import { useEffect, useRef, useState } from "react";
import { getSongGroups, type SongDirectoryPage, type SongGroupSummary, type SongSort } from "../api";
import { songCatalogHref, type SongBrowseState } from "../songCatalogNavigation";
import { getBandIconSrc } from "./BandIconsCell";
import { CatalogArt, CatalogLink, CatalogPagination, catalogDate, useCatalogScroll, useFittedCatalogPage } from "./SongCatalogShared";

export function SongCatalogOverview({ browse, onBrowseChange, onSelectGroup, onAlbumSelect, revision, scrollY }: {
  browse: SongBrowseState; onBrowseChange: (state: SongBrowseState) => void;
  onSelectGroup: (group: SongGroupSummary) => void; onAlbumSelect: (id: number) => void;
  revision: number; scrollY: number;
}) {
  const [query, setQuery] = useState(browse.query);
  const [data, setData] = useState<SongDirectoryPage | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const rowsRef = useRef<HTMLTableSectionElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  useEffect(() => setQuery(browse.query), [browse.query]);
  useEffect(() => {
    let current = true;
    setError(""); setData(null);
    void getSongGroups(browse.query, browse.page, browse.bandId ?? undefined, undefined,
      { sort: browse.sort, pageSize: browse.pageSize }).then(result => {
      if (!current) return;
      if (browse.page > result.total_pages) onBrowseChange({ ...browse, page: result.total_pages });
      else setData(result);
    }).catch(reason => { if (current) setError(String(reason)); });
    return () => { current = false; };
  }, [browse.query, browse.page, browse.bandId, browse.sort, browse.pageSize, revision, retry]);
  useFittedCatalogPage(rowsRef, footerRef, browse.pageSize, pageSize => {
    const first = (browse.page - 1) * browse.pageSize;
    onBrowseChange({ ...browse, pageSize, page: Math.floor(first / pageSize) + 1 });
  });
  useCatalogScroll(data !== null, scrollY);
  const selectedBand = data?.facets.bands.find(b => b.band_id === browse.bandId);
  const bands = data?.facets.bands ?? [];
  return <main className="song-catalog song-directory" aria-label="歌曲资料">
    <header className="song-directory-heading">
      <div><h1>歌曲资料</h1><p>{data ? `${data.facets.total} 首歌曲 · ${bands.length} 支乐队` : "加载中…"}</p></div>
      <form className="home-search-row" role="search" onSubmit={event => {
        event.preventDefault(); onBrowseChange({ ...browse, query: query.trim(), page: 1 });
      }}><input aria-label="搜索歌曲、乐队" placeholder="搜索歌名、乐队" value={query} onChange={event => setQuery(event.target.value)} />
        <button type="submit">搜索</button></form>
    </header>
    {error && <div role="alert">{error} <button className="console-ghost-btn" onClick={() => setRetry(value => value + 1)}>重试</button></div>}
    <div className="song-directory-layout">
      <aside className="song-band-directory" aria-label="按乐队筛选">
        <h2>按乐队</h2>
        <div className="song-band-options">
          <button type="button" aria-pressed={browse.bandId === null} onClick={() => onBrowseChange({ ...browse, bandId: null, page: 1 })}>
            <span>全部歌曲</span><small>{data?.facets.total ?? "—"}</small>
          </button>
          {bands.map(band => <button key={band.band_id} type="button" aria-pressed={browse.bandId === band.band_id}
            onClick={() => onBrowseChange({ ...browse, bandId: band.band_id, page: 1 })}>
            {getBandIconSrc(band.band_id) && <img src={getBandIconSrc(band.band_id)!} alt="" />}
            <span>{band.band_name}</span><small>{band.song_count}</small>
          </button>)}
        </div>
      </aside>
      <section className="song-directory-results" aria-label="歌曲列表" aria-busy={!data && !error}>
        <div className="song-section-heading"><h2>{selectedBand?.band_name ?? (browse.bandId ? "筛选结果" : "全部歌曲")} <small>{data?.total ?? "—"}</small></h2>
          <label className="song-sort-label">排序 <select aria-label="歌曲排序" value={browse.sort}
            onChange={event => onBrowseChange({ ...browse, sort: event.target.value as SongSort, page: 1 })}>
            <option value="plays">演奏次数</option><option value="name">歌曲名称</option>
            <option value="recent">最近演出</option><option value="release">首次发行（早→晚）</option>
          </select></label></div>
        <table className="song-directory-table"><thead><tr><th>歌曲</th><th>首次发行</th><th>首发唱片</th><th>演奏次数</th><th>最近演出</th></tr></thead>
          <tbody ref={rowsRef}>{data?.items.map(item => <tr key={item.group_id}>
            <td><div className="song-directory-title"><CatalogArt url={item.display_cover?.url} title={item.display_cover?.source === "album" ? `封面选自《${item.display_cover.album_name}》` : item.group_name} />
              <div><CatalogLink href={songCatalogHref(item.matched_song_ids[0], null, browse)} onNavigate={() => onSelectGroup(item)}>{item.group_name}</CatalogLink>
                <small className="song-mobile-release">首次发行 {catalogDate(item.first_release_date)}</small></div></div></td>
            <td><time dateTime={item.first_release_date ?? undefined}>{catalogDate(item.first_release_date)}</time></td>
            <td><div className="song-first-releases">{item.first_release_albums.length ? item.first_release_albums.map(album =>
              <CatalogLink key={album.album_id} href={songCatalogHref(null, album.album_id, browse)} onNavigate={() => onAlbumSelect(album.album_id)}>{album.album_name}</CatalogLink>) : "—"}</div></td>
            <td>{item.performance_count}</td><td><time dateTime={item.latest_performance_date ?? undefined}>{catalogDate(item.latest_performance_date)}</time></td>
          </tr>)}</tbody>
        </table>
        {!data && !error && <p role="status">加载中…</p>}
        {data?.total === 0 && <p className="song-empty">暂无歌曲</p>}
        {data && <CatalogPagination data={data} footerRef={footerRef} label="歌曲列表分页" onPage={page => onBrowseChange({ ...browse, page })} />}
      </section>
    </div>
  </main>;
}
