import { useState } from "react";

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

const STATUS_LABELS: Record<TourStatisticsSongStatus, string> = {
  common: "全程保留",
  single: "仅一场",
  added: "中途加入",
  removed: "中途移除",
  intermittent: "间歇出现",
};

function getTransitionChangeCount(transition: TourTransition): number {
  return transition.replacements.length
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
};

function TourTransitionExplorer({ tourTitle, transitions, onOpenStop }: TourTransitionExplorerProps) {
  const [selectedIndex, setSelectedIndex] = useState(() => getDefaultTransitionIndex(transitions));
  const resolvedSelectedIndex = transitions[selectedIndex] ? selectedIndex : getDefaultTransitionIndex(transitions);
  const selectedTransition = transitions[resolvedSelectedIndex];
  if (!selectedTransition) return null;

  const firstTransition = transitions[0];
  const selectedChangeCount = getTransitionChangeCount(selectedTransition);
  const selectedFromTitle = getTourStopShortTitle(selectedTransition.from_live_title, tourTitle);
  const selectedToTitle = getTourStopShortTitle(selectedTransition.to_live_title, tourTitle);

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
            const isSelected = index === resolvedSelectedIndex;
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
                    onClick={() => setSelectedIndex(index)}
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
              <p>保留场次节点，不制造额外空白。</p>
            </div>
          </div>
        ) : (
          <>
            <div className="tour-transition-summary" aria-label="变化摘要">
              {selectedTransition.replacements.length > 0 && <span>更换 {selectedTransition.replacements.length}</span>}
              {selectedTransition.added_songs.length > 0 && <span>新增 {selectedTransition.added_songs.length}</span>}
              {selectedTransition.removed_songs.length > 0 && <span>移除 {selectedTransition.removed_songs.length}</span>}
              {selectedTransition.moved_songs.length > 0 && <span>顺序 {selectedTransition.moved_songs.length}</span>}
            </div>
            <ol className="tour-transition-stream">
              {selectedTransition.replacements.length > 0 && (
                <li className="tour-transition-event">
                  <span className="tour-transition-stream-marker" aria-hidden="true">⇄</span>
                  <section className="tour-transition-group">
                    <h4>同位置更换</h4>
                    <div className="tour-transition-diff-rows">{selectedTransition.replacements.map((item) => (
                      <div className="tour-transition-diff-pair" key={`${item.segment_type}:${item.sub_order}`}>
                        <div className="tour-transition-diff-row removed" aria-label={`移除 ${item.from_song.song_name}`}>
                          <span aria-hidden="true">－</span><span>{item.from_song.song_name}</span>
                        </div>
                        <div className="tour-transition-diff-row added" aria-label={`新增 ${item.to_song.song_name}`}>
                          <span aria-hidden="true">＋</span><span>{item.to_song.song_name}</span>
                        </div>
                      </div>
                    ))}</div>
                  </section>
                </li>
              )}
              {selectedTransition.added_songs.length > 0 && (
                <li className="tour-transition-event">
                  <span className="tour-transition-stream-marker" aria-hidden="true">＋</span>
                  <section className="tour-transition-group">
                    <h4>新增歌曲</h4>
                    <div className="tour-transition-diff-rows">{selectedTransition.added_songs.map((song) => (
                      <div className="tour-transition-diff-row added" aria-label={`新增 ${song.song_name}`} key={song.song_id}>
                        <span aria-hidden="true">＋</span><span>{song.song_name}</span>
                      </div>
                    ))}</div>
                  </section>
                </li>
              )}
              {selectedTransition.removed_songs.length > 0 && (
                <li className="tour-transition-event">
                  <span className="tour-transition-stream-marker" aria-hidden="true">－</span>
                  <section className="tour-transition-group">
                    <h4>移除歌曲</h4>
                    <div className="tour-transition-diff-rows">{selectedTransition.removed_songs.map((song) => (
                      <div className="tour-transition-diff-row removed" aria-label={`移除 ${song.song_name}`} key={song.song_id}>
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
          <TourTransitionExplorer key={`${data.tour_id}:${data.transitions.length}`} tourTitle={tourTitle} transitions={data.transitions} onOpenStop={onOpenStop} />
        )}
      </section>
    </div>
  );
}
