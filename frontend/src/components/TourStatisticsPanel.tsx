import { useEffect, useMemo, useState } from "react";

import { getTourStatisticsComparison, type TourStatisticsResponse, type TourStatisticsSongStatus, type TourStatisticsTransition, type TourStopItem } from "../api";
import { ContentState } from "./ContentState";
import { getTourStopShortTitle } from "./tourHelpers";

type TourStatisticsPanelProps = {
  tourTitle: string;
  data: TourStatisticsResponse | null;
  loading: boolean;
  error: string | null;
  onOpenStop: (liveId: number) => void;
  stops?: TourStopItem[];
};

type TourTransition = TourStatisticsResponse["transitions"][number];

const STATUS_LABELS: Record<TourStatisticsSongStatus, string> = {
  common: "全程保留",
  single: "仅一场",
  added: "中途加入",
  removed: "中途移除",
  intermittent: "间歇出现",
};

function getTransitionChangeCount(transition: TourTransition): number {
  return transition.replacements.length * 2
    + transition.added_songs.length
    + transition.removed_songs.length
    + transition.moved_songs.length;
}

function getDefaultTransitionIndex(transitions: TourTransition[]): number {
  let selectedIndex = 0;
  transitions.forEach((transition, index) => {
    if (getTransitionChangeCount(transition) > 0) selectedIndex = index;
  });
  return selectedIndex;
}

type TourTransitionExplorerProps = {
  tourTitle: string;
  transitions: TourTransition[];
  onOpenStop: (liveId: number) => void;
  detailTransition?: TourTransition | null;
  onSelectTransition?: () => void;
};

