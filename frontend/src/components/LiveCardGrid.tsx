import { type MutableRefObject } from "react";
import { ExternalLinkIcon, FavoriteIcon } from "./ActionIcons";
import { type BandIconInput } from "./BandIconsCell";
import { LiveCardBands } from "./LiveCardBands";
import { CollectedLiveBadges } from "./CollectedLiveBadges";
import { ContentState } from "./ContentState";
import { LiveTypeBadge } from "./LiveTypeBadge";
import { formatLiveType } from "./console/constants";
import { formatCompactDate, formatCompactDateRange } from "../dateFormat";
import {
  formatLiveStatusText,
  getLiveStatusPresentation,
  getPerformanceGroupStatusPresentation,
} from "../liveStatus";
import { formatTimedLabel } from "../liveTimeFormat";
import type { CatalogBandItem, DatePhase, EventStatus } from "../api";

export type LiveRow = {
  kind: "live" | "performance_group";
  liveId: number;
  liveDate: string;
  liveTitle: string;
  liveType: string;
  icons: BandIconInput[];
  url: string | null;
  groupId: number | null;
  groupTitle: string | null;
  groupStartDate: string | null;
  groupEndDate: string | null;
  groupDayCount: number | null;
  groupLiveCount: number | null;
  groupCancelledLiveCount: number | null;
  groupIcons: BandIconInput[];
  eventStatus: EventStatus | null;
  datePhase: DatePhase | null;
  wasRescheduled: boolean;
  venue?: string | null;
  startTime?: string | null;
  startTimezoneLabel?: string | null;
  hasSetlist?: boolean;
  groupVenues?: string[];
  bandNames?: Record<number, string>;
};

interface LiveCardGridProps {
  rows: LiveRow[];
  bands?: CatalogBandItem[];
  showStar: boolean;
  isFavorite: (id: number) => boolean;
  isSyncing: (id: number) => boolean;
  onToggleStar: (id: number) => void;
  onOpenLive: (row: LiveRow) => void;
  onOpenGroup?: (groupId: number, groupTitle: string) => void;
  loading: boolean;
  loadError: string | null;
  sentinelRef: MutableRefObject<HTMLDivElement | null>;
  loadingMore: boolean;
  hasMore: boolean;
  total: number;
  showCompletionMessage?: boolean;
}

export function formatCompactPerformanceDate(
  startDate: string | null,
  endDate: string | null,
  fallbackDate: string,
): string {
  return formatCompactDateRange(startDate, endDate, fallbackDate);
}

function getCardStatus(row: LiveRow): { text: string; tone: string } {
  if (row.kind === "performance_group") {
    const status = getPerformanceGroupStatusPresentation(
      row.groupStartDate,
      row.groupEndDate,
      row.groupCancelledLiveCount ?? 0,
      row.groupLiveCount ?? 0,
    );
    return { text: status.primary, tone: status.tone };
  }
  return {
    text: formatLiveStatusText(
      row.eventStatus ?? "scheduled",
      row.datePhase ?? "past",
      row.wasRescheduled,
    ),
    tone: getLiveStatusPresentation(
      row.eventStatus ?? "scheduled",
      row.datePhase ?? "past",
      row.wasRescheduled,
    ).tone,
  };
}

export function LiveCardGrid({
  rows,
  bands = [],
  showStar,
  isFavorite,
  isSyncing,
  onToggleStar,
  onOpenLive,
  onOpenGroup,
  loading,
  loadError,
  sentinelRef,
  loadingMore,
  hasMore,
  total,
  showCompletionMessage = true,
}: LiveCardGridProps) {
  if (loadError && rows.length === 0) {
    return (
      <ContentState
        kind="error"
        title="数据加载失败"
        description={loadError}
        layout="cards"
      />
    );
  }

  if (rows.length === 0) {
    return loading ? (
      <ContentState kind="loading" title="加载中..." description="正在整理演出资料。" layout="cards" />
    ) : (
      <ContentState kind="empty" title="当前没有可展示的数据" description="可以调整筛选条件后再试。" layout="cards" />
    );
  }

  return (
    <>
      <div className="live-card-grid">
        {rows.map((row) => {
          const status = getCardStatus(row);
          const grouped = row.kind === "performance_group";
          const open = () => grouped
            ? row.groupId !== null && onOpenGroup?.(row.groupId, row.groupTitle ?? row.liveTitle)
            : onOpenLive(row);
          const venue = grouped ? row.groupVenues?.join(" / ") : row.venue;
          return (
            <article key={grouped ? `group-${row.groupId}` : row.liveId} className="live-card" data-status-tone={status.tone}
              onClick={(event) => { if (!(event.target as HTMLElement).closest("button, a")) open(); }}>
              <div className="live-card-head">
                <span className="live-card-date">{grouped
                  ? formatCompactPerformanceDate(row.groupStartDate, row.groupEndDate, row.liveDate)
                  : formatCompactDate(row.liveDate)}</span>
                <span className="live-card-badges">
                  <LiveTypeBadge value={grouped ? "performance_group" : row.liveType} label={grouped ? row.liveType : formatLiveType(row.liveType)} />
                  <span className="live-status-pill">{status.text}</span>
                </span>
                {!grouped && showStar && row.eventStatus !== "cancelled" && (
                  <button type="button" className={`star-btn live-card-action ${isFavorite(row.liveId) ? "is-fav" : ""} ${isSyncing(row.liveId) ? "is-syncing" : ""}`}
                    onClick={() => onToggleStar(row.liveId)} title={isFavorite(row.liveId) ? "取消收藏" : "加入收藏"}
                    aria-label={isFavorite(row.liveId) ? "取消收藏" : "加入收藏"} aria-pressed={isFavorite(row.liveId)} aria-busy={isSyncing(row.liveId)}>
                    <FavoriteIcon filled={isFavorite(row.liveId)} />
                  </button>
                )}
              </div>
              <h2 className="live-card-title"><button type="button" className="live-card-main"
                aria-label={`${grouped ? "查看活动组" : "查看"}《${row.liveTitle}》详情，状态：${status.text}`} onClick={open}>{row.liveTitle}</button></h2>
              <LiveCardBands icons={grouped ? row.groupIcons : row.icons} bands={bands} names={row.bandNames} />
              <div className="live-card-location">{venue || "场馆未公布"}</div>
              <div className="live-card-footer">
                <span className="live-card-info">
                  {grouped ? <><strong>{row.groupDayCount}日</strong><span> · </span><CollectedLiveBadges collectedCount={row.groupLiveCount ?? 0} cancelledCount={row.groupCancelledLiveCount} /></>
                    : row.eventStatus === "cancelled" ? null
                    : row.datePhase === "past" ? row.hasSetlist === undefined ? null : row.hasSetlist ? <strong>有歌单</strong> : "尚无歌单"
                    : row.startTime ? <>开演 <strong>{formatTimedLabel(row.startTime, row.startTimezoneLabel)}</strong></> : "开演时间未公布"}
                </span>
                {!grouped && row.url && <a href={row.url} target="_blank" rel="noreferrer" className="live-card-url live-card-action"
                  title="资料来源" aria-label={`打开《${row.liveTitle}》的资料来源`}><ExternalLinkIcon /></a>}
              </div>
            </article>
          );
        })}
      </div>
      <div ref={sentinelRef} className="live-card-sentinel">
        {loadingMore ? "加载中..." : hasMore || !showCompletionMessage ? "" : `已加载全部 ${total} 条`}
      </div>
    </>
  );
}
