import { useEffect, useRef, useState } from "react";
import { useAuth } from "./auth/AuthProvider";
import { BAND_ICON_COUNT, BandIconsCell, type BandIconInput } from "./components/BandIconsCell";
import { ConsoleInsertPanel } from "./components/ConsoleInsertPanel";
import { MemberStatusTable } from "./components/DetailMemberTable";
import { LoginDialog } from "./components/LoginDialog";
import {
  ApiError,
  clearMyFavoriteLivesCache,
  getLiveDetail,
  getLives,
  getMyFavoriteLives,
  peekMyFavoriteLives,
  type LiveDetailResponse,
  type LiveItem,
} from "./api";
import { useFavorites } from "./favorites/FavoriteProvider";
import { logError } from "./logger";
import {
  prefetchCurrentPageDetails,
  scheduleIdleFavoritePagePrefetch,
  scheduleIdleNextPagePrefetch,
} from "./prefetch/liveDetailsPrefetch";
import { useTheme, type ThemeMode } from "./theme/ThemeProvider";
import "./styles/index.css";

type LiveRow = {
  liveId: number;
  liveDate: string;
  liveTitle: string;
  icons: BandIconInput[];
  url: string | null;
};

type TabKey = "favorites" | "all" | "console";
type ListSnapshot = {
  items: LiveRow[];
  total: number;
  totalPages: number;
};

function formatTimedLabel(value: string | null | undefined): string {
  const raw = value?.trim();
  if (!raw) return "-";

  const match = raw.match(/^(\d{2}:\d{2})(?::\d{2})?(?:([+-]\d{2})(?::?(\d{2}))?)?$/);
  if (!match) return raw;

  const [, timePart, offsetHour, offsetMinute] = match;
  if (!offsetHour) return timePart;

  const normalizedOffset = `${offsetHour}:${offsetMinute ?? "00"}`;
  const timezoneLabelMap: Record<string, string> = {
    "+08:00": "CN",
    "+09:00": "JP",
  };
  const timezoneLabel = timezoneLabelMap[normalizedOffset] ?? `UTC${normalizedOffset}`;
  return `${timePart}(${timezoneLabel})`;
}

function getNextThemeMode(mode: ThemeMode): ThemeMode {
  if (mode === "system") return "dark";
  if (mode === "dark") return "light";
  return "system";
}

function getThemeToggleMeta(mode: ThemeMode, resolvedTheme: "light" | "dark") {
  if (mode === "system") {
    return {
      icon: "⦿",
      label: `当前跟随系统（${resolvedTheme === "dark" ? "夜间" : "浅色"}），单击锁定夜间模式`,
    };
  }
  if (mode === "dark") {
    return {
      icon: "☽",
      label: "当前夜间模式，单击切换到浅色模式",
    };
  }
  return {
    icon: "☀",
    label: "当前浅色模式，单击切换到跟随系统",
  };
}

function buildListSnapshotKey(tab: Exclude<TabKey, "console">, page: number, pageSize: 15 | 20): string {
  return `${tab}:${page}:${pageSize}`;
}

