import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, getVenueDetail, type PublicVenueDetailResponse, type PublicVenueLiveItem } from "../api";
import { logError } from "../logger";
import { ContentState } from "./ContentState";
import { LiveCardGrid, type LiveRow } from "./LiveCardGrid";
import { MastheadTitle } from "./MastheadTitle";
import { VenueMapMenu } from "./VenueMapMenu";

type VenueDetailPageProps = {
  venueId: number;
  fallbackName: string;
  onBack: () => void;
  onOpenLive: (live: PublicVenueLiveItem) => void;
  onCanonicalVenue: (venueId: number, venueName: string) => void;
};

const VENUE_KIND_LABELS = { physical: "实体场馆", online: "线上场馆", undisclosed: "未公开场地" } as const;

function formatLocality(detail: PublicVenueDetailResponse): string {
  if (!detail.locality) return "未登记";
  return [detail.locality.country_code, detail.locality.admin_area, detail.locality.locality_name]
    .filter(Boolean)
    .join(" · ");
}

function formatNamePeriod(version: PublicVenueDetailResponse["name_versions"][number]): string {
  if (version.is_current) return version.valid_from ? `${version.valid_from} 起` : "当前名称";
  if (version.valid_from && version.valid_to) return `${version.valid_from} — ${version.valid_to}`;
  if (version.valid_to) return `${version.valid_to} 前`;
  return "历史名称";
}

function toLiveRow(live: PublicVenueLiveItem): LiveRow {
  return {
    kind: "live",
    liveId: live.live_id,
    liveDate: live.live_date,
    liveTitle: live.live_title,
    liveType: live.live_type,
    icons: live.bands,
    url: live.url,
    groupId: null,
    groupTitle: null,
    groupStartDate: null,
    groupEndDate: null,
    groupDayCount: null,
    groupLiveCount: null,
    groupCancelledLiveCount: null,
    groupIcons: [],
    eventStatus: live.event_status,
    datePhase: live.date_phase,
    wasRescheduled: live.was_rescheduled,
  };
}

export function VenueDetailPage({ venueId, fallbackName, onBack, onOpenLive, onCanonicalVenue }: VenueDetailPageProps) {
  const [detail, setDetail] = useState<PublicVenueDetailResponse | null>(null);
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
    getVenueDetail(venueId)
      .then((response) => {
        if (canceled) return;
        setDetail(response);
        if (response.venue_id !== venueId) onCanonicalVenue(response.venue_id, response.venue_name);
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
    if (!detail || loadingMore || loadMoreInFlightRef.current || detail.pagination.page >= detail.pagination.total_pages) return;
    loadMoreInFlightRef.current = true;
    setLoadingMore(true);
    try {
      const response = await getVenueDetail(detail.venue_id, detail.pagination.page + 1, 20);
      setDetail((current) => current && current.venue_id === response.venue_id
        ? { ...response, lives: [...current.lives, ...response.lives] }
        : response);
    } catch (caught) {
      logError("load_more_venue_lives_failed", {
        venueId: detail.venue_id,
        message: caught instanceof Error ? caught.message : String(caught),
      });
    } finally {
      loadMoreInFlightRef.current = false;
      setLoadingMore(false);
    }
  }, [detail, loadingMore]);

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

  const rows = detail.lives.map(toLiveRow);
  const liveById = new Map(detail.lives.map((live) => [live.live_id, live]));
  return (
    <div className="tour-detail-page venue-detail-page" data-stage-ledger>
      <header className="stage-masthead">
        <div className="stage-masthead-main">
          <div className="stage-title-meta">
            <span>场馆资料</span>
            <span className="stage-type-label">{VENUE_KIND_LABELS[detail.venue_kind]}</span>
          </div>
          <MastheadTitle as="h1" title={detail.venue_name} />
          {detail.address && <p className="venue-detail-address">{detail.address}</p>}
        </div>
        <div className="stage-masthead-side">
          <dl className="stage-schedule-list venue-detail-facts">
            <div><dt>所在地</dt><dd>{formatLocality(detail)}</dd></div>
            <div><dt>时区</dt><dd>{detail.timezone_id ?? "未登记"}</dd></div>
            <div><dt>纬度</dt><dd>{detail.latitude ?? "未登记"}</dd></div>
            <div><dt>经度</dt><dd>{detail.longitude ?? "未登记"}</dd></div>
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
            <span>{detail.name_versions.length} 条</span>
          </div>
          <ol className="stage-history-list venue-name-history-list">
            {detail.name_versions.map((version, index) => (
              <li key={`${version.venue_name}-${version.valid_from ?? "start"}-${index}`}>
                <time>{formatNamePeriod(version)}</time>
                <span>{version.venue_name}{version.is_current ? "（当前）" : ""}</span>
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
            loading={false}
            loadError={null}
            sentinelRef={sentinelRef}
            loadingMore={loadingMore}
            hasMore={detail.pagination.page < detail.pagination.total_pages}
            total={detail.pagination.total}
          />
        </section>
      </div>
    </div>
  );
}
