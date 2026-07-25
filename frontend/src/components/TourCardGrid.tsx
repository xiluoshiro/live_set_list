import type { MutableRefObject } from "react";

import type { TourSummary } from "../api";
import { BandIconsCell } from "./BandIconsCell";
import { ContentState } from "./ContentState";

type TourCardGridProps = {
  tours: TourSummary[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  total: number;
  hasMore: boolean;
  sentinelRef: MutableRefObject<HTMLDivElement | null>;
  onOpenTour: (tour: TourSummary) => void;
};

function formatDateRange(tour: TourSummary): string {
  return tour.start_date === tour.end_date ? tour.start_date : `${tour.start_date} — ${tour.end_date}`;
}

export function TourCardGrid({
  tours,
  loading,
  loadingMore,
  error,
  total,
  hasMore,
  sentinelRef,
  onOpenTour,
}: TourCardGridProps) {
  return (
    <>
      <footer className="pager">
        <div className="toolbar"><span>总计 {total} 个巡演</span></div>
      </footer>
      {error && tours.length === 0 ? (
        <ContentState kind="error" title="巡演资料加载失败" description={error} layout="cards" />
      ) : tours.length === 0 ? (
        loading ? (
          <ContentState kind="loading" title="加载中..." description="正在整理巡演资料。" layout="cards" />
        ) : (
          <ContentState
            kind="empty"
            title={total === 0 ? "当前还没有已整理的巡演资料" : "没有符合当前条件的巡演"}
            description="可以调整筛选条件后再试。"
            layout="cards"
          />
        )
      ) : (
        <div className="live-card-grid">
          {tours.map((tour) => (
            <article className="live-card" key={tour.tour_id}>
              <button
                type="button"
                className="live-card-main"
                aria-label={`查看巡演《${tour.tour_title}》详情`}
                onClick={() => onOpenTour(tour)}
              >
                <span className="live-card-head">
                  <span className="live-card-date">{formatDateRange(tour)}</span>
                  <span className="live-card-count">已收录 {tour.collected_live_count} 场</span>
                </span>
                <span className="live-card-title">{tour.tour_title}</span>
              </button>
              <div className="live-card-footer">
                <BandIconsCell icons={tour.bands.map((band) => band.band_id)} rowId={tour.tour_id} />
                {tour.url ? (
                  <a
                    href={tour.url}
                    target="_blank"
                    rel="noreferrer"
                    className="live-card-url"
                    aria-label={`打开《${tour.tour_title}》的资料来源`}
                  >
                    🔗
                  </a>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}
      <div ref={sentinelRef} className="live-card-sentinel">
        {loadingMore ? "加载中..." : hasMore ? "" : tours.length > 0 ? `已加载全部 ${total} 个巡演` : ""}
      </div>
    </>
  );
}
