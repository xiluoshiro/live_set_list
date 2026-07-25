import { type MutableRefObject } from "react";
import { ExternalLinkIcon, FavoriteIcon } from "./ActionIcons";
import { BandIconsCell, type BandIconInput } from "./BandIconsCell";
import { ContentState } from "./ContentState";
import { LiveTypeBadge } from "./LiveTypeBadge";
import { formatLiveType } from "./console/constants";
import { formatCompactDate, formatCompactDateRange } from "../dateFormat";
import {
  formatLiveStatusText,
  getLiveStatusPresentation,
  getPerformanceGroupStatusPresentation,
} from "../liveStatus";
import type { DatePhase, EventStatus } from "../api";

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
};

interface LiveCardGridProps {
  rows: LiveRow[];
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
}

export function formatPerformanceDate(
  startDate: string | null,
  endDate: string | null,
  fallbackDate: string,
): string {
  if (!startDate) return fallbackDate;
  if (!endDate || startDate === endDate) return startDate;
  return `${startDate} ~ ${endDate}`;
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
          return row.kind === "performance_group" ? (
            <article
              key={`group-${row.groupId}`}
              className="live-card"
              data-status-tone={status.tone}
            >
              <button
                type="button"
                className="live-card-main"
                aria-label={`查看活动组《${row.liveTitle}》详情，状态：${status.text}`}
                onClick={() => row.groupId !== null && row.groupTitle !== null && onOpenGroup?.(row.groupId, row.groupTitle)}
              >
                <span className="live-card-head">
                  <span className="live-card-date">
                    {formatCompactPerformanceDate(row.groupStartDate, row.groupEndDate, row.liveDate)}
                  </span>
                  <span className="live-card-badges">
                    <LiveTypeBadge value="performance_group" label={row.liveType} />
                    <span className="live-status-pill">{status.text}</span>
                  </span>
                </span>
                <span className="live-card-title">{row.liveTitle}</span>
              </button>
              <div className="live-card-footer">
                <BandIconsCell icons={row.groupIcons} rowId={row.groupId ?? 0} />
                <span className="live-card-count">
                  {row.groupLiveCount !== null
                    ? row.groupDayCount === 1
                      ? `已收录 ${row.groupLiveCount} 场${row.groupCancelledLiveCount ? ` · 取消 ${row.groupCancelledLiveCount} 场` : ""}`
                      : `已收录 ${row.groupDayCount} 日 · ${row.groupLiveCount} 场${row.groupCancelledLiveCount ? ` · 取消 ${row.groupCancelledLiveCount} 场` : ""}`
                    : ""}
                </span>
              </div>
            </article>
          ) : (
            <article
              key={row.liveId}
              className="live-card"
              data-status-tone={status.tone}
            >
              <button
                type="button"
                className="live-card-main"
                aria-label={`查看《${row.liveTitle}》详情，状态：${status.text}`}
                onClick={() => onOpenLive(row)}
              >
                <span className="live-card-head">
                  <span className="live-card-date">{formatCompactDate(row.liveDate)}</span>
                  <span className="live-card-badges">
                    <LiveTypeBadge value={row.liveType} label={formatLiveType(row.liveType)} />
                    <span className="live-status-pill">{status.text}</span>
                  </span>
                </span>
                <span className="live-card-title">{row.liveTitle}</span>
              </button>
              <div className="live-card-footer">
                <BandIconsCell icons={row.icons} rowId={row.liveId} />
                <span className="live-card-actions">
                  {showStar && row.eventStatus !== "cancelled" && (
                    <button
                      type="button"
                      className={`star-btn live-card-action ${isFavorite(row.liveId) ? "is-fav" : ""} ${isSyncing(row.liveId) ? "is-syncing" : ""}`}
                      onClick={() => onToggleStar(row.liveId)}
                      title={isFavorite(row.liveId) ? "取消收藏" : "加入收藏"}
                      aria-label={isFavorite(row.liveId) ? "取消收藏" : "加入收藏"}
                      aria-busy={isSyncing(row.liveId)}
                    >
                      <FavoriteIcon filled={isFavorite(row.liveId)} />
                    </button>
                  )}
                  {row.url ? (
                    <a
                      href={row.url}
                      target="_blank"
                      rel="noreferrer"
                      className="live-card-url live-card-action"
                      aria-label={`打开《${row.liveTitle}》的资料来源`}
                    >
                      <ExternalLinkIcon />
                    </a>
                  ) : null}
                </span>
              </div>
            </article>
          );
        })}
      </div>
      <div ref={sentinelRef} className="live-card-sentinel">
        {loadingMore ? "加载中..." : hasMore ? "" : `已加载全部 ${total} 条`}
      </div>
    </>
  );
}
