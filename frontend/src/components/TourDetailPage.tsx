import { useEffect, useState } from "react";

import {
  getLiveDetail,
  getTourDetail,
  getTourStatistics,
  type LiveDetailResponse,
  type TourDetailResponse,
  type TourStatisticsResponse,
} from "../api";
import { logError } from "../logger";
import { formatLiveStatusText } from "../liveStatus";
import { ContentState } from "./ContentState";
import { DetailTitleLink } from "./DetailTitleLink";
import { LiveDetailContent } from "./LiveDetailContent";
import { SectionTabs } from "./SectionTabs";
import { getTourStopShortTitle } from "./tourHelpers";
import { TourStatisticsPanel } from "./TourStatisticsPanel";

export type TourDetailFallback = { tourTitle: string };
type TourDetailTab = "stops" | "statistics";

type TourDetailPageProps = {
  tourId: number;
  fallback: TourDetailFallback;
  onBack: () => void;
  canFavorite?: boolean;
  isFavorite?: (liveId: number) => boolean;
  isSyncing?: (liveId: number) => boolean;
  onToggleFavorite?: (liveId: number) => void;
};

function formatDateRange(detail: TourDetailResponse): string {
  return detail.start_date === detail.end_date ? detail.start_date : `${detail.start_date} — ${detail.end_date}`;
}

function normalizeError(caught: unknown): string {
  const message = caught instanceof Error ? caught.message : "未知错误";
  return message === "Request timeout" ? "请求超时，请稍后重试" : message;
}

