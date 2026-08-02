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
import { DetailTitleLink } from "./DetailTitleLink";
import { StageLedgerContent } from "./StageLedgerContent";
import { getGroupedLiveShortTitle } from "./performanceGroupHelpers";

type PerformanceGroupDetailPageProps = {
  groupId: number;
  initialLiveId?: number | null;
  onBack: () => void;
  onOpenTour?: (tour: TourRef) => void;
  canFavorite?: boolean;
  isFavorite?: (liveId: number) => boolean;
  isSyncing?: (liveId: number) => boolean;
  onToggleFavorite?: (liveId: number) => void;
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
  onBack,
  onOpenTour,
  canFavorite = false,
  isFavorite = () => false,
  isSyncing = () => false,
  onToggleFavorite,
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

  const groupUrl = detail?.lives[0]?.url ?? null;
  return (
    <div className="tour-detail-page">
      <div className="detail-page-head tour-detail-head">
        <h2>
          {groupUrl
            ? <DetailTitleLink href={groupUrl}>{detail?.group_title ?? `活动组 #${groupId}`}</DetailTitleLink>
            : detail?.group_title ?? `活动组 #${groupId}`}
        </h2>
        <button type="button" className="detail-back-btn" onClick={onBack} aria-label="返回"><span className="modal-action-glyph" aria-hidden="true">←</span></button>
      </div>
      {loading && <ContentState kind="loading" title="加载活动组详情..." layout="detail" />}
      {error && <ContentState kind="error" title="活动组详情加载失败" description={error} layout="detail" />}
      {detail && (
        <>
          {(() => {
            const status = getPerformanceGroupStatusPresentation(
              detail.start_date,
              detail.end_date,
              detail.cancelled_live_count ?? 0,
              detail.live_count,
            );
            return (
              <section className="live-status-panel" data-status-tone={status.tone} aria-label="活动状态">
                <strong>{status.primary}</strong>
              </section>
            );
          })()}
          <div className="detail-meta-line">
            <p className="detail-inline-item"><strong>类型：</strong><span>{getDisplayTypeLabel(detail.display_type)}</span></p>
            <p className="detail-inline-item"><strong>场次：</strong><span>{getCountText(detail)}</span></p>
            <p className="detail-inline-item"><strong>参与乐队：</strong><span>{detail.bands.map((b) => b.band_name).join(" / ") || "-"}</span></p>
          </div>
          <nav
            className="tour-stop-shortcuts"
            aria-label="活动组场次"
          >
            {detail.lives.map((live, index) => {
              const shortTitle = getGroupedLiveShortTitle(live.live_title, detail.group_title);
              const displayTitle = live.event_status === "cancelled"
                ? `${shortTitle}（已取消）`
                : shortTitle;
              const favorite = isFavorite(live.live_id);
              const canOpenLive = live.event_status !== "cancelled" || live.has_setlist;
              return (
                <span
                  key={live.live_id}
                  className={`tour-stop-shortcut-item ${live.event_status === "cancelled" ? "is-cancelled" : ""}`}
                >
                  {index > 0 && <span className="tour-stop-separator" aria-hidden="true" />}
                  {canOpenLive ? (
                    <button
                      type="button"
                      className="detail-tour-link tour-stop-shortcut"
                      title={live.live_title}
                      aria-pressed={live.live_id === selectedLiveId}
                      onClick={() => setSelectedLiveId(live.live_id)}
                    >
                      {displayTitle}
                    </button>
                  ) : (
                    <span className="tour-stop-shortcut cancelled-static-title" title={live.live_title}>
                      {displayTitle}
                    </span>
                  )}
                  {canFavorite && onToggleFavorite && live.event_status !== "cancelled" && (
                    <button
                      type="button"
                      className={`star-btn performance-group-live-star ${favorite ? "is-fav" : ""} ${isSyncing(live.live_id) ? "is-syncing" : ""}`}
                      aria-label={`${favorite ? "取消收藏" : "加入收藏"} ${displayTitle}`}
                      aria-busy={isSyncing(live.live_id)}
                      onClick={() => onToggleFavorite(live.live_id)}
                    >★</button>
                  )}
                </span>
              );
            })}
          </nav>
          {selectedLive && (
            <div className="detail-page tour-inline-live-detail">
              <StageLedgerContent
                detailData={liveDetail}
                detailLoading={liveLoading}
                detailError={liveError}
                fallback={{
                  liveTitle: selectedLive.live_title,
                  liveDate: selectedLive.live_date,
                  url: selectedLive.url,
                }}
                onOpenTour={onOpenTour}
                embedded
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
