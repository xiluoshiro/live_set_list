import type { TourStatisticsResponse, TourStatisticsSongStatus } from "../api";
import { getTourStopShortTitle } from "./tourHelpers";

type TourStatisticsPanelProps = {
  tourTitle: string;
  data: TourStatisticsResponse | null;
  loading: boolean;
  error: string | null;
  onOpenStop: (liveId: number) => void;
};

type TourTransition = TourStatisticsResponse["transitions"][number];
type TourChangeRow = { key: string; type: string; before: string; after: string };

const STATUS_LABELS: Record<TourStatisticsSongStatus, string> = {
  common: "全程保留",
  single: "仅一场",
  added: "中途加入",
  removed: "中途移除",
  intermittent: "间歇出现",
};

function getTransitionChangeRows(transition: TourTransition): TourChangeRow[] {
  return [
    ...transition.moved_songs.map((song) => ({
      key: `moved:${song.song_id}`,
      type: "顺序变化",
      before: `${song.song_name}（第 ${song.from_order} 首）`,
      after: `${song.song_name}（第 ${song.to_order} 首）`,
    })),
    ...transition.replacements.map((item) => ({
      key: `replacement:${item.segment_type}:${item.sub_order}`,
      type: "更换",
      before: item.from_song.song_name,
      after: item.to_song.song_name,
    })),
    ...transition.added_songs.map((song) => ({ key: `added:${song.song_id}`, type: "新增", before: "-", after: song.song_name })),
    ...transition.removed_songs.map((song) => ({ key: `removed:${song.song_id}`, type: "移除", before: song.song_name, after: "-" })),
  ];
}

export function TourStatisticsPanel({ tourTitle, data, loading, error, onOpenStop }: TourStatisticsPanelProps) {
  if (loading) return <p className="statistics-state">统计中...</p>;
  if (error) return <p className="statistics-state error">巡演统计加载失败：{error}</p>;
  if (!data) return null;

  return (
    <div className="tour-statistics">
      <div className="statistics-overview">
        <article><strong>{data.coverage.stop_count}</strong><span>收录场次</span></article>
        <article><strong>{data.coverage.setlist_stop_count}</strong><span>Setlist 场次</span></article>
        <article><strong>{data.overview.distinct_song_count}</strong><span>演唱歌曲</span></article>
        <article><strong>{data.overview.common_song_count}</strong><span>全程保留</span></article>
      </div>

      <section className="statistics-card">
        <h2>歌曲覆盖</h2>
        {data.songs.length === 0 ? <p className="statistics-state">当前巡演还没有 Setlist 数据。</p> : (
          <div className="console-table-wrap">
            <table className="console-table tour-statistics-table">
              <thead><tr><th>歌曲</th><th>场次</th><th>状态</th></tr></thead>
              <tbody>{data.songs.map((song) => (
                <tr key={song.song_id}><td>{song.song_name}</td><td>{song.appearance_count} / {data.coverage.setlist_stop_count}</td><td>{STATUS_LABELS[song.status]}</td></tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>

      <section className="statistics-card">
        <h2>场次变化</h2>
        {data.coverage.comparable_transition_count === 0 ? (
          <p className="statistics-state">没有可比较的相邻 Setlist 场次。</p>
        ) : (
          <div className="console-table-wrap">
            <table className="console-table tour-transition-table" aria-label="场次变化">
              <thead><tr><th>对比场次</th><th>类型</th><th>原内容</th><th>新内容</th></tr></thead>
              <tbody>{data.transitions.flatMap((transition) => {
                const fromTitle = getTourStopShortTitle(transition.from_live_title, tourTitle);
                const toTitle = getTourStopShortTitle(transition.to_live_title, tourTitle);
                const changes = getTransitionChangeRows(transition);
                const rows = changes.length > 0 ? changes : [{ key: "unchanged", type: "无变化", before: "-", after: "-" }];
                return rows.map((change, index) => (
                  <tr key={`${transition.from_live_id}:${transition.to_live_id}:${change.key}`}>
                    {index === 0 && (
                      <th scope="rowgroup" rowSpan={rows.length}>
                        <button type="button" className="detail-tour-link tour-transition-stop" onClick={() => onOpenStop(transition.from_live_id)}>{fromTitle}</button>
                        <span className="tour-transition-arrow" aria-hidden="true">↓</span>
                        <button type="button" className="detail-tour-link tour-transition-stop" onClick={() => onOpenStop(transition.to_live_id)}>{toTitle}</button>
                      </th>
                    )}
                    <td>{change.type}</td>
                    <td>{change.before}</td>
                    <td>{change.after}</td>
                  </tr>
                ));
              })}</tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
