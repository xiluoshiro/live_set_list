import { useEffect, useId, useState } from "react";

import type { CatalogBandItem, TourListFilters as ApiTourListFilters } from "../api";

export type TourFilters = {
  q: string;
  year: number | null;
  bandId: number | null;
  sort: NonNullable<ApiTourListFilters["sort"]>;
};

export const DEFAULT_TOUR_FILTERS: TourFilters = {
  q: "",
  year: null,
  bandId: null,
  sort: "date_desc",
};

type TourListFiltersProps = {
  filters: TourFilters;
  years: number[];
  bands: CatalogBandItem[];
  onChange: (filters: TourFilters) => void;
};

export function TourListFilters({ filters, years, bands, onChange }: TourListFiltersProps) {
  const [queryDraft, setQueryDraft] = useState(filters.q);
  const idPrefix = useId();

  useEffect(() => setQueryDraft(filters.q), [filters.q]);

  const replaceFilters = (patch: Partial<TourFilters>) => onChange({ ...filters, ...patch });
  const hasActiveFilters = filters.q !== "" || filters.year !== null
    || filters.bandId !== null || filters.sort !== "date_desc";

  return (
    <section className="list-filter-panel tour-filter-panel" aria-label="巡演列表筛选">
      <form
        className="list-filter-form tour-filter-form"
        onSubmit={(event) => {
          event.preventDefault();
          replaceFilters({ q: queryDraft.trim() });
        }}
      >
        <label className="list-filter-field list-filter-query" htmlFor={`${idPrefix}-query`}>
          <span>关键词</span>
          <span className="list-filter-query-row">
            <input
              id={`${idPrefix}-query`}
              type="search"
              value={queryDraft}
              placeholder="搜索巡演或关联 Live"
              onChange={(event) => setQueryDraft(event.target.value)}
            />
            <button type="submit">搜索</button>
          </span>
        </label>
        <div className="list-filter-secondary tour-filter-secondary">
          <label className="list-filter-field" htmlFor={`${idPrefix}-year`}>
            <span>年份</span>
            <select
              id={`${idPrefix}-year`}
              value={filters.year ?? ""}
              onChange={(event) => replaceFilters({ year: event.target.value ? Number(event.target.value) : null })}
            >
              <option value="">全部年份</option>
              {years.map((year) => <option key={year} value={year}>{year}</option>)}
            </select>
          </label>
          <label className="list-filter-field" htmlFor={`${idPrefix}-band`}>
            <span>乐队 / 艺人</span>
            <select
              id={`${idPrefix}-band`}
              value={filters.bandId ?? ""}
              onChange={(event) => replaceFilters({ bandId: event.target.value ? Number(event.target.value) : null })}
            >
              <option value="">全部乐队</option>
              {bands.map((band) => <option key={band.band_id} value={band.band_id}>{band.band_name}</option>)}
            </select>
          </label>
        </div>
        <label className="list-filter-field list-filter-sort tour-filter-sort" htmlFor={`${idPrefix}-sort`}>
          <span>排序</span>
          <select
            id={`${idPrefix}-sort`}
            value={filters.sort}
            onChange={(event) => replaceFilters({ sort: event.target.value as TourFilters["sort"] })}
          >
            <option value="date_desc">日期：新 → 旧</option>
            <option value="date_asc">日期：旧 → 新</option>
          </select>
        </label>
      </form>
      {hasActiveFilters && (
        <div className="list-active-filters" aria-label="当前筛选">
          <span>当前筛选</span>
          {filters.q && <button type="button" onClick={() => replaceFilters({ q: "" })}>关键词：{filters.q} ×</button>}
          {filters.year !== null && <button type="button" onClick={() => replaceFilters({ year: null })}>{filters.year} ×</button>}
          {filters.bandId !== null && (
            <button type="button" onClick={() => replaceFilters({ bandId: null })}>
              {bands.find((band) => band.band_id === filters.bandId)?.band_name ?? `乐队 ${filters.bandId}`} ×
            </button>
          )}
          {filters.sort !== "date_desc" && <button type="button" onClick={() => replaceFilters({ sort: "date_desc" })}>日期：旧 → 新 ×</button>}
          <button type="button" className="list-filter-clear" onClick={() => onChange({ ...DEFAULT_TOUR_FILTERS })}>清除全部</button>
        </div>
      )}
    </section>
  );
}
