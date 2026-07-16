import { useEffect, useId, useState } from "react";

import {
  type CatalogBandItem,
} from "../api";
import {
  DEFAULT_LIVE_LIST_FILTERS,
  hasActiveLiveListFilters,
  type LiveListFilters,
} from "../liveListFilters";
import { LIVE_TYPE_OPTIONS, formatLiveType } from "./console/constants";

type LiveListFiltersProps = {
  filters: LiveListFilters;
  years: number[];
  bands: CatalogBandItem[];
  onChange: (filters: LiveListFilters) => void;
};

export function LiveListFiltersToolbar({ filters, years, bands, onChange }: LiveListFiltersProps) {
  const [queryDraft, setQueryDraft] = useState(filters.q);
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
  const idPrefix = useId();

  useEffect(() => {
    setQueryDraft(filters.q);
  }, [filters.q]);

  const replaceFilters = (patch: Partial<LiveListFilters>) => {
    onChange({ ...filters, ...patch });
  };

  const activeSecondaryCount = [filters.year, filters.liveType, filters.bandId]
    .filter((value) => value !== null)
    .length;

  return (
    <section className="list-filter-panel" aria-label="Live 列表筛选">
      <form
        className="list-filter-form"
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
              placeholder="搜索 Live、乐队、歌曲或场地"
              onChange={(event) => setQueryDraft(event.target.value)}
            />
            <button type="submit">搜索</button>
          </span>
        </label>

        <button
          type="button"
          className="list-filter-mobile-toggle"
          aria-expanded={mobilePanelOpen}
          aria-controls={`${idPrefix}-secondary`}
          onClick={() => setMobilePanelOpen((open) => !open)}
        >
          筛选{activeSecondaryCount > 0 ? ` · ${activeSecondaryCount}` : ""}
        </button>

        <div
          id={`${idPrefix}-secondary`}
          className="list-filter-secondary"
          data-open={mobilePanelOpen}
        >
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

          <label className="list-filter-field" htmlFor={`${idPrefix}-live-type`}>
            <span>Live 类型</span>
            <select
              id={`${idPrefix}-live-type`}
              value={filters.liveType ?? ""}
              onChange={(event) => replaceFilters({ liveType: event.target.value || null })}
            >
              <option value="">全部类型</option>
              {LIVE_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
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
              {bands.map((band) => (
                <option key={band.band_id} value={band.band_id}>{band.band_name}</option>
              ))}
            </select>
          </label>
        </div>

        <label className="list-filter-field list-filter-sort" htmlFor={`${idPrefix}-sort`}>
          <span>排序</span>
          <select
            id={`${idPrefix}-sort`}
            value={filters.sort}
            onChange={(event) => replaceFilters({ sort: event.target.value as LiveListFilters["sort"] })}
          >
            <option value="date_desc">日期：新 → 旧</option>
            <option value="date_asc">日期：旧 → 新</option>
          </select>
        </label>
      </form>

      {hasActiveLiveListFilters(filters) && (
        <div className="list-active-filters" aria-label="当前筛选">
          <span>当前筛选</span>
          {filters.q && (
            <button type="button" onClick={() => replaceFilters({ q: "" })}>关键词：{filters.q} ×</button>
          )}
          {filters.year !== null && (
            <button type="button" onClick={() => replaceFilters({ year: null })}>{filters.year} ×</button>
          )}
          {filters.liveType !== null && (
            <button type="button" onClick={() => replaceFilters({ liveType: null })}>
              {formatLiveType(filters.liveType)} ×
            </button>
          )}
          {filters.bandId !== null && (
            <button type="button" onClick={() => replaceFilters({ bandId: null })}>
              {bands.find((band) => band.band_id === filters.bandId)?.band_name ?? `乐队 ${filters.bandId}`} ×
            </button>
          )}
          {filters.sort !== "date_desc" && (
            <button type="button" onClick={() => replaceFilters({ sort: "date_desc" })}>日期：旧 → 新 ×</button>
          )}
          <button
            type="button"
            className="list-filter-clear"
            onClick={() => onChange({ ...DEFAULT_LIVE_LIST_FILTERS })}
          >
            清除全部
          </button>
        </div>
      )}
    </section>
  );
}