function TourTransitionExplorer({
  tourTitle,
  transitions,
  onOpenStop,
  detailTransition = null,
  onSelectTransition,
}: TourTransitionExplorerProps) {
  const [selectedIndex, setSelectedIndex] = useState(() => getDefaultTransitionIndex(transitions));
  const resolvedSelectedIndex = transitions[selectedIndex] ? selectedIndex : getDefaultTransitionIndex(transitions);
  const selectedTransition = detailTransition ?? transitions[resolvedSelectedIndex];
  if (!selectedTransition) return null;

  const firstTransition = transitions[0];
  const selectedChangeCount = getTransitionChangeCount(selectedTransition);
  const selectedFromTitle = getTourStopShortTitle(selectedTransition.from_live_title, tourTitle);
  const selectedToTitle = getTourStopShortTitle(selectedTransition.to_live_title, tourTitle);
  const displayedAddedSongs = [
    ...selectedTransition.replacements.map((replacement, index) => ({
      key: `replacement:${index}:${replacement.to_song.song_id}`,
      song: replacement.to_song,
    })),
    ...selectedTransition.added_songs.map((song, index) => ({ key: `added:${index}:${song.song_id}`, song })),
  ];
  const displayedRemovedSongs = [
    ...selectedTransition.replacements.map((replacement, index) => ({
      key: `replacement:${index}:${replacement.from_song.song_id}`,
      song: replacement.from_song,
    })),
    ...selectedTransition.removed_songs.map((song, index) => ({ key: `removed:${index}:${song.song_id}`, song })),
  ];

  return (
    <div className="tour-transition-explorer">
      <nav className="tour-transition-progress" aria-label="场次进程">
        <div className="tour-transition-section-head">
          <h3>场次进程</h3>
          <span>选择相邻场次</span>
        </div>
        <ol className="tour-transition-timeline">
          <li className="tour-transition-timeline-stop">
            <span className="tour-transition-dot" aria-hidden="true" />
            <div className="tour-transition-stop-copy">
              <span className="tour-transition-date">{firstTransition.from_live_date}</span>
              <button type="button" className="detail-tour-link tour-transition-stop-link" onClick={() => onOpenStop(firstTransition.from_live_id)}>
                {getTourStopShortTitle(firstTransition.from_live_title, tourTitle)}
              </button>
            </div>
          </li>
          {transitions.map((transition, index) => {
            const changeCount = getTransitionChangeCount(transition);
            const isSelected = detailTransition === null && index === resolvedSelectedIndex;
            return (
              <li className={`tour-transition-timeline-stop${isSelected ? " selected" : ""}`} key={`${transition.from_live_id}:${transition.to_live_id}`}>
                <span className="tour-transition-dot" aria-hidden="true" />
                <div className="tour-transition-stop-copy">
                  <span className="tour-transition-date">{transition.to_live_date}</span>
                  <button type="button" className="detail-tour-link tour-transition-stop-link" onClick={() => onOpenStop(transition.to_live_id)}>
                    {getTourStopShortTitle(transition.to_live_title, tourTitle)}
                  </button>
                  <button
                    type="button"
                    className="tour-transition-selector"
                    aria-pressed={isSelected}
                    onClick={() => {
                      setSelectedIndex(index);
                      onSelectTransition?.();
                    }}
                  >
                    <span><span aria-hidden="true">⇄</span> 对比上一场</span>
                    <strong>{changeCount === 0 ? "无变化" : `${changeCount} 项变化`}</strong>
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      </nav>

      <section className="tour-transition-detail" aria-label="歌单变化" aria-live="polite">
        <header className="tour-transition-detail-head">
          <div>
            <h3>
              <button type="button" className="detail-tour-link" onClick={() => onOpenStop(selectedTransition.from_live_id)}>{selectedFromTitle}</button>
              <span className="tour-transition-route-arrow" aria-hidden="true">→</span>
              <button type="button" className="detail-tour-link" onClick={() => onOpenStop(selectedTransition.to_live_id)}>{selectedToTitle}</button>
            </h3>
            <p>{selectedTransition.from_live_date} → {selectedTransition.to_live_date}</p>
          </div>
          <span className={`tour-transition-total${selectedChangeCount > 0 ? " changed" : ""}`}>
            {selectedChangeCount === 0 ? "歌单一致" : `${selectedChangeCount} 项变化`}
          </span>
        </header>

        {selectedChangeCount === 0 ? (
          <div className="tour-transition-unchanged">
            <span className="tour-transition-stream-marker" aria-hidden="true">✓</span>
            <div>
              <strong>歌单未发生变化</strong>
            </div>
          </div>
        ) : (
          <>
            <div className="tour-transition-summary" aria-label="变化摘要">
              {displayedAddedSongs.length > 0 && <span>新增 {displayedAddedSongs.length}</span>}
              {displayedRemovedSongs.length > 0 && <span>移除 {displayedRemovedSongs.length}</span>}
              {selectedTransition.moved_songs.length > 0 && <span>顺序 {selectedTransition.moved_songs.length}</span>}
            </div>
            <ol className="tour-transition-stream">
              {displayedAddedSongs.length > 0 && (
                <li className="tour-transition-event">
                  <span className="tour-transition-stream-marker" aria-hidden="true">＋</span>
                  <section className="tour-transition-group">
                    <h4>新增歌曲</h4>
                    <div className="tour-transition-diff-rows">{displayedAddedSongs.map(({ key, song }) => (
                      <div className="tour-transition-diff-row added" aria-label={`新增 ${song.song_name}`} key={key}>
                        <span aria-hidden="true">＋</span><span>{song.song_name}</span>
                      </div>
                    ))}</div>
                  </section>
                </li>
              )}
              {displayedRemovedSongs.length > 0 && (
                <li className="tour-transition-event">
                  <span className="tour-transition-stream-marker" aria-hidden="true">－</span>
                  <section className="tour-transition-group">
                    <h4>移除歌曲</h4>
                    <div className="tour-transition-diff-rows">{displayedRemovedSongs.map(({ key, song }) => (
                      <div className="tour-transition-diff-row removed" aria-label={`移除 ${song.song_name}`} key={key}>
                        <span aria-hidden="true">－</span><span>{song.song_name}</span>
                      </div>
                    ))}</div>
                  </section>
                </li>
              )}
              {selectedTransition.moved_songs.length > 0 && (
                <li className="tour-transition-event">
                  <span className="tour-transition-stream-marker" aria-hidden="true">↕</span>
                  <section className="tour-transition-group">
                    <h4>顺序变化</h4>
                    <div className="tour-transition-diff-rows">{selectedTransition.moved_songs.map((song) => (
                      <div
                        className="tour-transition-diff-row moved"
                        aria-label={`顺序变化 ${song.song_name} 第 ${song.from_order} 首到第 ${song.to_order} 首`}
                        key={song.song_id}
                      >
                        <span aria-hidden="true">↕</span><span>{song.song_name}</span><span className="tour-transition-order">第 {song.from_order} 首 → 第 {song.to_order} 首</span>
                      </div>
                    ))}</div>
                  </section>
                </li>
              )}
            </ol>
          </>
        )}
      </section>
    </div>
  );
}

export function TourStatisticsPanel({ tourTitle, data, loading, error, onOpenStop, stops = [] }: TourStatisticsPanelProps) {
  const comparableStops = useMemo(
    () => stops.filter((stop) => stop.has_setlist && stop.event_status !== "cancelled"),
    [stops],
  );
  const comparableStopKey = comparableStops.map((stop) => stop.live_id).join(":");
  const [fromLiveId, setFromLiveId] = useState<number | null>(comparableStops[0]?.live_id ?? null);
  const [toLiveId, setToLiveId] = useState<number | null>(comparableStops[comparableStops.length - 1]?.live_id ?? null);
  const [customTransition, setCustomTransition] = useState<TourStatisticsTransition | null>(null);
  const [customLoading, setCustomLoading] = useState(false);
  const [customError, setCustomError] = useState<string | null>(null);

  useEffect(() => {
    setFromLiveId(comparableStops[0]?.live_id ?? null);
    setToLiveId(comparableStops[comparableStops.length - 1]?.live_id ?? null);
    setCustomTransition(null);
    setCustomError(null);
  }, [comparableStopKey, comparableStops]);

  if (loading) {
    return <ContentState kind="loading" title="统计中..." description="正在汇总巡演场次。" layout="statistics" />;
  }
  if (error) {
    return <ContentState kind="error" title="巡演统计加载失败" description={error} layout="statistics" />;
  }
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
        {data.songs.length === 0 ? (
          <ContentState kind="empty" title="当前巡演还没有 Setlist 数据" compact />
        ) : (
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
        {comparableStops.length >= 3 && (
          <div className="tour-custom-comparison">
            <label className="list-filter-field">起始场<select value={fromLiveId ?? ""} onChange={(event) => { setFromLiveId(Number(event.target.value)); setCustomTransition(null); setCustomError(null); }}>{comparableStops.map((stop) => <option key={stop.live_id} value={stop.live_id}>{stop.live_date} · {getTourStopShortTitle(stop.live_title, tourTitle)}</option>)}</select></label>
            <label className="list-filter-field">目标场<select value={toLiveId ?? ""} onChange={(event) => { setToLiveId(Number(event.target.value)); setCustomTransition(null); setCustomError(null); }}>{comparableStops.map((stop) => <option key={stop.live_id} value={stop.live_id}>{stop.live_date} · {getTourStopShortTitle(stop.live_title, tourTitle)}</option>)}</select></label>
            <button type="button" className="console-submit-btn" disabled={customLoading || !fromLiveId || !toLiveId || fromLiveId === toLiveId} onClick={() => {
              if (!fromLiveId || !toLiveId) return;
              setCustomLoading(true); setCustomError(null); setCustomTransition(null);
              getTourStatisticsComparison(data.tour_id, fromLiveId, toLiveId).then(setCustomTransition).catch((caught) => setCustomError(caught instanceof Error ? caught.message : "加载失败")).finally(() => setCustomLoading(false));
            }}>{customLoading ? "比较中..." : "比较"}</button>
          </div>
        )}
        {customError && <p className="statistics-state error">任意场次比较加载失败：{customError}</p>}
        {data.coverage.comparable_transition_count === 0 ? (
          <ContentState kind="empty" title="没有可比较的相邻 Setlist 场次" compact />
        ) : (
          <TourTransitionExplorer
            key={`${data.tour_id}:${data.transitions.length}`}
            tourTitle={tourTitle}
            transitions={data.transitions}
            detailTransition={customTransition}
            onSelectTransition={() => setCustomTransition(null)}
            onOpenStop={onOpenStop}
          />
        )}
      </section>
    </div>
  );
}
