import { useCallback, useEffect, useRef, useState } from "react";

import {
  ApiError,
  getPerformances,
  getVenueDetail,
  type PerformanceItem,
  type PublicVenueDetailResponse,
} from "../api";
import { logError } from "../logger";
import { ContentState } from "./ContentState";
import { LiveCardGrid, type LiveRow } from "./LiveCardGrid";
import { MastheadTitle } from "./MastheadTitle";
import { VenueMapMenu } from "./VenueMapMenu";

type VenueDetailPageProps = {
  venueId: number;
  fallbackName: string;
  onBack: () => void;
  onOpenLive: (live: { live_id: number; live_date: string; live_title: string; url: string | null }) => void;
  onOpenGroup: (groupId: number, groupTitle: string) => void;
  onCanonicalVenue: (venueId: number, venueName: string) => void;
};

const COUNTRY_DISPLAY_NAMES: Record<string, string> = {
  TW: "中国台湾",
};

function formatLocality(detail: PublicVenueDetailResponse): string {
  if (!detail.locality) return "未登记";
  const country = COUNTRY_DISPLAY_NAMES[detail.locality.country_code]
    ?? new Intl.DisplayNames(["zh-CN"], { type: "region" }).of(detail.locality.country_code)
    ?? detail.locality.country_code;
  return [country, detail.locality.admin_area, detail.locality.locality_name]
    .filter(Boolean)
    .join(" · ");
}

function formatNamePeriod(version: PublicVenueDetailResponse["name_versions"][number]): string {
  if (version.is_current) return version.valid_from ? `${version.valid_from} 起` : "当前名称";
  if (version.valid_from && version.valid_to) return `${version.valid_from} — ${version.valid_to}`;
  if (version.valid_to) return `${version.valid_to} 前`;
  return "历史名称";
}

function toPerformanceRow(item: PerformanceItem): LiveRow {
  if (item.kind === "performance_group") {
    const group = item.performance_group;
    return {
      kind: "performance_group",
      liveId: group.group_id,
      liveDate: group.start_date,
      liveTitle: group.group_title,
      liveType: group.display_type === "single_day_multi_show" ? "单日多场" : "多日活动",
      icons: [],
      url: null,
      groupId: group.group_id,
      groupTitle: group.group_title,
      groupStartDate: group.start_date,
      groupEndDate: group.end_date,
      groupDayCount: group.day_count,
      groupLiveCount: group.live_count,
      groupCancelledLiveCount: group.cancelled_live_count ?? 0,
      groupIcons: group.bands.map((band) => band.band_id),
      eventStatus: null,
      datePhase: null,
      wasRescheduled: false,
    };
  }
  const live = item.live;
  return {
    kind: "live",
    liveId: live.live_id,
    liveDate: live.live_date,
    liveTitle: live.live_title,
    liveType: live.live_type,
    icons: live.bands,
    url: live.url,
    groupId: live.performance_group?.group_id ?? null,
    groupTitle: live.performance_group?.group_title ?? null,
    groupStartDate: null,
    groupEndDate: null,
    groupDayCount: null,
    groupLiveCount: null,
    groupCancelledLiveCount: null,
    groupIcons: [],
    eventStatus: live.event_status ?? null,
    datePhase: live.date_phase ?? null,
    wasRescheduled: live.was_rescheduled ?? false,
  };
}

