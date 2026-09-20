import { useEffect, useState } from "react";

import {
  getConsoleVenue,
  getConsoleVenuePage,
  type ConsoleVenueDetail,
  type ConsoleVenueItem,
} from "../../api";
import { VenueCreateSection } from "./VenueCreateSection";
import { VenueLocationPanel } from "./VenueLocationPanel";

type VenueAdminSectionProps = {
  variant: "create" | "edit";
  onMessage: (message: string) => void;
  onVenuesChanged: () => Promise<void>;
  onOpenLive?: (liveId: number) => void;
  initialVenueId?: number | null;
  initialCreateName?: string;
};

const VENUE_PAGE_SIZE = 20;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function dateText(value: string | null, emptyText: string): string {
  return value ?? emptyText;
}

export function VenueAdminSection({ variant, onMessage, onVenuesChanged, onOpenLive, initialVenueId, initialCreateName }: VenueAdminSectionProps) {
  const [venues, setVenues] = useState<ConsoleVenueItem[]>([]);
  const [selectedVenueId, setSelectedVenueId] = useState<number | null>(null);
  const [detail, setDetail] = useState<ConsoleVenueDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailGeneration, setDetailGeneration] = useState(0);
  const [detailLoadFailed, setDetailLoadFailed] = useState(false);
  const [venueQuery, setVenueQuery] = useState("");
  const [searchedVenueQuery, setSearchedVenueQuery] = useState("");
  const [venuePage, setVenuePage] = useState(1);
  const [venueTotal, setVenueTotal] = useState(0);
  const [venueTotalPages, setVenueTotalPages] = useState(1);
  const applyDetail = (nextDetail: ConsoleVenueDetail) => { setDetail(nextDetail); setDetailGeneration(value => value + 1); };

  const loadDetail = async (venueId: number) => {
    setSelectedVenueId(venueId);
    setLoading(true);
    setDetailLoadFailed(false);
    try {
      applyDetail(await getConsoleVenue(venueId));
    } catch (error) {
      setDetail(null);
      setDetailLoadFailed(true);
      onMessage(`加载 Venue 详情失败：${errorMessage(error)}`);
    } finally {
      setLoading(false);
    }
  };

  const loadVenuePage = async (query: string, page: number, preferredVenueId?: number) => {
    setLoading(true);
    try {
      const response = await getConsoleVenuePage(query, page, VENUE_PAGE_SIZE);
      const items = response.items;
      setVenues(items);
      setSearchedVenueQuery(query);
      setVenuePage(response.page ?? page);
      setVenueTotal(response.total ?? items.length);
      setVenueTotalPages(response.total_pages ?? 1);

      const nextVenueId = preferredVenueId && items.some((item) => item.venue_id === preferredVenueId)
        ? preferredVenueId
        : selectedVenueId && items.some((item) => item.venue_id === selectedVenueId)
          ? selectedVenueId
          : items[0]?.venue_id ?? null;
      setSelectedVenueId(nextVenueId);
      if (nextVenueId === null) {
        setDetail(null);
        setDetailLoadFailed(false);
      } else {
        setDetailLoadFailed(false);
        try {
          applyDetail(await getConsoleVenue(nextVenueId));
        } catch (error) {
          setDetail(null);
          setDetailLoadFailed(true);
          onMessage(`加载 Venue 详情失败：${errorMessage(error)}`);
        }
      }
    } catch (error) {
      onMessage(`加载 Venue 列表失败：${errorMessage(error)}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (variant !== "edit") return;
    if (initialVenueId) {
      void getConsoleVenue(initialVenueId).then((target) => {
        setVenueQuery(target.venue_name);
        return loadVenuePage(target.venue_name, 1, initialVenueId);
      }).catch((error) => onMessage(`加载 Venue 详情失败：${errorMessage(error)}`));
      return;
    }
    void loadVenuePage("", 1);
  }, [variant, initialVenueId]);

  return (
    <section className="tour-admin-section" aria-label={variant === "create" ? "新增场馆" : "场馆管理"}>
      {variant === "edit" && <>
      <div className="tour-admin-toolbar live-admin-toolbar venue-admin-toolbar">
        <span className="live-management-label">已有 Venue</span>
        <input
          id="venue-admin-query"
          className="venue-query-input live-management-primary-control"
          aria-label="搜索场馆"
          value={venueQuery}
          onChange={(event) => setVenueQuery(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") void loadVenuePage(venueQuery.trim(), 1); }}
        />
        <button type="button" className="console-ghost-btn" disabled={loading} onClick={() => void loadVenuePage(venueQuery.trim(), 1)}>查询</button>
        <select
          id="venue-admin-select"
          aria-label="已有 Venue"
          value={selectedVenueId ?? ""}
          disabled={loading || venues.length === 0}
          onChange={(event) => void loadDetail(Number(event.target.value))}
        >
          {venues.length === 0 && <option value="">暂无 Venue</option>}
          {venues.map((venue) => (
            <option key={venue.venue_id} value={venue.venue_id}>#{venue.venue_id} {venue.venue_name}</option>
          ))}
        </select>
        <div className="tour-candidate-pager">
          <button type="button" className="console-ghost-btn" disabled={loading || venuePage <= 1} onClick={() => void loadVenuePage(searchedVenueQuery, venuePage - 1)}>上一页</button>
          <span>第 {venuePage} / {Math.max(1, venueTotalPages)} 页，共 {venueTotal} 个场馆</span>
          <button type="button" className="console-ghost-btn" disabled={loading || venuePage >= venueTotalPages} onClick={() => void loadVenuePage(searchedVenueQuery, venuePage + 1)}>下一页</button>
        </div>
      </div>

      {venues.length === 0 && !loading && (
        <p className="console-admin-hint">
          暂无可管理的 Venue。
        </p>
      )}

      {detailLoadFailed && selectedVenueId !== null && !loading && (
        <p className="console-admin-hint">
          当前 Venue 详情加载失败。<button type="button" className="console-ghost-btn" onClick={() => void loadDetail(selectedVenueId)}>重试详情</button>
        </p>
      )}

      </>}

      {variant === "create" && <VenueCreateSection initialName={initialCreateName} onMessage={onMessage} onVenuesChanged={onVenuesChanged} />}

      {variant === "edit" && detail && (
        <>
          <VenueLocationPanel
            key={`${detail.venue_id}:${detailGeneration}`}
            venueId={detail.venue_id}
            venueName={detail.venue_name}
            venueKind={detail.venue_kind}
            onOpenLive={onOpenLive}
            detail={detail}
            onSaved={async saved => {
              setDetail(saved);
              setVenues(items => items.map(item => item.venue_id === saved.venue_id ? { ...item, ...saved } : item));
              await onVenuesChanged();
            }}
          />
          <div className="tour-admin-block">
            <h3>历史名称（只读）</h3>
            <div className="console-table-wrap">
              <table className="console-admin-table entity-history-table" aria-label="Venue 历史名称">
                <thead><tr><th>ID</th><th>名称</th><th>有效期</th><th>引用 Live</th><th>改期历史</th></tr></thead>
                <tbody>{detail.name_versions.map((version) => (
                  <tr key={version.venue_name_version_id}>
                    <td>{version.venue_name_version_id}</td>
                    <td>{version.venue_name}</td>
                    <td>{dateText(version.valid_from, "起始未记录")} → {dateText(version.valid_to, "开放")}</td>
                    <td>{version.live_count}</td>
                    <td>{version.schedule_history_count}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>

        </>
      )}

    </section>
  );
}
