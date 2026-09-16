import { useEffect, useState } from "react";

import {
  getConsoleGeographyQuality,
  type GeographyQualityCategory,
  type GeographyQualityItem,
} from "../../api";

type Props = {
  onMessage: (message: string) => void;
  onOpenVenue: (venueId: number) => void;
  onOpenLive: (liveId: number) => void;
};

const CATEGORIES: Array<{ value: GeographyQualityCategory | "all"; label: string }> = [
  { value: "all", label: "全部问题" },
  { value: "missing_locality", label: "缺所在地" },
  { value: "missing_address", label: "缺门牌地址" },
  { value: "missing_coordinates", label: "缺坐标" },
  { value: "missing_timezone", label: "缺有效时区" },
  { value: "missing_coordinate_basis", label: "坐标缺口径" },
  { value: "zero_coordinates", label: "零坐标" },
  { value: "stale_map_link", label: "过期地图关联" },
  { value: "timezone_review", label: "Live 时区待复核" },
];

const categoryLabel = (value: GeographyQualityCategory) =>
  CATEGORIES.find((item) => item.value === value)?.label ?? value;

export function GeographyQualitySection({ onMessage, onOpenVenue, onOpenLive }: Props) {
  const [items, setItems] = useState<GeographyQualityItem[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [category, setCategory] = useState<GeographyQualityCategory | "all">("all");
  const [query, setQuery] = useState("");
  const [searchedQuery, setSearchedQuery] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);

  const load = async (nextCategory = category, nextQuery = searchedQuery, nextPage = page) => {
    setLoading(true);
    try {
      const result = await getConsoleGeographyQuality(nextCategory, nextQuery, nextPage);
      setItems(result.items);
      setCounts(result.counts);
      setPage(result.page);
      setTotal(result.total);
      setTotalPages(result.total_pages);
    } catch (error) {
      onMessage(`加载地理质量列表失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load("all", "", 1); }, []);

  const chooseCategory = (next: GeographyQualityCategory | "all") => {
    setCategory(next);
    setPage(1);
    void load(next, searchedQuery, 1);
  };

  return <section className="tour-admin-section" aria-label="Venue 地理数据质量中心">
    <div className="tour-admin-block">
      <h3>Venue 地理数据质量中心</h3>
      <p className="console-admin-hint">统计与明细使用同一只读口径；打开对应 Venue 或 Live 后由既有受审计流程修复，本页不批量改写资料。</p>
      <div className="tour-admin-toolbar live-admin-toolbar">
        <label>问题类型<select aria-label="地理质量问题类型" value={category} disabled={loading} onChange={(event) => chooseCategory(event.target.value as GeographyQualityCategory | "all")}>
          {CATEGORIES.map((option) => <option key={option.value} value={option.value}>
            {option.label}{option.value === "all" ? `（${Object.values(counts).reduce((sum, value) => sum + value, 0)}）` : `（${counts[option.value] ?? 0}）`}
          </option>)}
        </select></label>
        <label>Venue / Live<input aria-label="搜索地理质量问题" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => {
          if (event.key === "Enter") { const next = query.trim(); setSearchedQuery(next); setPage(1); void load(category, next, 1); }
        }} /></label>
        <button type="button" className="console-ghost-btn" disabled={loading} onClick={() => {
          const next = query.trim(); setSearchedQuery(next); setPage(1); void load(category, next, 1);
        }}>查询</button>
      </div>

      {items.length === 0 && !loading ? <p className="console-admin-hint">当前筛选下没有质量问题。</p> : <div className="console-table-wrap">
        <table className="console-admin-table live-history-table" aria-label="Venue 地理质量问题列表">
          <thead><tr><th>类型</th><th>对象</th><th>所在地</th><th>问题</th><th>操作</th></tr></thead>
          <tbody>{items.map((item) => <tr key={`${item.category}-${item.subject_type}-${item.subject_id}`}>
            <td>{categoryLabel(item.category)}</td>
            <td>{item.subject_type === "live" ? `Live #${item.subject_id}` : `Venue #${item.subject_id}`}<br />
              {item.live_date ? `${item.live_date} ` : ""}{item.live_title ?? item.venue_name ?? "未命名"}</td>
            <td>{item.locality_label ?? "未登记"}</td>
            <td>{item.detail}</td>
            <td>{item.subject_type === "live"
              ? <button type="button" className="console-ghost-btn" onClick={() => onOpenLive(item.subject_id)}>打开 Live</button>
              : <button type="button" className="console-ghost-btn" onClick={() => onOpenVenue(item.subject_id)}>打开 Venue</button>}
            </td>
          </tr>)}</tbody>
        </table>
      </div>}
      <div className="tour-candidate-pager">
        <button type="button" className="console-ghost-btn" disabled={loading || page <= 1} onClick={() => void load(category, searchedQuery, page - 1)}>上一页</button>
        <span>第 {page} / {Math.max(1, totalPages)} 页，共 {total} 项</span>
        <button type="button" className="console-ghost-btn" disabled={loading || page >= totalPages} onClick={() => void load(category, searchedQuery, page + 1)}>下一页</button>
      </div>
    </div>
  </section>;
}
