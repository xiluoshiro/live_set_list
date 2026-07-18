import type { TourSummary } from "../api";

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
  if (error && tours.length === 0) {
    return <p className="tour-list-state tour-list-error">巡演资料加载失败：{error}</p>;
  }
  if (tours.length === 0) {
    return <p className="tour-list-state">{loading ? "加载中..." : total === 0 ? "当前还没有已整理的巡演资料" : "没有符合当前条件的巡演"}</p>;
  }

  return (
    <>
      <div className="tour-card-grid">
        {tours.map((tour) => (
          <article className="tour-card" key={tour.tour_id}>
            <div className="tour-card-head">
              <span className="tour-card-date">{formatDateRange(tour)}</span>
              <span className="tour-card-count">已收录 {tour.collected_live_count} 场</span>
            </div>
            <button type="button" className="tour-card-title" onClick={() => onOpenTour(tour)}>
              {tour.tour_title}
            </button>
            <div className="tour-band-list" aria-label="参与乐队">
              {tour.bands.length > 0
                ? tour.bands.map((band) => <span key={band.band_id}>{band.band_name}</span>)
                : <span>暂无乐队资料</span>}
            </div>
            <div className="tour-card-actions">
              <button type="button" onClick={() => onOpenTour(tour)}>查看巡演</button>
              {tour.url && <a href={tour.url} target="_blank" rel="noreferrer">来源 ↗</a>}
            </div>
          </article>
        ))}
      </div>
      <footer className="tour-list-footer">
        <span>总计 {total} 个巡演</span>
        <div className="tour-list-pager">
          <button type="button" disabled={loading || page <= 1} onClick={() => onPageChange(Math.max(1, page - 1))}>上一页</button>
          <span>第 {page} / {totalPages} 页</span>
          <button type="button" disabled={loading || page >= totalPages} onClick={() => onPageChange(Math.min(totalPages, page + 1))}>下一页</button>
        </div>
      </footer>
    </>
  );
}
