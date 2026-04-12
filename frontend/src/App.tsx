import { useEffect, useMemo, useRef, useState } from "react";
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

const ROLE_PRIORITY: Record<string, number> = { viewer: 10, editor: 20, admin: 30 };

function canAccessConsole(role: string | null | undefined): boolean {
  const currentPriority = ROLE_PRIORITY[role ?? ""] ?? -1;
  return currentPriority >= ROLE_PRIORITY.editor;
}

const USER_AVATAR_COLORS = ["#5b7cfa", "#00a4a6", "#f59f00", "#e8590c", "#6c5ce7", "#2b8a3e"];

function getAvatarInitial(name: string | null | undefined): string {
  const text = name?.trim() ?? "";
  if (text === "") return "?";
  return [...text][0]?.toUpperCase() ?? "?";
}

function getAvatarColor(name: string | null | undefined): string {
  const text = name?.trim() || "unknown";
  let hash = 0;
  for (let idx = 0; idx < text.length; idx += 1) {
    hash = (hash * 31 + text.charCodeAt(idx)) >>> 0;
  }
  return USER_AVATAR_COLORS[hash % USER_AVATAR_COLORS.length];
}

function buildAvatarSvgDataUrl(initial: string, color: string): string {
  const escapedInitial = initial
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><rect width="40" height="40" rx="20" fill="${color}"/><text x="20" y="20" text-anchor="middle" dominant-baseline="central" fill="#ffffff" font-size="18" font-family="Segoe UI, Arial, sans-serif" font-weight="700">${escapedInitial}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
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
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const listSnapshotsRef = useRef<Record<string, ListSnapshot>>({});
  const favoritesReconcileGateRef = useRef(false);
  const userMenuRef = useRef<HTMLDivElement | null>(null);
  const listEnabled = tab !== "console" && !auth.isLoading;
  const canUseFavoriteFeatures = auth.isAuthenticated;
  const canUseConsoleFeatures = auth.isAuthenticated && canAccessConsole(auth.user?.role);

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
    // 双重兜底：即使通过控制台改状态把 tab 强行切到 console，角色不足也会立即回退。
    if (tab !== "console" || canUseConsoleFeatures) return;
    setTab("all");
    setPage(1);
  }, [canUseConsoleFeatures, tab]);

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

    // 列表加载状态机：优先命中页快照/收藏缓存，再回源；切 tab 时先清空旧列表避免残影。
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
  const showConsolePanel = tab === "console" && canUseConsoleFeatures;
  const rows = showConsolePanel ? [] : items;

  const total = serverTotal;
  const totalPages = serverTotalPages;
  const safePage = Math.min(page, totalPages);
  const pagedRows = rows;
  const pageLiveIds = tab === "all" ? pagedRows.map((row) => row.liveId) : [];
  const canBatchFavorite = canUseFavoriteFeatures && tab === "all" && pageLiveIds.length > 0;
  const pageAllFavorited =
    canBatchFavorite && pageLiveIds.every((liveId) => favorites.favoriteLiveIdSet.has(liveId));
  const batchFavoriteDesired = !pageAllFavorited;

  useEffect(() => {
    setJumpPageInput(String(safePage));
  }, [safePage]);

  useEffect(() => {
    if (!userMenuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (userMenuRef.current?.contains(target)) return;
      setUserMenuOpen(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setUserMenuOpen(false);
    };
    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [userMenuOpen]);

  const handlePageSizeChange = (value: 15 | 20) => {
    setPageSize(value);
    setPage(1);
  };

  // 页签切换统一做权限闸门，防止未登录或低权限用户进入受限页。
  const handleTabChange = (nextTab: TabKey) => {
    if (nextTab === "favorites" && !canUseFavoriteFeatures) {
      setLoginError(null);
      setLoginDialogOpen(true);
      return;
    }
    if (nextTab === "console") {
      if (!auth.isAuthenticated) {
        setLoginError(null);
        setLoginDialogOpen(true);
        return;
      }
      if (!canUseConsoleFeatures) {
        setTab("all");
        setPage(1);
        return;
      }
    }
    setTab(nextTab);
    setPage(1);
    setUserMenuOpen(false);
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

  // 仅对“当前页 liveId 集合”做批量意图切换，具体同步与失败收敛交给 FavoriteProvider。
  const toggleBatchFavorite = async () => {
    if (!canBatchFavorite) {
      return;
    }
    if (!auth.isAuthenticated) {
      setLoginError(null);
      setLoginDialogOpen(true);
      return;
    }
    try {
      await favorites.setFavoritesBatch(pageLiveIds, batchFavoriteDesired);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        auth.setAnonymous();
        setTab("all");
        setLoginDialogOpen(true);
      }
      logError("toggle_batch_favorite_failed", {
        desired: batchFavoriteDesired,
        count: pageLiveIds.length,
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
      setUserMenuOpen(false);
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
    setUserMenuOpen(false);
  };

  const userDisplayName = auth.user?.display_name ?? auth.user?.username ?? "用户";
  const userNameText = auth.user?.username ?? "unknown";
  const userRoleLabel = auth.user?.role ?? "member";
  const userAvatarSrc = useMemo(
    () => buildAvatarSvgDataUrl(getAvatarInitial(userDisplayName), getAvatarColor(userDisplayName)),
    [userDisplayName],
  );

  return (
    <main className="page">
      <section className="panel">
        <header className="panel-head">
          <h1>Live 信息统计</h1>
          <div className="auth-toolbar">
            {auth.isLoading ? (
              <span className="auth-status">登录态检查中...</span>
            ) : auth.isAuthenticated ? (
              <div className="user-menu-wrap" ref={userMenuRef}>
                <button
                  type="button"
                  className="user-menu-trigger"
                  aria-label={`用户菜单：${userDisplayName}`}
                  aria-expanded={userMenuOpen}
                  onClick={() => setUserMenuOpen((open) => !open)}
                >
                  <img className="user-avatar-img" src={userAvatarSrc} alt={`${userDisplayName} 图标`} />
                </button>
                {userMenuOpen && (
                  <div className="user-menu-dropdown" role="menu" aria-label="用户菜单">
                    <div className="user-menu-row user-name-row">
                      <img className="user-avatar-img user-menu-avatar" src={userAvatarSrc} alt="" aria-hidden="true" />
                      <span>{userDisplayName}</span>
                    </div>
                    <hr className="user-menu-divider" />
                    <div className="user-menu-row user-account-row">账户：{userNameText}</div>
                    <div className="user-menu-row user-role-row">角色：{userRoleLabel}</div>
                    <hr className="user-menu-divider" />
                    <a
                      href="#"
                      className="user-menu-logout-btn"
                      role="menuitem"
                      onClick={(event) => {
                        event.preventDefault();
                        void handleLogout();
                      }}
                    >
                      退出登录
                    </a>
                  </div>
                )}
              </div>
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
          {canUseConsoleFeatures && (
            <button
              className={`tab-btn ${tab === "console" ? "active" : ""}`}
              onClick={() => handleTabChange("console")}
            >
              控制台
            </button>
          )}
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
          <p className="tab-tip">登录后可使用收藏同步；控制台仅对 editor 及以上角色可见。</p>
        )}
        {favorites.favoriteSyncWarning && <p className="favorite-sync-warning">{favorites.favoriteSyncWarning}</p>}

        {!showConsolePanel ? (
          <>
            <div className="table-wrap">
              <table className={showFavoriteColumn ? "table-with-fav" : "table-no-fav"}>
                <thead>
                  <tr>
                    {showFavoriteColumn && (
                      <th>
                        <span className="fav-header-with-batch">
                          <span>收藏</span>
                          {canBatchFavorite && (
                            <button
                              type="button"
                              className={`batch-favorite-btn ${pageAllFavorited ? "is-fav-state" : "is-empty-state"}`}
                              onClick={() => void toggleBatchFavorite()}
                              title={batchFavoriteDesired ? "收藏本页" : "取消收藏本页"}
                              aria-label={batchFavoriteDesired ? "收藏本页" : "取消收藏本页"}
                            >
                              ★
                            </button>
                          )}
                        </span>
                      </th>
                    )}
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
