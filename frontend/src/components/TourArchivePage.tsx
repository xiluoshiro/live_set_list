import { useEffect, useState } from "react";

import { getTours, type CatalogBandItem, type TourSummary } from "../api";
import { logError } from "../logger";
import { TourCardGrid } from "./TourCardGrid";
import { TourListFilters, type TourFilters } from "./TourListFilters";

type TourArchivePageProps = {
  filters: TourFilters;
  page: number;
  years: number[];
  bands: CatalogBandItem[];
  onFiltersChange: (filters: TourFilters) => void;
  onPageChange: (page: number) => void;
  onOpenTour: (tour: TourSummary) => void;
};

export function TourArchivePage({
  filters,
  page,
  years,
  bands,
  onFiltersChange,
  onPageChange,
  onOpenTour,
}: TourArchivePageProps) {
  const [tours, setTours] = useState<TourSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;
    setLoading(true);
    setError(null);
    getTours(page, 20, {
      q: filters.q || undefined,
      year: filters.year ?? undefined,
      bandId: filters.bandId ?? undefined,
      sort: filters.sort,
    })
      .then((response) => {
        if (canceled) return;
        setTours(response.items);
        setTotal(response.pagination.total);
        setTotalPages(response.pagination.total_pages);
        if (response.pagination.page !== page) onPageChange(response.pagination.page);
      })
      .catch((caught) => {
        if (canceled) return;
        const message = caught instanceof Error ? caught.message : "未知错误";
        logError("load_tour_list_failed", { page, filters, message });
        setTours([]);
        setError(message === "Request timeout" ? "请求超时，请稍后重试" : message);
      })
      .finally(() => { if (!canceled) setLoading(false); });
    return () => { canceled = true; };
  }, [filters, onPageChange, page]);

  const hasFilters = filters.q !== "" || filters.year !== null || filters.bandId !== null;

  return (
    <>
      <TourListFilters filters={filters} years={years} bands={bands} onChange={onFiltersChange} />
      {hasFilters && !loading && !error && tours.length === 0 ? (
        <p className="tour-list-state">没有符合当前条件的巡演</p>
      ) : (
        <TourCardGrid
          tours={tours}
          loading={loading}
          error={error}
          total={total}
          page={page}
          totalPages={totalPages}
          onOpenTour={onOpenTour}
          onPageChange={onPageChange}
        />
      )}
    </>
  );
}
