import type {
  CatalogBandItem,
  CatalogStatisticsFilters,
  CatalogStatisticsResponse,
  StatisticsScope,
} from "../api";
import { PageTitle } from "./PageTitle";
import { formatLiveType, LIVE_TYPE_OPTIONS } from "./console/constants";

type StatisticsPanelProps = {
  scope: StatisticsScope;
  filters: CatalogStatisticsFilters;
  data: CatalogStatisticsResponse | null;
  bands: CatalogBandItem[];
  years: number[];
  loading: boolean;
  error: string | null;
  isAuthenticated: boolean;
  onScopeChange: (scope: StatisticsScope) => void;
  onFiltersChange: (filters: CatalogStatisticsFilters) => void;
  onOpenLive: (live: { liveId: number; liveDate: string; liveTitle: string }) => void;
};

export function StatisticsPanel(props: StatisticsPanelProps) {
  const { data, filters } = props;
  const maxYearCount = Math.max(1, ...(data?.years.map((item) => item.live_count) ?? [1]));
  return (
    <section className="statistics-panel">
      <PageTitle kicker="Archive insights" title="数据统计" description="从资料库收录记录观察 Live 与歌曲演出轨迹。" />
      <div className="statistics-controls" aria-label="统计条件">
        <div className="statistics-scope" aria-label="统计范围">
          <button className={props.scope === "all" ? "active" : ""} onClick={() => props.onScopeChange("all")}>全部 Live</button>
          <button className={props.scope === "favorites" ? "active" : ""} onClick={() => props.onScopeChange("favorites")}>收藏 Live</button>
        </div>
        <label>年份<select value={filters.year ?? ""} onChange={(event) => props.onFiltersChange({ ...filters, year: event.target.value ? Number(event.target.value) : undefined })}>
          <option value="">全部年份</option>{props.years.map((year) => <option key={year} value={year}>{year}</option>)}
        </select></label>
        <label>乐队<select value={filters.bandId ?? ""} onChange={(event) => props.onFiltersChange({ ...filters, bandId: event.target.value ? Number(event.target.value) : undefined })}>
          <option value="">全部乐队</option>{props.bands.map((band) => <option key={band.band_id} value={band.band_id}>{band.band_name}</option>)}
        </select></label>
        <label>Live 类型<select value={filters.liveType ?? ""} onChange={(event) => props.onFiltersChange({ ...filters, liveType: event.target.value || undefined })}>
          <option value="">全部类型</option>{LIVE_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select></label>
        <button className="secondary-btn" onClick={() => props.onFiltersChange({})}>重置</button>
      </div>

      {props.scope === "favorites" && !props.isAuthenticated ? <p className="statistics-state">登录后可查看收藏 Live 的统计。</p> : null}
      {props.loading ? <p className="statistics-state">统计中...</p> : null}
      {props.error ? <p className="statistics-state error">{props.error}</p> : null}
      {!props.loading && !props.error && data ? <>
        <div className="statistics-overview">
          <article><strong>{data.overview.live_count}</strong><span>Live</span></article>
          <article><strong>{data.overview.song_count}</strong><span>演唱歌曲</span></article>
          <article><strong>{data.overview.band_count}</strong><span>参与乐队</span></article>
          <article><strong>{data.overview.venue_count}</strong><span>场地</span></article>
        </div>
        <div className="statistics-grid">
          <section className="statistics-card">
            <h2>年份分布</h2>
            <div className="statistics-bars">{data.years.map((item) => <div className="statistics-bar-row" key={item.key}>
              <span>{item.label}</span><i style={{ width: `${Math.max(4, item.live_count / maxYearCount * 100)}%` }} /><strong>{item.live_count}</strong>
            </div>)}</div>
          </section>
          <section className="statistics-card">
            <h2>Live 类型</h2>
            <ul className="statistics-dimension-list">{data.live_types.map((item) => <li key={item.key}><span>{formatLiveType(item.key)}</span><strong>{item.live_count}</strong></li>)}</ul>
          </section>
        </div>
        <section className="statistics-card">
          <h2>{filters.year ? `${filters.year} 年高频歌曲` : "高频歌曲"}</h2>
          {data.top_songs.length === 0 ? <p className="statistics-state">当前条件下没有 Setlist 数据。</p> : <ol className="statistics-song-list">{data.top_songs.map((song) => <li key={`${song.band_id}:${song.song_id}`}>
            <div><strong>{song.song_name}</strong><span>{song.band_name ?? "未知乐队"}{song.is_cover ? " · 翻唱" : ""}</span></div>
            <b>{song.live_count} 场</b>
            <button onClick={() => props.onOpenLive({ liveId: song.latest_live_id, liveDate: song.latest_live_date, liveTitle: song.latest_live_title })}>最近：{song.latest_live_date}</button>
          </li>)}</ol>}
        </section>
        <section className="statistics-card">
          <h2>久未演唱</h2>
          {filters.bandId === undefined ? <p className="statistics-state">选择乐队后，可查看曾多次演唱、但已缺席后续 Live 的歌曲。</p> : data.stale_songs.length === 0 ? <p className="statistics-state">当前条件下没有符合条件的久未演唱歌曲。</p> : <ol className="statistics-song-list stale">{data.stale_songs.map((song) => <li key={song.song_id}>
            <div><strong>{song.song_name}</strong><span>上次演唱后又收录 {song.missed_live_count} 场该乐队 Live</span></div>
            <b>{song.stale_days} 天</b>
            <button onClick={() => props.onOpenLive({ liveId: song.latest_live_id, liveDate: song.latest_live_date, liveTitle: song.latest_live_title })}>上次：{song.latest_live_date}</button>
          </li>)}</ol>}
        </section>
      </> : null}
    </section>
  );
}