export function TourDetailPage({
  tourId,
  fallback,
  onBack,
  canFavorite = false,
  isFavorite = () => false,
  isSyncing = () => false,
  onToggleFavorite,
}: TourDetailPageProps) {
  const [detail, setDetail] = useState<TourDetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TourDetailTab>("stops");
  const [selectedLiveId, setSelectedLiveId] = useState<number | null>(null);
  const [liveDetail, setLiveDetail] = useState<LiveDetailResponse | null>(null);
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [statistics, setStatistics] = useState<TourStatisticsResponse | null>(null);
  const [statisticsLoading, setStatisticsLoading] = useState(false);
  const [statisticsError, setStatisticsError] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;
    setLoading(true);
    setError(null);
    setDetail(null);
    setActiveTab("stops");
    setSelectedLiveId(null);
    setStatistics(null);
    setStatisticsError(null);
    getTourDetail(tourId)
      .then((data) => {
        if (canceled) return;
        setDetail(data);
        setSelectedLiveId(
          data.stops.find((stop) => stop.event_status !== "cancelled" || stop.has_setlist)?.live_id ?? null,
        );
      })
      .catch((caught) => {
        if (canceled) return;
        const message = normalizeError(caught);
        logError("load_tour_detail_failed", { tourId, message });
        setError(message);
      })
      .finally(() => { if (!canceled) setLoading(false); });
    return () => { canceled = true; };
  }, [tourId]);

  useEffect(() => {
    if (selectedLiveId === null) return;
    let canceled = false;
    setLiveLoading(true);
    setLiveError(null);
    setLiveDetail(null);
    getLiveDetail(selectedLiveId)
      .then((data) => { if (!canceled) setLiveDetail(data); })
      .catch((caught) => {
        if (canceled) return;
        const message = normalizeError(caught);
        logError("load_tour_stop_detail_failed", { tourId, liveId: selectedLiveId, message });
        setLiveError(message);
      })
      .finally(() => { if (!canceled) setLiveLoading(false); });
    return () => { canceled = true; };
  }, [selectedLiveId, tourId]);

  useEffect(() => {
    if (activeTab !== "statistics" || statistics || statisticsLoading) return;
    let canceled = false;
    setStatisticsLoading(true);
    setStatisticsError(null);
    getTourStatistics(tourId)
      .then((data) => { if (!canceled) setStatistics(data); })
      .catch((caught) => {
        if (canceled) return;
        const message = normalizeError(caught);
        logError("load_tour_statistics_failed", { tourId, message });
        setStatisticsError(message);
      })
      .finally(() => { if (!canceled) setStatisticsLoading(false); });
    return () => { canceled = true; };
  }, [activeTab, tourId]);

  const selectedStop = detail?.stops.find((stop) => stop.live_id === selectedLiveId) ?? null;

  return (
    <div className="tour-detail-page">
      <div className="detail-page-head tour-detail-head">
        <h2>{detail?.url ? <DetailTitleLink href={detail.url}>{detail.tour_title}</DetailTitleLink> : detail?.tour_title ?? fallback.tourTitle}</h2>
        <button type="button" className="detail-back-btn" onClick={onBack} aria-label="返回"><span className="modal-action-glyph" aria-hidden="true">←</span></button>
      </div>
      {loading && <ContentState kind="loading" title="加载巡演详情..." layout="detail" />}
      {error && <ContentState kind="error" title="巡演详情加载失败" description={error} layout="detail" />}
      {detail && (
        <>
          <div className="detail-meta-line">
            <p className="detail-inline-item detail-inline-item-date"><strong>已收录日期：</strong><span>{formatDateRange(detail)}</span></p>
            <p className="detail-inline-item">
              <strong>场次：</strong>
              <span>
                {detail.collected_live_count}
                {(detail.cancelled_live_count ?? 0) > 0 && (
                  <span className="live-cancelled-count"> · 取消 {detail.cancelled_live_count ?? 0} 场</span>
                )}
              </span>
            </p>
            <p className="detail-inline-item"><strong>参与乐队：</strong><span>{detail.bands.map((band) => band.band_name).join(" / ") || "-"}</span></p>
          </div>
          <SectionTabs
            label="巡演详情内容"
            value={activeTab}
            options={[{ value: "stops", label: "场次详情" }, { value: "statistics", label: "巡演统计" }]}
            onChange={setActiveTab}
          />
          {activeTab === "stops" ? (
            <>
              <nav className="tour-stop-shortcuts" aria-label="巡演场次">
                {detail.stops.map((stop, index) => {
                  const shortTitle = getTourStopShortTitle(stop.live_title, detail.tour_title);
                  const displayTitle = `${shortTitle}（${formatLiveStatusText(
                    stop.event_status ?? "scheduled",
                    stop.date_phase ?? "past",
                    stop.was_rescheduled ?? false,
                  )}）`;
                  const favorite = isFavorite(stop.live_id);
                  const canOpenStop = stop.event_status !== "cancelled" || stop.has_setlist;
                  return (
                    <span
                      key={stop.live_id}
                      className={`tour-stop-shortcut-item ${stop.event_status === "cancelled" ? "is-cancelled" : ""}`}
                    >
                      {index > 0 && <span className="tour-stop-separator" aria-hidden="true" />}
                      {canOpenStop ? (
                        <button
                          type="button"
                          className="detail-tour-link tour-stop-shortcut"
                          title={stop.live_title}
                          aria-pressed={stop.live_id === selectedLiveId}
                          onClick={() => setSelectedLiveId(stop.live_id)}
                        >
                          {displayTitle}
                        </button>
                      ) : (
                        <span className="tour-stop-shortcut cancelled-static-title" title={stop.live_title}>
                          {displayTitle}
                        </span>
                      )}
                      {canFavorite && onToggleFavorite && (
                        <button
                          type="button"
                          className={`star-btn performance-group-live-star ${favorite ? "is-fav" : ""} ${isSyncing(stop.live_id) ? "is-syncing" : ""}`}
                          aria-label={`${favorite ? "取消收藏" : "加入收藏"} ${displayTitle}`}
                          aria-busy={isSyncing(stop.live_id)}
                          onClick={() => onToggleFavorite(stop.live_id)}
                        >★</button>
                      )}
                    </span>
                  );
                })}
              </nav>
              {selectedStop && (
                <div className="detail-page tour-inline-live-detail">
                  <LiveDetailContent
                    detailData={liveDetail}
                    detailLoading={liveLoading}
                    detailError={liveError}
                    fallback={{ liveTitle: selectedStop.live_title, liveDate: selectedStop.live_date, url: selectedStop.url }}
                    showTourReference={false}
                  />
                </div>
              )}
            </>
          ) : (
            <TourStatisticsPanel
              tourTitle={detail.tour_title}
              data={statistics}
              loading={statisticsLoading}
              error={statisticsError}
              stops={detail.stops}
              onOpenStop={(liveId) => {
                setSelectedLiveId(liveId);
                setActiveTab("stops");
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
