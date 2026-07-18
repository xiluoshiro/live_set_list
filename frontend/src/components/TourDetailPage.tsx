import { useEffect, useState } from "react";

import { getTourDetail, type TourDetailResponse, type TourStopItem } from "../api";
import { logError } from "../logger";
import { formatLiveType } from "./console/constants";

export type TourDetailFallback = { tourTitle: string };

type TourDetailPageProps = {
  tourId: number;
  fallback: TourDetailFallback;
  isAuthenticated: boolean;
  isFavorite: (liveId: number) => boolean;
  isSyncing: (liveId: number) => boolean;
  onToggleFavorite: (liveId: number) => void;
  onOpenLive: (stop: TourStopItem) => void;
  onBack: () => void;
};

function formatDateRange(detail: TourDetailResponse): string {
  return detail.start_date === detail.end_date ? detail.start_date : `${detail.start_date} — ${detail.end_date}`;
}

export function TourDetailPage({
  tourId,
  fallback,
  isAuthenticated,
  isFavorite,
  isSyncing,
  onToggleFavorite,
  onOpenLive,
  onBack,
}: TourDetailPageProps) {
  const [detail, setDetail] = useState<TourDetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;
    setLoading(true);
    setError(null);
    setDetail(null);
    getTourDetail(tourId)
      .then((data) => { if (!canceled) setDetail(data); })
      .catch((caught) => {
        if (canceled) return;
        const message = caught instanceof Error ? caught.message : "未知错误";
        logError("load_tour_detail_failed", { tourId, message });
        setError(message === "Request timeout" ? "请求超时，请稍后重试" : message);
      })
      .finally(() => { if (!canceled) setLoading(false); });
    return () => { canceled = true; };
  }, [tourId]);

  return (
    <div className="tour-detail-page">
      <div className="detail-page-head tour-detail-head">
        <h2>
          {detail?.url ? <a href={detail.url} target="_blank" rel="noreferrer" className="detail-title-link">{detail.tour_title}<span aria-hidden="true"> ↗</span></a> : detail?.tour_title ?? fallback.tourTitle}
        </h2>
        <button type="button" className="detail-back-btn" onClick={onBack} aria-label="返回"><span className="modal-action-glyph close">✕</span></button>
      </div>
      {loading && <p className="tour-detail-state">加载巡演详情...</p>}
      {error && <p className="tour-detail-state tour-list-error">巡演详情加载失败：{error}</p>}
      {detail && (
        <>
          <div className="tour-detail-summary">
            <span><strong>已收录日期：</strong>{formatDateRange(detail)}</span>
            <span><strong>场次：</strong>{detail.collected_live_count}</span>
            <span><strong>参与乐队：</strong>{detail.bands.map((band) => band.band_name).join(" / ") || "-"}</span>
          </div>
          <ol className="tour-stop-list">
            {detail.stops.map((stop) => (
              <li key={stop.live_id} className="tour-stop-card">
                <div className="tour-stop-date"><span>{stop.live_date}</span><span>{formatLiveType(stop.live_type)}</span></div>
                <button type="button" className="tour-stop-title" onClick={() => onOpenLive(stop)}>{stop.live_title}</button>
                <div className="tour-stop-meta">
                  <span>场地：{stop.venue ?? "-"}</span>
                  <span className={stop.has_setlist ? "has-setlist" : ""}>{stop.has_setlist ? "已有 Setlist" : "暂无 Setlist"}</span>
                </div>
                <div className="tour-stop-actions">
                  {isAuthenticated && (
                    <button
                      type="button"
                      className={`star-btn ${isFavorite(stop.live_id) || stop.is_favorite ? "is-fav" : ""} ${isSyncing(stop.live_id) ? "is-syncing" : ""}`}
                      aria-label={isFavorite(stop.live_id) || stop.is_favorite ? "取消收藏" : "加入收藏"}
                      onClick={() => onToggleFavorite(stop.live_id)}
                    >★</button>
                  )}
                  <button type="button" onClick={() => onOpenLive(stop)}>查看 Live</button>
                  {stop.url && <a href={stop.url} target="_blank" rel="noreferrer">来源 ↗</a>}
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
