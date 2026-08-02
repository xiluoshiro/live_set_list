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
import { ContentState } from "./ContentState";
import { MastheadTitle } from "./MastheadTitle";
import { StageLedgerContent } from "./StageLedgerContent";
import { SectionTabs } from "./SectionTabs";
import { StopShortcuts } from "./StopShortcuts";
import { getTourStopShortTitle } from "./tourHelpers";
import { TourStatisticsPanel } from "./TourStatisticsPanel";

export type TourDetailFallback = { tourTitle: string };
type TourDetailTab = "stops" | "statistics";

type TourDetailPageProps = {
  tourId: number;
  fallback: TourDetailFallback;
  canFavorite?: boolean;
  isFavorite?: (liveId: number) => boolean;
  isSyncing?: (liveId: number) => boolean;
  onToggleFavorite?: (liveId: number) => void;
  onOpenBand?: (bandId: number) => void;
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
  canFavorite = false,
  isFavorite = () => false,
  isSyncing = () => false,
  onToggleFavorite,
  onOpenBand,
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
    <div className="tour-detail-page" data-stage-ledger>
      <header className="stage-masthead">
        <div className="stage-masthead-main">
          <div className="stage-title-meta">
            <span className="stage-type-label">巡演</span>
          </div>
          <MastheadTitle as="h1" title={detail?.tour_title ?? fallback.tourTitle} />
          {detail && detail.bands.length > 0 && (
            <div className="stage-masthead-bands">
              <span className="stage-field-label">参与乐队</span>
              <ul className="stage-band-list">
                {detail.bands.map((band) => (
                  <li key={band.band_id}>
                    {onOpenBand ? (
                      <button type="button" className="stage-inline-link" onClick={() => onOpenBand(band.band_id)}>
                        {band.band_name}
                      </button>
                    ) : (
                      <span>{band.band_name}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        {detail && (
          <div className="stage-masthead-side">
            <dl className="stage-schedule-list">
              <div><dt>已收录日期</dt><dd>{formatDateRange(detail)}</dd></div>
              <div>
                <dt>场次</dt>
                <dd>
                  {detail.collected_live_count} 场
                  {(detail.cancelled_live_count ?? 0) > 0 && (
                    <span className="live-cancelled-count"> · 取消 {detail.cancelled_live_count ?? 0} 场</span>
                  )}
                </dd>
              </div>
            </dl>
          </div>
        )}
      </header>
      {loading && <ContentState kind="loading" title="加载巡演详情..." layout="detail" />}
      {error && <ContentState kind="error" title="巡演详情加载失败" description={error} layout="detail" />}
      {detail && (
        <>
          <SectionTabs
            label="巡演详情内容"
            value={activeTab}
            options={[{ value: "stops", label: "场次详情" }, { value: "statistics", label: "巡演统计" }]}
            onChange={setActiveTab}
          />
          {activeTab === "stops" ? (
            <>
              <StopShortcuts
                label="巡演场次"
                items={detail.stops.map((stop) => {
                  const shortTitle = getTourStopShortTitle(stop.live_title, detail.tour_title);
                  const displayTitle = stop.event_status === "cancelled"
                    ? `${shortTitle}（已取消）`
                    : shortTitle;
                  return {
                    liveId: stop.live_id,
                    title: displayTitle,
                    fullTitle: stop.live_title,
                    cancelled: stop.event_status === "cancelled",
                    canOpen: stop.event_status !== "cancelled" || stop.has_setlist,
                    selected: stop.live_id === selectedLiveId,
                    onSelect: () => setSelectedLiveId(stop.live_id),
                  };
                })}
              />
              {selectedStop && (
                <div className="tour-inline-live-detail">
                  <StageLedgerContent
                    detailData={liveDetail}
                    detailLoading={liveLoading}
                    detailError={liveError}
                    fallback={{ liveTitle: selectedStop.live_title, liveDate: selectedStop.live_date, url: selectedStop.url }}
                    displayTitle={getTourStopShortTitle(selectedStop.live_title, detail.tour_title)}
                    showTourReference={false}
                    embedded
                    onOpenBand={onOpenBand}
                    canFavorite={canFavorite}
                    isFavorite={selectedLiveId !== null && isFavorite(selectedLiveId)}
                    isFavoriteSyncing={selectedLiveId !== null && isSyncing(selectedLiveId)}
                    onToggleFavorite={selectedLiveId === null || !onToggleFavorite ? undefined : () => onToggleFavorite(selectedLiveId)}
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
