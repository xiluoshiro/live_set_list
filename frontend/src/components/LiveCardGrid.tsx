import { type MutableRefObject } from "react";
import { BandIconsCell, type BandIconInput } from "./BandIconsCell";
import { formatLiveType } from "./console/constants";

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
  groupIcons: BandIconInput[];
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
    return <p className="live-card-state live-card-state-error">数据加载失败: {loadError}</p>;
  }

  if (rows.length === 0) {
    return <p className="live-card-state">{loading ? "加载中..." : "当前没有可展示的数据"}</p>;
  }

  return (
    <>
      <div className="live-card-grid">
        {rows.map((row) =>
          row.kind === "performance_group" ? (
            <article
              key={`group-${row.groupId}`}
              className="live-card"
              onClick={() => row.groupId !== null && row.groupTitle !== null && onOpenGroup?.(row.groupId, row.groupTitle)}
            >
              <div className="live-card-head">
                <span className="live-card-date">
                  {formatPerformanceDate(row.groupStartDate, row.groupEndDate, row.liveDate)}
                </span>
                <span className="live-card-type">{row.liveType}</span>
              </div>
              <span className="live-card-title">{row.liveTitle}</span>
              <div className="live-card-footer">
                <BandIconsCell icons={row.groupIcons} rowId={row.groupId ?? 0} />
                <span className="live-card-count">
                  {row.groupLiveCount !== null
                    ? row.groupDayCount === 1
                      ? `已收录 ${row.groupLiveCount} 场`
                      : `已收录 ${row.groupDayCount} 日 · ${row.groupLiveCount} 场`
                    : ""}
                </span>
              </div>
            </article>
          ) : (
            <article
              key={row.liveId}
              className="live-card"
              onClick={() => onOpenLive(row)}
            >
              <div className="live-card-head">
                {showStar && (
                  <button
                    className={`star-btn ${isFavorite(row.liveId) ? "is-fav" : ""} ${isSyncing(row.liveId) ? "is-syncing" : ""}`}
                    onClick={(e) => { e.stopPropagation(); onToggleStar(row.liveId); }}
                    title={isFavorite(row.liveId) ? "取消收藏" : "加入收藏"}
                    aria-label={isFavorite(row.liveId) ? "取消收藏" : "加入收藏"}
                    aria-busy={isSyncing(row.liveId)}
                  >
                    ★
                  </button>
                )}
                <span className="live-card-date">{row.liveDate}</span>
                <span className="live-card-type">{formatLiveType(row.liveType)}</span>
              </div>
              <span className="live-card-title">{row.liveTitle}</span>
              <div className="live-card-footer">
                <BandIconsCell icons={row.icons} rowId={row.liveId} />
                {row.url ? (
                  <a
                    href={row.url}
                    target="_blank"
                    rel="noreferrer"
                    className="live-card-url"
                    onClick={(e) => e.stopPropagation()}
                  >
                    🔗
                  </a>
                ) : null}
              </div>
            </article>
          )
        )}
      </div>
      <div ref={sentinelRef} className="live-card-sentinel">
        {loadingMore ? "加载中..." : hasMore ? "" : `已加载全部 ${total} 条`}
      </div>
    </>
  );
}
