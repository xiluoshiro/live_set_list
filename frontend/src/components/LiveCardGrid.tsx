import { type MutableRefObject } from "react";
import { BandIconsCell, type BandIconInput } from "./BandIconsCell";
import { formatLiveType } from "./console/constants";

export type LiveRow = {
  liveId: number;
  liveDate: string;
  liveTitle: string;
  liveType: string;
  icons: BandIconInput[];
  url: string | null;
};

interface LiveCardGridProps {
  rows: LiveRow[];
  showStar: boolean;
  isFavorite: (id: number) => boolean;
  isSyncing: (id: number) => boolean;
  onToggleStar: (id: number) => void;
  onOpenLive: (row: LiveRow) => void;
  loading: boolean;
  loadError: string | null;
  sentinelRef: MutableRefObject<HTMLDivElement | null>;
  loadingMore: boolean;
  hasMore: boolean;
  total: number;
}

export function LiveCardGrid({
  rows,
  showStar,
  isFavorite,
  isSyncing,
  onToggleStar,
  onOpenLive,
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
        {rows.map((row) => (
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
        ))}
      </div>
      <div ref={sentinelRef} className="live-card-sentinel">
        {loadingMore ? "加载中..." : hasMore ? "" : `已加载全部 ${total} 条`}
      </div>
    </>
  );
}
