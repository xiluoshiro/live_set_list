import type { MutableRefObject } from "react";

import type { TourSummary } from "../api";
import { BandIconsCell } from "./BandIconsCell";

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
        <p className="live-card-state live-card-state-error">巡演资料加载失败：{error}</p>
      ) : tours.length === 0 ? (
        <p className="live-card-state">{loading ? "加载中..." : total === 0 ? "当前还没有已整理的巡演资料" : "没有符合当前条件的巡演"}</p>
      ) : (
        <div className="live-card-grid">
          {tours.map((tour) => (
            <article className="live-card" key={tour.tour_id} onClick={() => onOpenTour(tour)}>
              <div className="live-card-head">
                <span className="live-card-date">{formatDateRange(tour)}</span>
                <span className="live-card-type">已收录 {tour.collected_live_count} 场</span>
              </div>
              <span className="live-card-title">{tour.tour_title}</span>
              <div className="live-card-footer">
                <BandIconsCell icons={tour.bands.map((band) => band.band_id)} rowId={tour.tour_id} />
                {tour.url ? (
                  <a
                    href={tour.url}
                    target="_blank"
                    rel="noreferrer"
                    className="live-card-url"
                    onClick={(event) => event.stopPropagation()}
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
