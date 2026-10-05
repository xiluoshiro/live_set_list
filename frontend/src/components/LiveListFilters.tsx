import { useEffect, useId, useState, type ReactNode } from "react";
import type { CatalogBandItem } from "../api";
import { DEFAULT_LIVE_LIST_FILTERS, hasActiveLiveListFilters, type LiveListFilters } from "../liveListFilters";
import { LIVE_TYPE_OPTIONS, formatLiveType } from "./console/constants";

const STATUS_OPTIONS = [
  { value: "upcoming", label: "待举行" }, { value: "today", label: "进行中" },
  { value: "past", label: "已结束" }, { value: "postponed", label: "延期" },
  { value: "cancelled", label: "已取消" },
] as const;

type FilterChangeProps = { filters: LiveListFilters; onChange: (filters: LiveListFilters) => void };

export function LiveListSearch({ filters, onChange, resetKey = 0 }: FilterChangeProps & { resetKey?: number }) {
  const [queryDraft, setQueryDraft] = useState(filters.q);
  useEffect(() => { setQueryDraft(filters.q); }, [filters.q, resetKey]);
  return (
    <form className="home-search-row page-heading-search" role="search" aria-label="搜索演出"
      onSubmit={(event) => { event.preventDefault(); onChange({ ...filters, q: queryDraft.trim() }); }}>
      <input type="search" aria-label="关键词" value={queryDraft} placeholder="搜索 Live、乐队、歌曲或场馆"
        onChange={(event) => {
          setQueryDraft(event.target.value);
          if (!event.target.value && filters.q) onChange({ ...filters, q: "" });
        }} />
      <button type="submit">搜索</button>
    </form>
  );
}

export function LiveListFiltersToolbar({ filters, years, bands, onChange, onClear, summary }: FilterChangeProps & {
  years: number[]; bands: CatalogBandItem[]; onClear?: () => void; summary?: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const replaceFilters = (patch: Partial<LiveListFilters>) => onChange({ ...filters, ...patch });
  const count = [filters.year, filters.liveType, filters.bandId, filters.status ?? null,
    filters.sort !== "date_desc" ? filters.sort : null].filter(value => value !== null).length;
  return (
    <section className="list-filter-panel live-filter-panel" aria-label="Live 列表筛选">
      <div className="live-filter-toolbar">
        {summary}
        <button type="button" className="live-filter-toggle" aria-expanded={expanded} aria-controls={`${id}-fields`}
          onClick={() => setExpanded(open => !open)}>
          {expanded ? "收起筛选" : "展开筛选"}{count ? ` (${count})` : ""}
        </button>
      </div>
      <div className="live-filter-fields" id={`${id}-fields`} hidden={!expanded}>
        <label className="list-filter-field"><span>年份</span>
          <select value={filters.year ?? ""} onChange={e => replaceFilters({ year: e.target.value ? Number(e.target.value) : null })}>
            <option value="">全部年份</option>{years.map(year => <option key={year} value={year}>{year}</option>)}
          </select>
        </label>
        <label className="list-filter-field"><span>乐队 / 艺人</span>
          <select value={filters.bandId ?? ""} onChange={e => replaceFilters({ bandId: e.target.value ? Number(e.target.value) : null })}>
            <option value="">全部乐队</option>{bands.map(band => <option key={band.band_id} value={band.band_id}>{band.band_name}</option>)}
          </select>
        </label>
        <label className="list-filter-field"><span>Live 类型</span>
          <select value={filters.liveType ?? ""} onChange={e => replaceFilters({ liveType: e.target.value || null })}>
            <option value="">全部类型</option>{LIVE_TYPE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="list-filter-field"><span>状态</span>
          <select value={filters.status ?? ""} onChange={e => replaceFilters({ status: (e.target.value || null) as LiveListFilters["status"] })}>
            <option value="">全部状态</option>{STATUS_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="list-filter-field"><span>排序</span>
          <select value={filters.sort} onChange={e => replaceFilters({ sort: e.target.value as LiveListFilters["sort"] })}>
            <option value="date_desc">日期：新 → 旧</option><option value="date_asc">日期：旧 → 新</option>
          </select>
        </label>
      </div>
      {hasActiveLiveListFilters(filters) && (
        <div className="list-active-filters" aria-label="当前筛选">
          {filters.q && <button type="button" onClick={() => replaceFilters({ q: "" })}>关键词：{filters.q} ×</button>}
          {filters.year !== null && <button type="button" onClick={() => replaceFilters({ year: null })}>{filters.year} ×</button>}
          {filters.bandId !== null && <button type="button" onClick={() => replaceFilters({ bandId: null })}>
            {bands.find(b => b.band_id === filters.bandId)?.band_name ?? `乐队 ${filters.bandId}`} ×</button>}
          {filters.liveType !== null && <button type="button" onClick={() => replaceFilters({ liveType: null })}>{formatLiveType(filters.liveType)} ×</button>}
          {filters.status && <button type="button" onClick={() => replaceFilters({ status: null })}>{STATUS_OPTIONS.find(s => s.value === filters.status)?.label} ×</button>}
          {filters.sort !== "date_desc" && <button type="button" onClick={() => replaceFilters({ sort: "date_desc" })}>日期：旧 → 新 ×</button>}
          <button type="button" className="list-filter-clear" onClick={() => onClear ? onClear() : onChange({ ...DEFAULT_LIVE_LIST_FILTERS })}>清除全部</button>
        </div>
      )}
    </section>
  );
}