function App() {
  const auth = useAuth();
  const favorites = useFavorites();
  const { mode: themeMode, resolvedTheme, setMode: setThemeMode } = useTheme();
  const [pageSize, setPageSize] = useState<15 | 20>(20);
  const [page, setPage] = useState(1);
  const [jumpPageInput, setJumpPageInput] = useState("1");
  const [tab, setTab] = useState<TabKey>("all");
  const [activeRow, setActiveRow] = useState<LiveRow | null>(null);
  const [detailFullscreen, setDetailFullscreen] = useState(false);
  const [items, setItems] = useState<LiveRow[]>([]);
  const [serverTotal, setServerTotal] = useState(0);
  const [serverTotalPages, setServerTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [detailData, setDetailData] = useState<LiveDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const listSnapshotsRef = useRef<Record<string, ListSnapshot>>({});
  const favoritesReconcileGateRef = useRef(false);
  const listEnabled = tab !== "console" && !auth.isLoading;
  const canUseFavoriteFeatures = auth.isAuthenticated;

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
    if (canUseFavoriteFeatures || tab !== "favorites") return;
    setTab("all");
    setPage(1);
  }, [canUseFavoriteFeatures, tab]);

  useEffect(() => {
    if (tab !== "favorites" || !canUseFavoriteFeatures) {
      favoritesReconcileGateRef.current = false;
      return;
    }
    if (favoritesReconcileGateRef.current) return;
    favoritesReconcileGateRef.current = true;
    void favorites.reconcileFavorites().catch((error) => {
      if (error instanceof ApiError && error.status === 401) {
        auth.setAnonymous();
        setTab("all");
        favoritesReconcileGateRef.current = false;
      }
    });
  }, [auth, canUseFavoriteFeatures, favorites, tab]);

  useEffect(() => {
    // 登录用户切换或匿名/登录状态变化后，之前页签快照不再可信，直接清空。
    listSnapshotsRef.current = {};
  }, [auth.isAuthenticated, auth.user?.id]);

  useEffect(() => {
    // 收藏集合变化后，只清理收藏页快照；全量页星标显示由内存态实时驱动。
    const currentSnapshots = listSnapshotsRef.current;
    Object.keys(currentSnapshots).forEach((key) => {
      if (key.startsWith("favorites:")) {
        delete currentSnapshots[key];
      }
    });
    clearMyFavoriteLivesCache();
  }, [favorites.favoriteLiveIds]);

  useEffect(() => {
    if (!listEnabled) return;
    if (tab === "favorites" && !canUseFavoriteFeatures) return;
    let canceled = false;
    const requestedSnapshotKey = buildListSnapshotKey(tab, page, pageSize);
    const cachedSnapshot = listSnapshotsRef.current[requestedSnapshotKey];

    const fetchLives = async () => {
      if (cachedSnapshot) {
        setItems(cachedSnapshot.items);
        setServerTotal(cachedSnapshot.total);
        setServerTotalPages(cachedSnapshot.totalPages);
        setLoadError(null);
        setLoading(false);
        return;
      }
      const cachedFavoritePage =
        tab === "favorites" ? peekMyFavoriteLives(page, pageSize) : undefined;
      if (cachedFavoritePage) {
        const mappedItems = cachedFavoritePage.items.map(toLiveRow);
        setItems(mappedItems);
        setServerTotal(cachedFavoritePage.pagination.total);
        setServerTotalPages(cachedFavoritePage.pagination.total_pages);
        setLoadError(null);
        setLoading(false);
        listSnapshotsRef.current[requestedSnapshotKey] = {
          items: mappedItems,
          total: cachedFavoritePage.pagination.total,
          totalPages: cachedFavoritePage.pagination.total_pages,
        };
        if (cachedFavoritePage.pagination.page !== page) {
          setPage(cachedFavoritePage.pagination.page);
        }
        return;
      }

      setLoading(true);
      setLoadError(null);
      // 首次进入未缓存的页签/分页时，先清空上一轮列表，避免残留旧 tab 数据。
      setItems([]);
      setServerTotal(0);
      setServerTotalPages(1);
      try {
        const data = tab === "favorites" ? await getMyFavoriteLives(page, pageSize) : await getLives(page, pageSize);
        if (canceled) return;
        const mappedItems = data.items.map(toLiveRow);
        const canonicalPage = data.pagination.page;
        const canonicalSnapshotKey = buildListSnapshotKey(tab, canonicalPage, pageSize);
        listSnapshotsRef.current[canonicalSnapshotKey] = {
          items: mappedItems,
          total: data.pagination.total,
          totalPages: data.pagination.total_pages,
        };
        if (canonicalSnapshotKey !== requestedSnapshotKey) {
          delete listSnapshotsRef.current[requestedSnapshotKey];
        }
        setItems(mappedItems);
        setServerTotal(data.pagination.total);
        setServerTotalPages(data.pagination.total_pages);
        if (canonicalPage !== page) {
          setPage(canonicalPage);
        }
      } catch (error) {
        if (canceled) return;
        if (error instanceof ApiError && error.status === 401) {
          auth.setAnonymous();
          setTab("all");
        }
        const rawMessage = error instanceof Error ? error.message : "未知错误";
        const message = rawMessage === "Request timeout" ? "请求超时，请稍后重试" : rawMessage;
        logError("load_lives_failed", {
          page,
          pageSize,
          tab,
          message,
        });
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
  }, [canUseFavoriteFeatures, listEnabled, page, pageSize, tab]);

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
        is_favorite: isFavorite(row.liveId),
      })),
    ).catch(() => undefined);
    if (tab !== "all") {
      return () => undefined;
    }
    const cancelIdlePrefetch = scheduleIdleNextPagePrefetch({
      page: currentPage,
      pageSize,
      totalPages: serverTotalPages,
    });
    const cancelFavoritePrefetch = canUseFavoriteFeatures
      ? scheduleIdleFavoritePagePrefetch(pageSize)
      : () => undefined;
    return () => {
      cancelIdlePrefetch();
      cancelFavoritePrefetch();
    };
  }, [canUseFavoriteFeatures, items, page, pageSize, serverTotalPages, tab]);

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
        logError("load_live_detail_failed", {
          liveId: activeRow.liveId,
          message,
        });
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

  const isFavorite = (id: number) => favorites.favoriteLiveIdSet.has(id);
  const rows = tab === "console" ? [] : items;

  const total = serverTotal;
  const totalPages = serverTotalPages;
  const safePage = Math.min(page, totalPages);
  const pagedRows = rows;

  useEffect(() => {
    setJumpPageInput(String(safePage));
  }, [safePage]);

  const handlePageSizeChange = (value: 15 | 20) => {
    setPageSize(value);
    setPage(1);
  };

  const handleTabChange = (nextTab: TabKey) => {
    if (nextTab === "favorites" && !canUseFavoriteFeatures) {
      setLoginError(null);
      setLoginDialogOpen(true);
      return;
    }
    if (nextTab === "console" && !auth.isAuthenticated) {
      setLoginError(null);
      setLoginDialogOpen(true);
      return;
    }
    setTab(nextTab);
    setPage(1);
  };

  const commitJumpPage = () => {
    const parsed = Number.parseInt(jumpPageInput, 10);
    const fallbackPage = Number.isFinite(parsed) ? parsed : safePage;
    const nextPage = Math.min(totalPages, Math.max(1, fallbackPage));
    setPage(nextPage);
    setJumpPageInput(String(nextPage));
  };

  const showFavoriteColumn = tab === "all" && auth.isAuthenticated;

  const toggleFavorite = async (id: number) => {
    if (!auth.isAuthenticated) {
      setLoginError(null);
      setLoginDialogOpen(true);
      return;
    }
    try {
      // 收藏切换改由 AuthProvider 统一管理乐观意图与后台同步。
      await favorites.toggleFavorite(id);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        auth.setAnonymous();
        setTab("all");
        setLoginDialogOpen(true);
      }
      logError("toggle_favorite_failed", {
        liveId: id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
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
  const venueText = detailData?.venue?.trim() ? detailData.venue : "-";
  const openingTimeText = formatTimedLabel(detailData?.opening_time);
  const startTimeText = formatTimedLabel(detailData?.start_time);
  const detailUrl = detailData?.url ?? activeRow?.url ?? null;
  const toggleTheme = () => {
    setThemeMode(getNextThemeMode(themeMode));
  };
  const themeToggleMeta = getThemeToggleMeta(themeMode, resolvedTheme);

  const handleLoginSubmit = async (params: { username: string; password: string }) => {
    setLoginLoading(true);
    setLoginError(null);
    try {
      await auth.login(params.username, params.password);
      setLoginDialogOpen(false);
      setTab("all");
      setPage(1);
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : "登录失败，请稍后重试");
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await auth.logout();
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : "退出失败，请稍后重试");
      return;
    }
    setTab("all");
    setPage(1);
  };

  return (
    <main className="page">
      <section className="panel">
        <header className="panel-head">
          <h1>Live 信息统计</h1>
          <div className="auth-toolbar">
            {auth.isLoading ? (
              <span className="auth-status">登录态检查中...</span>
            ) : auth.isAuthenticated ? (
              <>
                <span className="auth-user">
                  <span>{auth.user?.display_name}</span>
                  <span className="auth-role-chip">{auth.user?.role}</span>
                </span>
                <button type="button" className="secondary-btn" onClick={() => void handleLogout()}>
                  退出登录
                </button>
              </>
            ) : (
              <button
                type="button"
                className="primary-btn"
                onClick={() => {
                  setLoginError(null);
                  setLoginDialogOpen(true);
                }}
              >
                登录
              </button>
            )}
          </div>
        </header>

        <nav className="tabs">
          {auth.isAuthenticated && (
            <button
              className={`tab-btn ${tab === "favorites" ? "active" : ""}`}
              onClick={() => handleTabChange("favorites")}
            >
              收藏
            </button>
          )}
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
          <button
            type="button"
            className="theme-icon-btn"
            onClick={toggleTheme}
            aria-label={themeToggleMeta.label}
            title={themeToggleMeta.label}
          >
            {themeToggleMeta.icon}
          </button>
        </nav>
        {!auth.isLoading && !auth.isAuthenticated && (
          <p className="tab-tip">登录后可使用收藏同步；未登录模式下不会显示收藏页签与星标入口。</p>
        )}
        {favorites.favoriteSyncWarning && <p className="favorite-sync-warning">{favorites.favoriteSyncWarning}</p>}

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
                            className={`star-btn ${isFavorite(row.liveId) ? "is-fav" : ""} ${favorites.isFavoriteSyncing(row.liveId) ? "is-syncing" : ""}`}
                            onClick={() => void toggleFavorite(row.liveId)}
                            title={isFavorite(row.liveId) ? "取消收藏" : "加入收藏"}
                            aria-label={isFavorite(row.liveId) ? "取消收藏" : "加入收藏"}
                            aria-busy={favorites.isFavoriteSyncing(row.liveId)}
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
              <div className="pager-controls">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage <= 1}>
                  上一页
                </button>
                <span className="pager-status">
                  第 {safePage} / {totalPages} 页
                </span>
                <label className="pager-jump">
                  跳转至第
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={jumpPageInput}
                    onChange={(e) => setJumpPageInput(e.target.value)}
                    onBlur={commitJumpPage}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        commitJumpPage();
                      }
                    }}
                  />
                  页
                </label>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={safePage >= totalPages}
                >
                  下一页
                </button>
              </div>
            </footer>
          </>
        ) : (
          <ConsoleInsertPanel />
        )}
      </section>

      {activeRow && (
        <div className="modal-mask" onClick={closeDetailModal}>
          <div
            className={`modal ${detailFullscreen ? "fullscreen" : ""}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <h2>
                {detailUrl ? (
                  <a href={detailUrl} target="_blank" rel="noreferrer" className="detail-title-link">
                    <span>{detailData?.live_title ?? activeRow.liveTitle}</span>
                    <span className="detail-title-link-icon" aria-hidden="true">
                      <svg viewBox="0 0 16 16" focusable="false">
                        <path
                          d="M6 3.5H3.5v9h9V10"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <path
                          d="M8 3.5h4.5V8"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <path
                          d="M7.5 8.5 12.5 3.5"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </span>
                  </a>
                ) : (
                  detailData?.live_title ?? activeRow.liveTitle
                )}
              </h2>
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
            <div className="detail-meta-line">
              <p className="detail-inline-item detail-inline-item-date">
                <strong>日期：</strong>
                <span>{detailData?.live_date ?? activeRow.liveDate}</span>
              </p>
              <p className="detail-inline-item">
                <strong>开场：</strong>
                <span>{openingTimeText}</span>
              </p>
              <p className="detail-inline-item">
                <strong>开演：</strong>
                <span>{startTimeText}</span>
              </p>
              <p className="detail-inline-item detail-inline-item-venue">
                <strong>场地：</strong>
                <span>{venueText}</span>
              </p>
            </div>
            <p className="detail-row">
              <strong>乐队：</strong>
              <span>{bandNamesText}</span>
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
      <LoginDialog
        open={loginDialogOpen}
        loading={loginLoading}
        error={loginError}
        onClose={() => {
          setLoginDialogOpen(false);
          setLoginError(null);
        }}
        onSubmit={handleLoginSubmit}
      />
    </main>
  );
}

export default App;
