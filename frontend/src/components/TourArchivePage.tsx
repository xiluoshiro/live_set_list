import { useCallback, useEffect, useRef, useState } from "react";

import { getTours, type CatalogBandItem, type TourSummary } from "../api";
import { logError } from "../logger";
import { TourCardGrid } from "./TourCardGrid";
import { TourListFilters, type TourFilters } from "./TourListFilters";

type TourArchivePageProps = {
  filters: TourFilters;
  years: number[];
  bands: CatalogBandItem[];
  onFiltersChange: (filters: TourFilters) => void;
  onOpenTour: (tour: TourSummary) => void;
};

export function TourArchivePage({
  filters,
  years,
  bands,
  onFiltersChange,
  onOpenTour,
}: TourArchivePageProps) {
  const [tours, setTours] = useState<TourSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const requestVersionRef = useRef(0);
  const loadMoreInFlightRef = useRef(false);

  useEffect(() => {
    let canceled = false;
    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    setLoading(true);
    setLoadingMore(false);
    loadMoreInFlightRef.current = false;
    setError(null);
    setTours([]);
    setPage(1);
    getTours(1, 20, {
      q: filters.q || undefined,
      year: filters.year ?? undefined,
      bandId: filters.bandId ?? undefined,
      sort: filters.sort,
    })
      .then((response) => {
        if (canceled || requestVersionRef.current !== requestVersion) return;
        setTours(response.items);
        setTotal(response.pagination.total);
        setTotalPages(response.pagination.total_pages);
        setPage(response.pagination.page);
      })
      .catch((caught) => {
        if (canceled || requestVersionRef.current !== requestVersion) return;
        const message = caught instanceof Error ? caught.message : "未知错误";
        logError("load_tour_list_failed", { page: 1, filters, message });
        setTours([]);
        setError(message === "Request timeout" ? "请求超时，请稍后重试" : message);
      })
      .finally(() => {
        if (!canceled && requestVersionRef.current === requestVersion) setLoading(false);
      });
    return () => { canceled = true; };
  }, [filters]);

  const loadMore = useCallback(async () => {
    if (loading || loadMoreInFlightRef.current || page >= totalPages) return;
    const requestVersion = requestVersionRef.current;
    const nextPage = page + 1;
    loadMoreInFlightRef.current = true;
    setLoadingMore(true);
    try {
      const response = await getTours(nextPage, 20, {
        q: filters.q || undefined,
        year: filters.year ?? undefined,
        bandId: filters.bandId ?? undefined,
        sort: filters.sort,
      });
      if (requestVersionRef.current !== requestVersion) return;
      setTours((current) => {
        const existingIds = new Set(current.map((tour) => tour.tour_id));
        return [...current, ...response.items.filter((tour) => !existingIds.has(tour.tour_id))];
      });
      setTotal(response.pagination.total);
      setTotalPages(response.pagination.total_pages);
      setPage(response.pagination.page);
    } catch {
      // 下一批加载失败时保留当前已展示的巡演。
    } finally {
      if (requestVersionRef.current === requestVersion) {
        loadMoreInFlightRef.current = false;
        setLoadingMore(false);
      }
    }
  }, [filters, loading, page, totalPages]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMore();
      },
      { rootMargin: "300px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore]);

  return (
    <>
      <TourListFilters filters={filters} years={years} bands={bands} onChange={onFiltersChange} />
      <TourCardGrid
        tours={tours}
        loading={loading}
        loadingMore={loadingMore}
        error={error}
        total={total}
        hasMore={page < totalPages}
        sentinelRef={sentinelRef}
        onOpenTour={onOpenTour}
      />
    </>
  );
}
