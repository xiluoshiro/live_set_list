import { useEffect, useMemo, useState } from "react";
import { BAND_ICON_COUNT, BandIconsCell, type BandIconInput } from "./components/BandIconsCell";
import { MemberStatusTable } from "./components/DetailMemberTable";
import { getLiveDetail, getLives, type LiveDetailResponse, type LiveItem } from "./api";
import { prefetchCurrentPageDetails, scheduleIdleNextPagePrefetch } from "./prefetch/liveDetailsPrefetch";
import "./styles/index.css";

type LiveRow = {
  liveId: number;
  liveDate: string;
  liveTitle: string;
  icons: BandIconInput[];
  url: string | null;
};

type TabKey = "favorites" | "all" | "console";
type FavoriteMap = Record<number, boolean>;

function App() {
  const [pageSize, setPageSize] = useState<15 | 20>(20);
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState<TabKey>("favorites");
  const [activeRow, setActiveRow] = useState<LiveRow | null>(null);
  const [detailFullscreen, setDetailFullscreen] = useState(false);
  const [favorites, setFavorites] = useState<FavoriteMap>({});
  const [items, setItems] = useState<LiveRow[]>([]);
  const [serverTotal, setServerTotal] = useState(0);
  const [serverTotalPages, setServerTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [detailData, setDetailData] = useState<LiveDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const listEnabled = tab !== "console";

  const toLiveRow = (item: LiveItem): LiveRow => ({
    liveId: item.live_id,
    liveDate: item.live_date,
    liveTitle: item.live_title,
    icons:
      item.bands && item.bands.length > 0
        ? item.bands
        : Array.from({ length: 1 }, (_, n) => ((n % BAND_ICON_COUNT) + 1).toString()),
    url: item.url,
  });

  useEffect(() => {
    if (!listEnabled) return;
    let canceled = false;

    const fetchLives = async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const data = await getLives(page, pageSize);
        if (canceled) return;
        setItems(data.items.map(toLiveRow));
        setServerTotal(data.pagination.total);
        setServerTotalPages(data.pagination.total_pages);
        if (data.pagination.page !== page) {
          setPage(data.pagination.page);
        }
      } catch (error) {
        if (canceled) return;
        const rawMessage = error instanceof Error ? error.message : "未知错误";
        const message = rawMessage === "Request timeout" ? "请求超时，请稍后重试" : rawMessage;
        setLoadError(message);
        setItems([]);
        setServerTotal(0);
        setServerTotalPages(1);
      } finally {
        if (!canceled) setLoading(false);
      }
    };

    fetchLives();
    return () => {
      canceled = true;
    };
  }, [page, pageSize, listEnabled]);

  useEffect(() => {
    const raw = localStorage.getItem("live-favorites-map");
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as FavoriteMap;
      setFavorites(parsed);
    } catch {
      setFavorites({});
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("live-favorites-map", JSON.stringify(favorites));
  }, [favorites]);

  useEffect(() => {
    if (tab === "console") return;
    if (items.length === 0) return;
    const currentPage = Math.min(page, serverTotalPages);
    // 标签切换或分页后，先预读当前页详情，再空闲预读下一页。
    void prefetchCurrentPageDetails(
      items.map((row) => ({
        live_id: row.liveId,
        live_date: row.liveDate,
        live_title: row.liveTitle,
        bands: row.icons,
        url: row.url,
      })),
    ).catch(() => undefined);
    const cancelIdlePrefetch = scheduleIdleNextPagePrefetch({
      page: currentPage,
      pageSize,
      totalPages: serverTotalPages,
    });
    return cancelIdlePrefetch;
  }, [items, page, pageSize, serverTotalPages, tab]);

  useEffect(() => {
    if (!activeRow) {
      setDetailData(null);
      setDetailLoading(false);
      setDetailError(null);
      return;
    }

    let canceled = false;
    const fetchDetail = async () => {
      setDetailLoading(true);
      setDetailError(null);
      setDetailData(null);
      try {
        const data = await getLiveDetail(activeRow.liveId);
        if (!canceled) {
          setDetailData(data);
        }
      } catch (error) {
        if (canceled) return;
        const rawMessage = error instanceof Error ? error.message : "未知错误";
        const message = rawMessage === "Request timeout" ? "请求超时，请稍后重试" : rawMessage;
        setDetailError(message);
      } finally {
        if (!canceled) {
          setDetailLoading(false);
        }
      }
    };

    fetchDetail();
    return () => {
      canceled = true;
    };
  }, [activeRow?.liveId]);

  const isFavorite = (id: number) => favorites[id] ?? true;
  const rows = useMemo(() => {
    if (tab === "favorites") {
      return items.filter((row) => isFavorite(row.liveId));
    }
    if (tab === "all") {
      return items;
    }
    return [];
  }, [favorites, items, tab]);

  const total = serverTotal;
  const totalPages = serverTotalPages;
  const safePage = Math.min(page, totalPages);
  const pagedRows = rows;

  const handlePageSizeChange = (value: 15 | 20) => {
    setPageSize(value);
    setPage(1);
  };

  const handleTabChange = (nextTab: TabKey) => {
    setTab(nextTab);
    setPage(1);
  };

  const showFavoriteColumn = tab === "all";

  const toggleFavorite = (id: number) => {
    setFavorites((prev) => ({
      ...prev,
      [id]: !(prev[id] ?? true),
    }));
  };

  const closeDetailModal = () => {
    setActiveRow(null);
    setDetailFullscreen(false);
    setDetailData(null);
    setDetailLoading(false);
    setDetailError(null);
  };
  const bandNamesText = detailData
    ? detailData.band_names.filter((name) => name.trim() !== "").join(" / ") || "-"
    : detailLoading
      ? "加载中..."
      : "-";

  return (
    <main className="page">
      <section className="panel">
        <header className="panel-head">
          <h1>Live 信息统计</h1>
          <div className="toolbar">
            <label>
              每页行数
              <select
                value={pageSize}
                onChange={(e) => handlePageSizeChange(Number(e.target.value) as 15 | 20)}
              >
                <option value={15}>15</option>
                <option value={20}>20</option>
              </select>
            </label>
            <span>总计 {total} 条</span>
          </div>
        </header>

        <nav className="tabs">
          <button
            className={`tab-btn ${tab === "favorites" ? "active" : ""}`}
            onClick={() => handleTabChange("favorites")}
          >
            收藏
          </button>
          <button
            className={`tab-btn ${tab === "all" ? "active" : ""}`}
            onClick={() => handleTabChange("all")}
          >
            全量
          </button>
          <button
            className={`tab-btn ${tab === "console" ? "active" : ""}`}
            onClick={() => handleTabChange("console")}
          >
            控制台
          </button>
        </nav>

        {tab !== "console" ? (
          <>
            <div className="table-wrap">
              <table className={showFavoriteColumn ? "table-with-fav" : "table-no-fav"}>
                <thead>
                  <tr>
                    {showFavoriteColumn && <th>收藏</th>}
                    <th>日期</th>
                    <th>Live 名称</th>
                    <th>乐队</th>
                    <th>URL</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedRows.map((row) => (
                    <tr key={row.liveId}>
                      {showFavoriteColumn && (
                        <td className="fav-col-cell">
                          <button
                            className={`star-btn ${isFavorite(row.liveId) ? "is-fav" : ""}`}
                            onClick={() => toggleFavorite(row.liveId)}
                            title={isFavorite(row.liveId) ? "取消收藏" : "加入收藏"}
                            aria-label={isFavorite(row.liveId) ? "取消收藏" : "加入收藏"}
                          >
                            ★
                          </button>
                        </td>
                      )}
                      <td>{row.liveDate}</td>
                      <td>
                        <button
                          className="name-btn"
                          onClick={() => setActiveRow(row)}
                          title={row.liveTitle}
                        >
                          {row.liveTitle}
                        </button>
                      </td>
                      <td className="band-cell" title={`${row.icons.length} 支乐队`}>
                        <BandIconsCell icons={row.icons} rowId={row.liveId} />
                      </td>
                      <td>
                        {row.url ? (
                          <a
                            href={row.url}
                            target="_blank"
                            rel="noreferrer"
                            className="url-icon-link"
                          >
                            🔗
                          </a>
                        ) : (
                          <span>-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {loadError && (
                    <tr>
                      <td colSpan={showFavoriteColumn ? 5 : 4} className="empty-cell">
                        数据加载失败: {loadError}
                      </td>
                    </tr>
                  )}
                  {!loadError && pagedRows.length === 0 && (
                    <tr>
                      <td colSpan={showFavoriteColumn ? 5 : 4} className="empty-cell">
                        {loading ? "加载中..." : "当前没有可展示的数据"}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <footer className="pager">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage <= 1}>
                上一页
              </button>
              <span>
                第 {safePage} / {totalPages} 页
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={safePage >= totalPages}
              >
                下一页
              </button>
            </footer>
          </>
        ) : (
          <section className="console-empty">控制台内容预留中</section>
        )}
      </section>

      {activeRow && (
        <div className="modal-mask" onClick={closeDetailModal}>
          <div
            className={`modal ${detailFullscreen ? "fullscreen" : ""}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <h2>{detailData?.live_title ?? activeRow.liveTitle}</h2>
              <div className="modal-actions">
                <button
                  type="button"
                  className="modal-action-btn fullscreen"
                  title={detailFullscreen ? "退出全屏" : "全屏"}
                  aria-label={detailFullscreen ? "退出全屏" : "全屏"}
                  onClick={() => setDetailFullscreen((v) => !v)}
                >
                  <span className="modal-action-glyph fullscreen">
                    {detailFullscreen ? "❐" : "⛶"}
                  </span>
                </button>
                <button
                  type="button"
                  className="modal-action-btn close"
                  title="关闭"
                  aria-label="关闭"
                  onClick={closeDetailModal}
                >
                  <span className="modal-action-glyph close">✕</span>
                </button>
              </div>
            </div>
            <p className="detail-row">
              <strong>日期：</strong>
              <span>{detailData?.live_date ?? activeRow.liveDate}</span>
            </p>
            <p className="detail-row">
              <strong>乐队：</strong>
              <span>{bandNamesText}</span>
            </p>
            <p className="detail-row">
              <strong>链接：</strong>
              <span>
                {(detailData?.url ?? activeRow.url) ? (
                  <a href={detailData?.url ?? activeRow.url ?? "#"} target="_blank" rel="noreferrer">
                    {detailData?.url ?? activeRow.url}
                  </a>
                ) : (
                  "-"
                )}
              </span>
            </p>

            <div className="detail-table-wrap">
              <MemberStatusTable
                rows={detailData?.detail_rows}
                loading={detailLoading}
                error={detailError}
                seed={activeRow.liveId}
              />
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default App;
