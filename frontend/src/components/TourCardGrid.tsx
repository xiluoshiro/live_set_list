import type { TourSummary } from "../api";
import { BandIconsCell } from "./BandIconsCell";

type TourCardGridProps = {
  tours: TourSummary[];
  loading: boolean;
  error: string | null;
  total: number;
  page: number;
  totalPages: number;
  onOpenTour: (tour: TourSummary) => void;
  onPageChange: (page: number) => void;
};

function formatDateRange(tour: TourSummary): string {
  return tour.start_date === tour.end_date ? tour.start_date : `${tour.start_date} — ${tour.end_date}`;
}

export function TourCardGrid({
  tours,
  loading,
  error,
  total,
  page,
  totalPages,
  onOpenTour,
  onPageChange,
}: TourCardGridProps) {
  return (
    <>
      <footer className="pager">
        <div className="toolbar"><span>总计 {total} 个巡演</span></div>
        <div className="pager-controls">
          <button type="button" disabled={loading || page <= 1} onClick={() => onPageChange(Math.max(1, page - 1))}>上一页</button>
          <span className="pager-status">第 {page} / {totalPages} 页</span>
          <button type="button" disabled={loading || page >= totalPages} onClick={() => onPageChange(Math.min(totalPages, page + 1))}>下一页</button>
        </div>
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
    </>
  );
}