export function VenueDetailPage({
  venueId,
  fallbackName,
  onBack,
  onOpenLive,
  onOpenGroup,
  onCanonicalVenue,
}: VenueDetailPageProps) {
  const [detail, setDetail] = useState<PublicVenueDetailResponse | null>(null);
  const [performances, setPerformances] = useState<PerformanceItem[]>([]);
  const [performancePagination, setPerformancePagination] = useState({ page: 1, page_size: 20, total: 0, total_pages: 1 });
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadMoreInFlightRef = useRef(false);

  useEffect(() => {
    let canceled = false;
    setLoading(true);
    setError(null);
    setNotFound(false);
    setDetail(null);
    setPerformances([]);
    getVenueDetail(venueId)
      .then(async (response) => {
        if (canceled) return;
        setDetail(response);
        if (response.venue_id !== venueId) onCanonicalVenue(response.venue_id, response.venue_name);
        try {
          const performanceResponse = await getPerformances(1, 20, "all", { venue_id: response.venue_id });
          if (!canceled) {
            setPerformances(performanceResponse.items);
            setPerformancePagination(performanceResponse.pagination);
          }
        } catch (caught) {
          if (!canceled) {
            const message = caught instanceof Error ? caught.message : String(caught);
            setError(message);
            logError("load_venue_performances_failed", { venueId: response.venue_id, message });
          }
        }
      })
      .catch((caught) => {
        if (canceled) return;
        const message = caught instanceof Error ? caught.message : "未知错误";
        setNotFound(caught instanceof ApiError && caught.status === 404);
        setError(message === "Request timeout" ? "请求超时，请稍后重试" : message);
        logError("load_venue_detail_failed", { venueId, message });
      })
      .finally(() => { if (!canceled) setLoading(false); });
    return () => { canceled = true; };
  }, [onCanonicalVenue, venueId]);

  useEffect(() => {
    if (!detail) return undefined;
    const previousTitle = document.title;
    document.title = `${detail.venue_name} · LiveSetList`;
    return () => { document.title = previousTitle; };
  }, [detail]);

  const loadMore = useCallback(async () => {
    if (!detail || loadingMore || loadMoreInFlightRef.current || performancePagination.page >= performancePagination.total_pages) return;
    loadMoreInFlightRef.current = true;
    setLoadingMore(true);
    try {
      const response = await getPerformances(performancePagination.page + 1, 20, "all", { venue_id: detail.venue_id });
      setPerformances((current) => [...current, ...response.items]);
      setPerformancePagination(response.pagination);
    } catch (caught) {
      logError("load_more_venue_lives_failed", {
        venueId: detail.venue_id,
        message: caught instanceof Error ? caught.message : String(caught),
      });
    } finally {
      loadMoreInFlightRef.current = false;
      setLoadingMore(false);
    }
  }, [detail, loadingMore, performancePagination]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) void loadMore();
    }, { rootMargin: "300px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore]);

  if (notFound) {
    return (
      <div className="stage-ledger-page" data-stage-ledger>
        <article className="stage-error-article" role="alert">
          <p className="stage-error-kicker">404</p>
          <h1>未找到这个场馆</h1>
          <p>这条场馆资料不存在，或已经从公开资料中移除。</p>
          <button type="button" className="stage-primary-button" onClick={onBack}>返回</button>
        </article>
      </div>
    );
  }

  if (loading && !detail) return <ContentState kind="loading" title={`加载${fallbackName || "场馆"}资料...`} layout="detail" />;
  if (!detail) return <ContentState kind="error" title="场馆资料加载失败" description={error ?? "请稍后重试"} layout="detail" />;

  const rows = performances.map(toPerformanceRow);
  const liveById = new Map(
    performances.flatMap((item) => item.kind === "live" ? [[item.live.live_id, item.live] as const] : []),
  );
  return (
    <div className="tour-detail-page venue-detail-page" data-stage-ledger>
      <header className="stage-masthead">
        <div className="stage-masthead-main">
          <div className="stage-title-meta">
            <span>场馆资料</span>
          </div>
          <MastheadTitle as="h1" title={detail.venue_name} />
          {detail.address && <p className="venue-detail-address">{detail.address}</p>}
        </div>
        <div className="stage-masthead-side">
          <dl className="stage-schedule-list venue-detail-facts">
            <div><dt>所在地</dt><dd>{formatLocality(detail)}</dd></div>
          </dl>
          <div className="stage-actions">
            {detail.map_links.length > 0 && (
              <VenueMapMenu venueId={detail.venue_id} venueName={detail.venue_name} links={detail.map_links} />
            )}
            <button type="button" className="stage-action-button" onClick={onBack}>返回</button>
          </div>
        </div>
      </header>

      <div className="venue-detail-sections">
        <section className="stage-history-section" aria-labelledby="venue-name-history-title">
          <div className="stage-section-heading">
            <h2 id="venue-name-history-title">名称记录</h2>
          </div>
          <ol className="stage-history-list venue-name-history-list">
            {detail.name_versions.map((version, index) => (
              <li key={`${version.venue_name}-${version.valid_from ?? "start"}-${index}`}>
                <time>{formatNamePeriod(version)}</time>
                <span>{version.venue_name}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="venue-live-section" aria-labelledby="venue-live-title">
          <div className="stage-section-heading">
            <h2 id="venue-live-title">相关 Live</h2>
            <span>共 {detail.pagination.total} 场</span>
          </div>
          <LiveCardGrid
            rows={rows}
            showStar={false}
            isFavorite={() => false}
            isSyncing={() => false}
            onToggleStar={() => undefined}
            onOpenLive={(row) => {
              const live = liveById.get(row.liveId);
              if (live) onOpenLive(live);
            }}
            onOpenGroup={onOpenGroup}
            loading={false}
            loadError={error}
            sentinelRef={sentinelRef}
            loadingMore={loadingMore}
            hasMore={performancePagination.page < performancePagination.total_pages}
            total={performancePagination.total}
            showCompletionMessage={false}
          />
        </section>
      </div>
    </div>
  );
}
