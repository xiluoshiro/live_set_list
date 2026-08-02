import { useEffect, useState } from "react";

import {
  getLiveDetail,
  getPerformanceGroupDetail,
  type LiveDetailResponse,
  type PerformanceGroupDetailResponse,
  type TourRef,
} from "../api";
import { logError } from "../logger";
import { getPerformanceGroupStatusPresentation } from "../liveStatus";
import { ContentState } from "./ContentState";
import { StageLedgerContent } from "./StageLedgerContent";
import { StopShortcuts } from "./StopShortcuts";
import { getGroupedLiveShortTitle } from "./performanceGroupHelpers";

type PerformanceGroupDetailPageProps = {
  groupId: number;
  initialLiveId?: number | null;
  onOpenTour?: (tour: TourRef) => void;
  canFavorite?: boolean;
  isFavorite?: (liveId: number) => boolean;
  isSyncing?: (liveId: number) => boolean;
  onToggleFavorite?: (liveId: number) => void;
  onOpenBand?: (bandId: number) => void;
};

function getDisplayTypeLabel(
  displayType: PerformanceGroupDetailResponse["display_type"],
): string {
  return displayType === "single_day_multi_show" ? "单日多场" : "多日活动";
}

function getCountText(detail: PerformanceGroupDetailResponse): string {
  const cancelledText = (detail.cancelled_live_count ?? 0) > 0
    ? ` · 取消 ${detail.cancelled_live_count ?? 0} 场`
    : "";
  if (detail.day_count === 1) {
    return `已收录 ${detail.live_count} 场${cancelledText}`;
  }
  return `已收录 ${detail.day_count} 日 · ${detail.live_count} 场${cancelledText}`;
}

function normalizeError(caught: unknown): string {
  const message = caught instanceof Error ? caught.message : "未知错误";
  return message === "Request timeout" ? "请求超时，请稍后重试" : message;
}

export function PerformanceGroupDetailPage({
  groupId,
  initialLiveId = null,
  onOpenTour,
  canFavorite = false,
  isFavorite = () => false,
  isSyncing = () => false,
  onToggleFavorite,
  onOpenBand,
}: PerformanceGroupDetailPageProps) {
  const [detail, setDetail] = useState<PerformanceGroupDetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedLiveId, setSelectedLiveId] = useState<number | null>(null);
  const [liveDetail, setLiveDetail] = useState<LiveDetailResponse | null>(null);
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;
    setLoading(true);
    setError(null);
    setDetail(null);
    setSelectedLiveId(null);
    getPerformanceGroupDetail(groupId)
      .then((data) => {
        if (canceled) return;
        setDetail(data);
        const requestedLiveExists = initialLiveId !== null
          && data.lives.some((live) => live.live_id === initialLiveId);
        const requestedLive = data.lives.find((live) => live.live_id === initialLiveId);
        const requestedLiveCanOpen = requestedLive
          && (requestedLive.event_status !== "cancelled" || requestedLive.has_setlist);
        setSelectedLiveId(
          requestedLiveExists && requestedLiveCanOpen
            ? initialLiveId
            : data.lives.find((live) => live.event_status !== "cancelled" || live.has_setlist)?.live_id ?? null,
        );
      })
      .catch((caught) => {
        if (canceled) return;
        const message = normalizeError(caught);
        logError("load_performance_group_detail_failed", { groupId, message });
        setError(message);
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [groupId, initialLiveId]);

  useEffect(() => {
    if (selectedLiveId === null) return;
    let canceled = false;
    setLiveLoading(true);
    setLiveError(null);
    setLiveDetail(null);
    getLiveDetail(selectedLiveId)
      .then((data) => {
        if (!canceled) setLiveDetail(data);
      })
      .catch((caught) => {
        if (canceled) return;
        const message = normalizeError(caught);
        logError("load_performance_group_live_detail_failed", {
          groupId,
          liveId: selectedLiveId,
          message,
        });
        setLiveError(message);
      })
      .finally(() => {
        if (!canceled) setLiveLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [selectedLiveId, groupId]);

  const selectedLive = detail?.lives.find(
    (live) => live.live_id === selectedLiveId,
  ) ?? null;

  const groupStatus = detail
    ? getPerformanceGroupStatusPresentation(
        detail.start_date,
        detail.end_date,
        detail.cancelled_live_count ?? 0,
        detail.live_count,
      )
    : null;
  return (
    <div className="tour-detail-page" data-stage-ledger>
      {detail && groupStatus && (
        <header className="stage-masthead">
          <div className="stage-masthead-main">
            <div className="stage-title-meta">
              <span className="stage-status-line" data-status-tone={groupStatus.tone}>
                <span>{groupStatus.primary}</span>
              </span>
              <span className="stage-type-label">{getDisplayTypeLabel(detail.display_type)}</span>
            </div>
            <h1>{detail.group_title}</h1>
            {detail.bands.length > 0 && (
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
          <div className="stage-masthead-side">
            <dl className="stage-schedule-list">
              <div><dt>场次</dt><dd>{getCountText(detail)}</dd></div>
            </dl>
          </div>
        </header>
      )}
      {loading && <ContentState kind="loading" title="加载活动组详情..." layout="detail" />}
      {error && <ContentState kind="error" title="活动组详情加载失败" description={error} layout="detail" />}
      {detail && (
        <>
          <StopShortcuts
            label="活动组场次"
            items={detail.lives.map((live) => {
              const shortTitle = getGroupedLiveShortTitle(live.live_title, detail.group_title);
              const displayTitle = live.event_status === "cancelled"
                ? `${shortTitle}（已取消）`
                : shortTitle;
              return {
                liveId: live.live_id,
                title: displayTitle,
                fullTitle: live.live_title,
                cancelled: live.event_status === "cancelled",
                canOpen: live.event_status !== "cancelled" || live.has_setlist,
                selected: live.live_id === selectedLiveId,
                onSelect: () => setSelectedLiveId(live.live_id),
              };
            })}
          />
          {selectedLive && (
            <div className="tour-inline-live-detail">
              <StageLedgerContent
                detailData={liveDetail}
                detailLoading={liveLoading}
                detailError={liveError}
                fallback={{
                  liveTitle: selectedLive.live_title,
                  liveDate: selectedLive.live_date,
                  url: selectedLive.url,
                }}
                displayTitle={getGroupedLiveShortTitle(selectedLive.live_title, detail.group_title)}
                onOpenTour={onOpenTour}
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
      )}
    </div>
  );
}
