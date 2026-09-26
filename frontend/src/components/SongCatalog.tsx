import { useEffect, useRef, useState } from "react";
import {
  getAlbumDetail, getSongGroup, getSongGroups, getSongPerformances, getSongVersion,
  SONG_CATALOG_CHANGE, type AlbumDetail, type CatalogPage, type SongGroup,
  type SongGroupSummary, type SongPerformance, type SongVersion,
} from "../api";
import { PageTitle } from "./PageTitle";
import { albumTitle } from "../albumTitle";
import "./song-catalog.css";

export function ownershipLabel(song: Pick<SongVersion, "ownership">) {
  const owner = song.ownership;
  if (owner.mode === "pending") return "待回填";
  return [...owner.bands.map(b => b.band_name), ...owner.groups.map(g => `${g.band_name}：${g.members.map(m => m.display_name).join("、")}`)].join(" / ");
}

export function SongCatalog({ songId, onSongSelect, onLiveSelect, browse = { query: "", page: 1 }, onBrowseChange }: {
  browse?: { query: string; page: number };
  onBrowseChange?: (browse: { query: string; page: number }) => void;
  songId: number | null;
  onSongSelect: (songId: number) => void;
  onLiveSelect: (live: SongPerformance) => void;
}) {
  const [query, setQuery] = useState(browse.query);
  const [page, setPage] = useState(browse.page);
  const [list, setList] = useState<CatalogPage<SongGroupSummary> | null>(null);
  const [group, setGroup] = useState<SongGroup | null>(null);
  const [song, setSong] = useState<SongVersion | null>(null);
  const [performances, setPerformances] = useState<CatalogPage<SongPerformance> | null>(null);
  const [performancePage, setPerformancePage] = useState(1);
  const [album, setAlbum] = useState<AlbumDetail | null>(null);
  const [error, setError] = useState("");
  const selectionGeneration = useRef(0);
  const albumGeneration = useRef(0);
  const [revision, setRevision] = useState(0);
  useEffect(() => { setQuery(browse.query); setPage(browse.page); }, [browse.query, browse.page]);
  useEffect(() => { onBrowseChange?.({ query, page }); }, [query, page]);
  useEffect(() => {
    const refresh = () => setRevision(value => value + 1);
    window.addEventListener(SONG_CATALOG_CHANGE, refresh);
    return () => window.removeEventListener(SONG_CATALOG_CHANGE, refresh);
  }, []);
  useEffect(() => {
    let current = true;
    setError("");
    void getSongGroups(query, page).then(result => { if (current) setList(result); })
      .catch(reason => { if (current) setError(String(reason)); });
    return () => { current = false; };
  }, [query, page, revision]);
  useEffect(() => {
    let current = true;
    selectionGeneration.current += 1;
    albumGeneration.current += 1;
    setSong(null); setGroup(null); setAlbum(null); setPerformancePage(1); setError("");
    if (songId !== null) void getSongVersion(songId).then(async version => {
      const detail = await getSongGroup(version.group_id);
      if (current) { setSong(version); setGroup(detail); }
    }).catch(reason => { if (current) setError(String(reason)); });
    return () => { current = false; };
  }, [songId, revision]);
  useEffect(() => {
    let current = true;
    setPerformances(null);
    if (song) void getSongPerformances(song.song_id, performancePage)
      .then(result => { if (current) setPerformances(result); })
      .catch(reason => { if (current) setError(String(reason)); });
    return () => { current = false; };
  }, [song, performancePage]);
  const selectGroup = async (groupId: number, matchedId?: number) => {
    const generation = ++selectionGeneration.current;
    try {
      const detail = await getSongGroup(groupId);
      if (generation === selectionGeneration.current && detail.versions.length) onSongSelect(matchedId ?? (detail.versions.find(v => !v.version_label) ?? detail.versions[0]).song_id);
    } catch (reason) { if (generation === selectionGeneration.current) setError(String(reason)); }
  };
  return <section className="catalog-panel song-catalog">
    <PageTitle kicker="SONGS" title="歌曲资料" />
    {error && <p role="alert">{error}</p>}
    <div className="song-catalog-layout">
      <aside className="song-catalog-list" aria-label="歌曲组列表">
        <div className="catalog-search-row"><input aria-label="搜索歌曲" placeholder="搜索歌曲" value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} /></div>
        <ul>{list?.items.map(item => <li key={item.group_id}>
          <button type="button" aria-current={group?.group_id === item.group_id ? "true" : undefined} onClick={() => void selectGroup(item.group_id, item.matched_song_ids?.[0])}>
            {item.group_name}
          </button>
        </li>)}</ul>
        {list && list.items.length === 0 && <p>暂无歌曲</p>}
        {list && <div className="song-catalog-pagination">
          <button className="console-ghost-btn" disabled={list.page <= 1} onClick={() => setPage(list.page - 1)}>上一页</button>
          <span>{list.page} / {list.total_pages}</span>
          <button className="console-ghost-btn" disabled={list.page >= list.total_pages} onClick={() => setPage(list.page + 1)}>下一页</button>
        </div>}
      </aside>
      <article className="song-catalog-detail" aria-label="歌曲详情">
        {!song ? <p>{songId ? "加载中…" : "选择歌曲查看详情"}</p> : <>
          <h2>{song.group_name}</h2>
          <div className="song-catalog-versions" role="group" aria-label="歌曲版本">
            {group?.versions.map(version => <button className="section-tab-btn" key={version.song_id} type="button" aria-pressed={version.song_id === song.song_id}
              onClick={() => onSongSelect(version.song_id)}>{version.version_label || version.song_name}</button>)}
          </div>
          <dl className="song-catalog-facts">
            <dt>歌曲</dt><dd>{song.song_name}</dd>
            <dt>归属</dt><dd>{ownershipLabel(song)}</dd>
            <dt>歌曲组演奏次数</dt><dd>{song.performance_count}</dd>
          </dl>
          <h3>收录专辑</h3>
          <div className="song-catalog-albums">{song.albums.length === 0 ? <p>暂无收录记录</p> : song.albums.map(item =>
            <button key={item.album_id} className="song-catalog-album" onClick={() => {
              const generation = ++albumGeneration.current;
              setAlbum(null);
              void getAlbumDetail(item.album_id).then(detail => { if (generation === albumGeneration.current) setAlbum(detail); })
                .catch(reason => { if (generation === albumGeneration.current) setError(String(reason)); });
            }}>
              {item.cover_path && <img src={item.cover_path} alt="" loading="lazy" />}
              <span>{albumTitle(item)}<small>{item.release_date ?? "日期未知"}</small></span>
            </button>)}</div>
          {album && <section aria-label="专辑详情">
            <h4>{albumTitle(album)}</h4><button onClick={() => { albumGeneration.current += 1; setAlbum(null); }}>收起</button>
            {[...new Set(album.tracks.map(t => t.section_name ?? ""))].map(section => <div key={section}>{section && <h5>{section}</h5>}<ol className="song-album-tracks">{album.tracks.filter(t => (t.section_name ?? "") === section).map(track => <li key={track.album_track_id} value={track.track_order}>
              <button onClick={() => onSongSelect(track.song_id)}>{track.song_name}{track.version_label ? ` · ${track.version_label}` : ""}{track.edition_label ? ` · ${track.edition_label}` : ""}</button>
            </li>)}</ol></div>)}
          </section>}
          <h3>关联歌单</h3>
          <div className="console-table-wrap"><table className="console-admin-table"><thead><tr><th>日期</th><th>演出 / 曲目</th><th>标记</th></tr></thead>
            <tbody>{performances?.items.map(item => <tr key={item.setlist_id}>
              <td>{item.live_date}</td><td><button className="song-catalog-link" onClick={() => onLiveSelect(item)}>{item.live_title} / {item.segment_type}{item.sub_order}</button></td>
              <td>{[item.is_short ? "短版" : "", item.live_cover === "cover" ? "翻唱" : ""].filter(Boolean).join(" · ")}</td>
            </tr>)}</tbody></table></div>
          {performances?.total === 0 && <p>暂无演奏记录</p>}
          {performances && performances.total_pages > 1 && <div className="song-catalog-pagination">
            <button className="console-ghost-btn" disabled={performances.page <= 1} onClick={() => setPerformancePage(performances.page - 1)}>上一页</button>
            <span>{performances.page} / {performances.total_pages}</span>
            <button className="console-ghost-btn" disabled={performances.page >= performances.total_pages} onClick={() => setPerformancePage(performances.page + 1)}>下一页</button>
          </div>}
        </>}
      </article>
    </div>
  </section>;
}
