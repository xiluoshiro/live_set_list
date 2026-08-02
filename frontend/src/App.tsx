import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  clearLiveDataCaches,
  clearMyFavoriteLivesCache,
  getCatalogBandLives,
  getCatalogBands,
  getCatalogStats,
  getCatalogStatistics,
  getLives,
  getPerformances,
  searchCatalog,
  type CatalogBandItem,
  type CatalogBandLivesResponse,
  type CatalogSearchResponse,
  type CatalogStatsResponse,
  type CatalogStatisticsFilters,
  type CatalogStatisticsResponse,
  type StatisticsScope,
  type LiveItem,
  type PerformanceGroupRef,
  type PerformanceGroupSummary,
  type PerformanceItem,
  type TourRef,
  type TourSummary,
  type DatePhase,
  type EventStatus,
} from "./api";
import { useAuth } from "./auth/AuthProvider";
import { ExternalLinkIcon } from "./components/ActionIcons";
import { BandIconsCell, type BandIconInput } from "./components/BandIconsCell";
import {
  AboutPanel,
  BandBrowsePanel,
  type CatalogLiveRow,
  SearchResultsPanel,
} from "./components/CatalogPanels";
import { ConsoleInsertPanel } from "./components/ConsoleInsertPanel";
import { ContentState } from "./components/ContentState";
import { HomeDashboard, type HomeLiveRow } from "./components/HomeDashboard";
import { PageTitle } from "./components/PageTitle";
import { formatPerformanceDate, LiveCardGrid } from "./components/LiveCardGrid";
import { StageLedgerPage } from "./components/StageLedgerPage";
import { LiveListFiltersToolbar } from "./components/LiveListFilters";
import { LiveTypeBadge } from "./components/LiveTypeBadge";
import { LoginDialog } from "./components/LoginDialog";
import { StatisticsPanel } from "./components/StatisticsPanel";
import { TourArchivePage } from "./components/TourArchivePage";
import { TourDetailPage, type TourDetailFallback } from "./components/TourDetailPage";
import { PerformanceGroupDetailPage } from "./components/PerformanceGroupDetailPage";
import { DEFAULT_TOUR_FILTERS, type TourFilters } from "./components/TourListFilters";
import { ViewModeToggle } from "./components/ViewModeToggle";
import { formatLiveType } from "./components/console/constants";
import { useFavorites } from "./favorites/FavoriteProvider";
import {
  DEFAULT_LIVE_LIST_FILTERS,
  hasActiveLiveListFilters,
  liveListFiltersKey,
  type LiveListFilters,
} from "./liveListFilters";
import { logError } from "./logger";
import {
  formatLiveStatusText,
  getLiveStatusPresentation,
  getPerformanceGroupStatusPresentation,
} from "./liveStatus";
import {
  CONSOLE_LIVE_CHANGE_STORAGE_KEY,
  parseConsoleLiveChange,
} from "./consoleLiveSync";
import {
  prefetchCurrentPageDetails,
  scheduleIdleFavoritePagePrefetch,
  scheduleIdleNextPagePrefetch,
} from "./prefetch/liveDetailsPrefetch";
import { useTheme, type ThemeMode } from "./theme/ThemeProvider";
import "./styles/index.css";

type DisplayRow = {
  kind: "live" | "performance_group";
  liveId: number;
  liveDate: string;
  liveTitle: string;
  liveType: string;
  icons: BandIconInput[];
  url: string | null;
  groupId: number | null;
  groupTitle: string | null;
  groupStartDate: string | null;
  groupEndDate: string | null;
  groupDayCount: number | null;
  groupLiveCount: number | null;
  groupCancelledLiveCount: number | null;
  groupDisplayType: "single_day_multi_show" | "multi_day" | null;
  groupIcons: BandIconInput[];
  groupVenues: string[];
  eventStatus: EventStatus | null;
  datePhase: DatePhase | null;
  wasRescheduled: boolean;
};

type LiveDetailFallback = {
  liveTitle: string;
  liveDate: string;
  url: string | null;
};

type TabKey = "home" | "favorites" | "all" | "tours" | "tour_detail" | "performance_group_detail" | "statistics" | "console" | "search" | "browse" | "about" | "detail";
type ListTabKey = "favorites" | "all";
type MainTabKey = Exclude<TabKey, "detail" | "tour_detail" | "performance_group_detail">;
type AppHistoryState = {
  app: "live-set-list";
  tab: TabKey;
  previousTab?: Exclude<TabKey, "detail">;
  detailLiveId?: number;
  detailFallback?: LiveDetailFallback;
  detailTourId?: number;
  tourFallback?: TourDetailFallback;
  detailGroupId?: number;
  detailGroupLiveId?: number;
  groupFallback?: { groupTitle: string };
  searchQuery?: string;
  catalogBandId?: number | null;
  listState?: {
    page: number;
    cardPage: number;
    scrollY: number;
  };
};
type ListSnapshot = {
  items: DisplayRow[];
  total: number;
  totalPages: number;
};
type CardListSession = ListSnapshot & {
  cardPage: number;
};

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

function buildListSnapshotKey(
  tab: ListTabKey,
  page: number,
  pageSize: 15 | 20,
  filtersKey = "",
): string {
  return `${tab}:${filtersKey}:${page}:${pageSize}`;
}

function toPerformanceFilters(filters: LiveListFilters): Record<string, string | number | undefined> {
  return {
    q: filters.q || undefined,
    year: filters.year ?? undefined,
    live_type: filters.liveType ?? undefined,
    band_id: filters.bandId ?? undefined,
    sort: filters.sort,
  };
}

function displayRowKey(row: DisplayRow): string {
  return row.kind === "performance_group" ? `performance_group:${row.groupId}` : `live:${row.liveId}`;
}

function isAppHistoryState(value: unknown): value is AppHistoryState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AppHistoryState>;
  return candidate.app === "live-set-list" && typeof candidate.tab === "string";
}

function getLiveIdFromPath(pathname: string): number | null {
  const match = pathname.match(/^\/lives\/(\d+)\/?$/);
  if (!match) return null;
  const liveId = Number(match[1]);
  return Number.isInteger(liveId) && liveId > 0 ? liveId : null;
}

const ROLE_PRIORITY: Record<string, number> = { viewer: 10, editor: 20, admin: 30 };

function canAccessConsole(role: string | null | undefined): boolean {
  const currentPriority = ROLE_PRIORITY[role ?? ""] ?? -1;
  return currentPriority >= ROLE_PRIORITY.editor;
}

const USER_AVATAR_COLORS = ["#f31864", "#d41558", "#ff6f9f", "#7c5cff", "#2b8a3e", "#e8590c"];

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

function resetPageScroll(): void {
  if (window.scrollY !== 0) {
    window.scrollTo(0, 0);
  }
}

function App() {
  const auth = useAuth();
  const favorites = useFavorites();
  const { mode: themeMode, resolvedTheme, setMode: setThemeMode } = useTheme();
  const initialLiveId = getLiveIdFromPath(window.location.pathname);
  const [pageSize, setPageSize] = useState<15 | 20>(20);
  const [viewMode, setViewMode] = useState<"table" | "cards">(() => {
    const stored = localStorage.getItem("live-view-mode");
    return stored === "table" ? "table" : "cards";
  });
  const [cardPage, setCardPage] = useState(1);
  const [cardLoadingMore, setCardLoadingMore] = useState(false);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const [page, setPage] = useState(1);
  const [listFilters, setListFilters] = useState<LiveListFilters>({ ...DEFAULT_LIVE_LIST_FILTERS });
  const [listFilterBands, setListFilterBands] = useState<CatalogBandItem[]>([]);
  const [jumpPageInput, setJumpPageInput] = useState("1");
  const [tab, setTab] = useState<TabKey>(initialLiveId === null ? "home" : "detail");
  const [detailLiveId, setDetailLiveId] = useState<number | null>(initialLiveId);
  const [detailFallback, setDetailFallback] = useState<LiveDetailFallback | null>(
    initialLiveId === null
      ? null
      : { liveTitle: `Live #${initialLiveId}`, liveDate: "", url: null },
  );
  const [previousTab, setPreviousTab] = useState<Exclude<TabKey, "detail">>("home");
  const [detailTourId, setDetailTourId] = useState<number | null>(null);
  const [tourFallback, setTourFallback] = useState<TourDetailFallback | null>(null);
  const [detailGroupId, setDetailGroupId] = useState<number | null>(null);
  const [detailGroupLiveId, setDetailGroupLiveId] = useState<number | null>(null);
  const [groupFallback, setGroupFallback] = useState<{ groupTitle: string } | null>(null);
  const [tourFilters, setTourFilters] = useState<TourFilters>({ ...DEFAULT_TOUR_FILTERS });
  const [items, setItems] = useState<DisplayRow[]>([]);
  const [serverTotal, setServerTotal] = useState(0);
  const [serverTotalPages, setServerTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [homeRecentRows, setHomeRecentRows] = useState<DisplayRow[]>([]);
  const [homeLiveTotal, setHomeLiveTotal] = useState(0);
  const [homeLoading, setHomeLoading] = useState(false);
  const [homeError, setHomeError] = useState<string | null>(null);
  const [homeRefreshKey, setHomeRefreshKey] = useState(0);
  const [liveDataRevision, setLiveDataRevision] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResult, setSearchResult] = useState<CatalogSearchResponse | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [catalogBands, setCatalogBands] = useState<CatalogBandItem[]>([]);
  const [catalogBandsLoading, setCatalogBandsLoading] = useState(false);
  const [catalogBandLives, setCatalogBandLives] = useState<CatalogBandLivesResponse | null>(null);
  const [catalogBandLivesLoading, setCatalogBandLivesLoading] = useState(false);
  const [catalogBrowseError, setCatalogBrowseError] = useState<string | null>(null);
  const [selectedCatalogBandId, setSelectedCatalogBandId] = useState<number | null>(null);
  const [catalogBandPage, setCatalogBandPage] = useState(1);
  const [catalogStats, setCatalogStats] = useState<CatalogStatsResponse | null>(null);
  const [statisticsScope, setStatisticsScope] = useState<StatisticsScope>("all");
  const [statisticsFilters, setStatisticsFilters] = useState<CatalogStatisticsFilters>({});
  const [statisticsData, setStatisticsData] = useState<CatalogStatisticsResponse | null>(null);
  const [statisticsLoading, setStatisticsLoading] = useState(false);
  const [statisticsError, setStatisticsError] = useState<string | null>(null);
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [navDrawerOpen, setNavDrawerOpen] = useState(false);
  const listSnapshotsRef = useRef<Record<string, ListSnapshot>>({});
  const favoritesReconcileGateRef = useRef(false);
  const userMenuRef = useRef<HTMLDivElement | null>(null);
  const cardSessionsRef = useRef<Record<string, CardListSession>>({});
  const activeCardSessionKeyRef = useRef<string | null>(null);
  const cardLoadInFlightRef = useRef(false);
  const pendingScrollRestoreRef = useRef<number | null>(null);
  const activeTabRef = useRef<TabKey>(tab);
  const preserveListDuringLiveRefreshRef = useRef(false);
  const preserveHomeDuringLiveRefreshRef = useRef(false);
  const lastHandledConsoleLiveChangeNonceRef = useRef<string | null>(
    parseConsoleLiveChange(
      window.localStorage.getItem(CONSOLE_LIVE_CHANGE_STORAGE_KEY),
    )?.nonce ?? null,
  );
  activeTabRef.current = tab;
  const listEnabled = (tab === "all" || tab === "favorites") && !auth.isLoading;
  const canUseFavoriteFeatures = auth.isAuthenticated;
  const canUseConsoleFeatures = auth.isAuthenticated && canAccessConsole(auth.user?.role);
  const navigationItems: Array<{ key: TabKey; label: string; visible: boolean }> = [
    { key: "all", label: "演出资料", visible: true },
    { key: "tours", label: "巡演资料", visible: true },
    { key: "statistics", label: "数据统计", visible: true },
    { key: "browse", label: "乐队浏览", visible: true },
    { key: "about", label: "联系我们", visible: true },
    { key: "console", label: "控制台", visible: canUseConsoleFeatures },
  ];
  const currentListFiltersKey = liveListFiltersKey(listFilters);
  const listFiltersActive = hasActiveLiveListFilters(listFilters);

  const getCardSessionKey = (listTab: ListTabKey) => (
    buildListSnapshotKey(listTab, 1, pageSize, currentListFiltersKey)
  );

  const captureCurrentListState = (state: AppHistoryState): AppHistoryState => {
    if (tab !== "all" && tab !== "favorites") return state;
    return {
      ...state,
      listState: {
        page,
        cardPage,
        scrollY: window.scrollY,
      },
    };
  };

  const applyHistoryState = (state: AppHistoryState) => {
    const requestedTab = state.tab;
    const allowedTab = requestedTab === "favorites" && !canUseFavoriteFeatures
      ? "home"
      : requestedTab === "console" && !canUseConsoleFeatures
        ? "home"
        : requestedTab;
    setUserMenuOpen(false);
    if (allowedTab === "detail" && state.detailLiveId && state.detailFallback && state.previousTab) {
      resetPageScroll();
      setDetailLiveId(state.detailLiveId);
      setDetailFallback(state.detailFallback);
      setPreviousTab(state.previousTab);
      setTab("detail");
      return;
    }
    if (allowedTab === "tour_detail" && state.detailTourId && state.tourFallback) {
      resetPageScroll();
      setDetailTourId(state.detailTourId);
      setTourFallback(state.tourFallback);
      setDetailLiveId(null);
      setDetailFallback(null);
      setDetailGroupId(null);
      setDetailGroupLiveId(null);
      setGroupFallback(null);
      setTab("tour_detail");
      return;
    }
    if (allowedTab === "performance_group_detail" && state.detailGroupId && state.groupFallback) {
      resetPageScroll();
      setDetailGroupId(state.detailGroupId);
      setDetailGroupLiveId(state.detailGroupLiveId ?? null);
      setGroupFallback(state.groupFallback);
      setDetailLiveId(null);
      setDetailFallback(null);
      setDetailTourId(null);
      setTourFallback(null);
      setTab("performance_group_detail");
      return;
    }
    setDetailLiveId(null);
    setDetailFallback(null);
    setDetailTourId(null);
    setTourFallback(null);
    setDetailGroupId(null);
    setDetailGroupLiveId(null);
    setGroupFallback(null);
    const nextTab = allowedTab === "detail" || allowedTab === "tour_detail" || allowedTab === "performance_group_detail" ? "home" : allowedTab;
    if (nextTab === "all" || nextTab === "favorites") {
      const restoredPage = state.listState?.page ?? 1;
      const restoredCardPage = state.listState?.cardPage ?? 1;
      setPage(restoredPage);
      setCardPage(restoredCardPage);
      pendingScrollRestoreRef.current = state.listState?.scrollY ?? null;
    } else {
      setPage(1);
      pendingScrollRestoreRef.current = null;
    }
    setTab(nextTab);
    if (state.searchQuery !== undefined) setSearchQuery(state.searchQuery);
    if (state.catalogBandId !== undefined) setSelectedCatalogBandId(state.catalogBandId);
  };

  const pushHistoryState = (state: AppHistoryState) => {
    if (isAppHistoryState(window.history.state)) {
      window.history.replaceState(captureCurrentListState(window.history.state), "", window.location.href);
    }
    const nextPath = state.tab === "detail" && state.detailLiveId
      ? `/lives/${state.detailLiveId}`
      : "/";
    window.history.pushState(state, "", nextPath);
    applyHistoryState(state);
  };

  const navigateToTab = (nextTab: MainTabKey, extras: Pick<AppHistoryState, "searchQuery" | "catalogBandId"> = {}) => {
    pushHistoryState({ app: "live-set-list", tab: nextTab, ...extras });
  };

  const openLiveDetail = (row: DisplayRow | CatalogLiveRow | HomeLiveRow, sourceTab: Exclude<TabKey, "detail"> = tab as Exclude<TabKey, "detail">) => {
    const fallback = { liveTitle: row.liveTitle, liveDate: row.liveDate, url: "url" in row ? row.url : null };
    pushHistoryState({
      app: "live-set-list",
      tab: "detail",
      previousTab: sourceTab,
      detailLiveId: row.liveId,
      detailFallback: fallback,
    });
  };

  const openTourDetail = (tour: TourSummary | TourRef) => {
    pushHistoryState({
      app: "live-set-list",
      tab: "tour_detail",
      detailTourId: tour.tour_id,
      tourFallback: { tourTitle: tour.tour_title },
    });
  };

  const openPerformanceGroupDetail = (
    group: PerformanceGroupRef | PerformanceGroupSummary,
    sourceLiveId?: number,
  ) => {
    pushHistoryState({
      app: "live-set-list",
      tab: "performance_group_detail",
      detailGroupId: group.group_id,
      detailGroupLiveId: sourceLiveId,
      groupFallback: { groupTitle: group.group_title },
    });
  };

  useEffect(() => {
    if (!isAppHistoryState(window.history.state)) {
      if (initialLiveId !== null) {
        const directState = {
          app: "live-set-list",
          tab: "detail",
          previousTab: "home",
          detailLiveId: initialLiveId,
          detailFallback: { liveTitle: `Live #${initialLiveId}`, liveDate: "", url: null },
        } satisfies AppHistoryState;
        window.history.replaceState(directState, "", window.location.href);
        applyHistoryState(directState);
      } else {
        window.history.replaceState({ app: "live-set-list", tab: "home" } satisfies AppHistoryState, "", window.location.href);
      }
    }
    const onPopState = (event: PopStateEvent) => {
      if (isAppHistoryState(event.state)) {
        applyHistoryState(event.state);
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [canUseConsoleFeatures, canUseFavoriteFeatures, initialLiveId]);

  const toLiveRow = (item: LiveItem): DisplayRow => ({
    kind: "live",
    liveId: item.live_id,
    liveDate: item.live_date,
    liveTitle: item.live_title,
    liveType: item.live_type,
    icons: item.bands ?? [],
    url: item.url,
    groupId: item.performance_group?.group_id ?? null,
    groupTitle: item.performance_group?.group_title ?? null,
    groupStartDate: null,
    groupEndDate: null,
    groupDayCount: null,
    groupLiveCount: null,
    groupCancelledLiveCount: null,
    groupDisplayType: null,
    groupIcons: [],
    groupVenues: [],
    eventStatus: item.event_status ?? "scheduled",
    datePhase: item.date_phase ?? "past",
    wasRescheduled: item.was_rescheduled ?? false,
  });

  const performancesToDisplayRows = (pageItems: PerformanceItem[]): DisplayRow[] =>
    pageItems.map((item): DisplayRow => {
      if (item.kind === "live") {
        const live = item.live;
        return {
          kind: "live",
          liveId: live.live_id,
          liveDate: live.live_date,
          liveTitle: live.live_title,
          liveType: live.live_type,
          icons: live.bands ?? [],
          url: live.url,
          groupId: live.performance_group?.group_id ?? null,
          groupTitle: live.performance_group?.group_title ?? null,
          groupStartDate: null,
          groupEndDate: null,
          groupDayCount: null,
          groupLiveCount: null,
          groupCancelledLiveCount: null,
          groupDisplayType: null,
          groupIcons: [],
          groupVenues: [],
          eventStatus: live.event_status ?? "scheduled",
          datePhase: live.date_phase ?? "past",
          wasRescheduled: live.was_rescheduled ?? false,
        };
      }
      const pg = item.performance_group;
      return {
        kind: "performance_group",
        liveId: pg.group_id,
        liveDate: pg.start_date,
        liveTitle: pg.group_title,
        liveType: pg.display_type === "single_day_multi_show" ? "单日多场" : "多日活动",
        icons: [],
        url: null,
        groupId: pg.group_id,
        groupTitle: pg.group_title,
        groupStartDate: pg.start_date,
        groupEndDate: pg.end_date,
        groupDayCount: pg.day_count,
        groupLiveCount: pg.live_count,
        groupCancelledLiveCount: pg.cancelled_live_count ?? 0,
        groupDisplayType: pg.display_type,
        groupIcons: pg.bands.map((b) => b.band_id),
        groupVenues: pg.venues,
        eventStatus: null,
        datePhase: null,
        wasRescheduled: false,
      };
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
        setTab("home");
        favoritesReconcileGateRef.current = false;
      }
    });
  }, [auth, canUseFavoriteFeatures, favorites, tab]);

  useEffect(() => {
    // 登录用户切换或匿名/登录状态变化后，之前页签快照不再可信，直接清空。
    listSnapshotsRef.current = {};
    cardSessionsRef.current = {};
  }, [auth.isAuthenticated, auth.user?.id]);

  useEffect(() => {
    // 收藏集合变化后，只清理收藏页快照；全量页星标显示由内存态实时驱动。
    const currentSnapshots = listSnapshotsRef.current;
    Object.keys(currentSnapshots).forEach((key) => {
      if (key.startsWith("favorites:")) {
        delete currentSnapshots[key];
      }
    });
    Object.keys(cardSessionsRef.current).forEach((key) => {
      if (key.startsWith("favorites:")) {
        delete cardSessionsRef.current[key];
      }
    });
    clearMyFavoriteLivesCache();
  }, [favorites.projectionVersion]);

  useEffect(() => {
    if (auth.isLoading) return;
    let canceled = false;
    const preserveVisibleRows = preserveHomeDuringLiveRefreshRef.current && homeRecentRows.length > 0;
    preserveHomeDuringLiveRefreshRef.current = false;

    const fetchHomeRecentLives = async () => {
      setHomeLoading(!preserveVisibleRows);
      setHomeError(null);
      try {
        const data = await getLives(1, 15);
        if (canceled) return;
        setHomeRecentRows(data.items.map(toLiveRow));
        setHomeLiveTotal(data.pagination.total);
      } catch (error) {
        if (canceled) return;
        const rawMessage = error instanceof Error ? error.message : "未知错误";
        const message = rawMessage === "Request timeout" ? "请求超时，请稍后重试" : rawMessage;
        logError("load_home_recent_lives_failed", {
          page: 1,
          pageSize: 15,
          message,
        });
        if (!preserveVisibleRows) {
          setHomeRecentRows([]);
          setHomeLiveTotal(0);
        }
        setHomeError(message);
      } finally {
        if (!canceled) setHomeLoading(false);
      }
    };

    void fetchHomeRecentLives();
    return () => {
      canceled = true;
    };
  }, [auth.isLoading, auth.isAuthenticated, auth.user?.id, homeRefreshKey]);

  useEffect(() => {
    if (tab !== "search" || searchQuery.trim() === "") return;
    let canceled = false;

    const fetchSearchResult = async () => {
      setSearchLoading(true);
      setSearchError(null);
      try {
        const data = await searchCatalog(searchQuery, 8);
        if (!canceled) setSearchResult(data);
      } catch (error) {
        if (canceled) return;
        const rawMessage = error instanceof Error ? error.message : "未知错误";
        const message = rawMessage === "Request timeout" ? "请求超时，请稍后重试" : rawMessage;
        logError("catalog_search_failed", {
          query: searchQuery,
          message,
        });
        setSearchResult(null);
        setSearchError(message);
      } finally {
        if (!canceled) setSearchLoading(false);
      }
    };

    void fetchSearchResult();
    return () => {
      canceled = true;
    };
  }, [liveDataRevision, searchQuery, tab]);

  useEffect(() => {
    if (tab !== "browse") return;
    let canceled = false;

    const fetchCatalogBands = async () => {
      setCatalogBandsLoading(true);
      setCatalogBrowseError(null);
      try {
        const data = await getCatalogBands(30);
        if (canceled) return;
        setCatalogBands(data.items);
        if (selectedCatalogBandId === null && data.items.length > 0) {
          setSelectedCatalogBandId(data.items[0].band_id);
        }
      } catch (error) {
        if (canceled) return;
        const rawMessage = error instanceof Error ? error.message : "未知错误";
        const message = rawMessage === "Request timeout" ? "请求超时，请稍后重试" : rawMessage;
        logError("catalog_bands_failed", { message });
        setCatalogBands([]);
        setCatalogBrowseError(message);
      } finally {
        if (!canceled) setCatalogBandsLoading(false);
      }
    };

    void fetchCatalogBands();
    return () => {
      canceled = true;
    };
  }, [selectedCatalogBandId, tab]);

  useEffect(() => {
    if (tab !== "browse" || selectedCatalogBandId === null) {
      setCatalogBandLives(null);
      return;
    }
    let canceled = false;

    const fetchBandLives = async () => {
      setCatalogBandLivesLoading(true);
      setCatalogBrowseError(null);
      try {
        const data = await getCatalogBandLives(selectedCatalogBandId, catalogBandPage, pageSize);
        if (!canceled) setCatalogBandLives(data);
      } catch (error) {
        if (canceled) return;
        const rawMessage = error instanceof Error ? error.message : "未知错误";
        const message = rawMessage === "Request timeout" ? "请求超时，请稍后重试" : rawMessage;
        logError("catalog_band_lives_failed", {
          bandId: selectedCatalogBandId,
          page: catalogBandPage,
          message,
        });
        setCatalogBandLives(null);
        setCatalogBrowseError(message);
      } finally {
        if (!canceled) setCatalogBandLivesLoading(false);
      }
    };

    void fetchBandLives();
    return () => {
      canceled = true;
    };
  }, [catalogBandPage, liveDataRevision, pageSize, selectedCatalogBandId, tab]);

  useEffect(() => {
    if (tab !== "home" && tab !== "all" && tab !== "favorites" && tab !== "statistics") return;
    let canceled = false;
    const fetchStats = async () => {
      try {
        const stats = await getCatalogStats();
        if (!canceled) setCatalogStats(stats);
      } catch {
        if (!canceled) setCatalogStats(null);
      }
    };
    void fetchStats();
    return () => {
      canceled = true;
    };
  }, [tab]);

  useEffect(() => {
    if (!listEnabled && tab !== "statistics") return;
    let canceled = false;

    const fetchListFilterBands = async () => {
      try {
        const data = await getCatalogBands(100);
        if (!canceled) setListFilterBands(data.items);
      } catch {
        if (!canceled) setListFilterBands([]);
      }
    };

    void fetchListFilterBands();
    return () => {
      canceled = true;
    };
  }, [listEnabled, tab]);

  useEffect(() => {
    if (tab !== "statistics") return;
    if (statisticsScope === "favorites" && !auth.isAuthenticated) return;
    let canceled = false;
    const fetchStatistics = async () => {
      setStatisticsLoading(true);
      setStatisticsError(null);
      try {
        const data = await getCatalogStatistics(statisticsScope, statisticsFilters);
        if (!canceled) setStatisticsData(data);
      } catch (error) {
        if (canceled) return;
        if (error instanceof ApiError && error.status === 401) auth.setAnonymous();
        setStatisticsData(null);
        setStatisticsError(error instanceof Error ? error.message : "统计加载失败");
      } finally {
        if (!canceled) setStatisticsLoading(false);
      }
    };
    void fetchStatistics();
    return () => { canceled = true; };
  }, [auth, statisticsFilters, statisticsScope, tab]);

  useEffect(() => {
    if (!listEnabled) return;
    if (tab === "favorites" && !canUseFavoriteFeatures) return;
    let canceled = false;
    const requestedSnapshotKey = buildListSnapshotKey(tab, page, pageSize, currentListFiltersKey);
    const cachedSnapshot = listSnapshotsRef.current[requestedSnapshotKey];
    const cardSessionKey = getCardSessionKey(tab as ListTabKey);
    const cachedCardSession = viewMode === "cards" ? cardSessionsRef.current[cardSessionKey] : undefined;
    const preserveVisibleItems = preserveListDuringLiveRefreshRef.current && items.length > 0;
    preserveListDuringLiveRefreshRef.current = false;

    // 列表加载状态机：普通导航无缓存时清空旧列表；控制台变更回源时保留可点击的当前列表。
    const fetchLives = async () => {
      if (cachedCardSession && cachedCardSession.cardPage >= cardPage) {
        setItems(cachedCardSession.items);
        setServerTotal(cachedCardSession.total);
        setServerTotalPages(cachedCardSession.totalPages);
        setCardPage(cachedCardSession.cardPage);
        setLoadError(null);
        setLoading(false);
        return;
      }
      if (cachedSnapshot) {
        setItems(cachedSnapshot.items);
        setServerTotal(cachedSnapshot.total);
        setServerTotalPages(cachedSnapshot.totalPages);
        setLoadError(null);
        setLoading(false);
        if (viewMode === "cards") {
          cardSessionsRef.current[cardSessionKey] = {
            ...cachedSnapshot,
            cardPage: page,
          };
          setCardPage(page);
        }
        return;
      }
      setLoading(!preserveVisibleItems);
      setLoadError(null);
      if (!preserveVisibleItems) {
        setItems([]);
        setServerTotal(0);
        setServerTotalPages(1);
      }
      try {
        const scope = tab === "favorites" ? "favorites" as const : "all" as const;
        const performFilters = toPerformanceFilters(listFilters);
        const data = listFiltersActive
          ? await getPerformances(page, pageSize, scope, performFilters)
          : await getPerformances(page, pageSize, scope);
        if (canceled) return;
        const mappedItems = performancesToDisplayRows(data.items);
        const canonicalPage = data.pagination.page;
        const canonicalSnapshotKey = buildListSnapshotKey(tab, canonicalPage, pageSize, currentListFiltersKey);
        listSnapshotsRef.current[canonicalSnapshotKey] = {
          items: mappedItems,
          total: data.pagination.total,
          totalPages: data.pagination.total_pages,
        };
        if (viewMode === "cards") {
          cardSessionsRef.current[cardSessionKey] = {
            items: mappedItems,
            total: data.pagination.total,
            totalPages: data.pagination.total_pages,
            cardPage: canonicalPage,
          };
          setCardPage(canonicalPage);
        }
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
          setTab("home");
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
        if (!preserveVisibleItems) {
          setItems([]);
          setServerTotal(0);
          setServerTotalPages(1);
        }
      } finally {
        if (!canceled) setLoading(false);
      }
    };

    fetchLives();
    return () => {
      canceled = true;
    };
  }, [
    canUseFavoriteFeatures,
    currentListFiltersKey,
    listEnabled,
    listFilters,
    listFiltersActive,
    liveDataRevision,
    page,
    pageSize,
    tab,
    viewMode,
    tab === "favorites" ? favorites.projectionVersion : 0,
  ]);

  useEffect(() => {
    if (tab !== "all" && tab !== "favorites") return;
    if (items.length === 0) return;
    const currentPage = Math.min(page, serverTotalPages);
    // 标签切换或分页后，先预读当前页详情，再空闲预读下一页。
    void prefetchCurrentPageDetails(
      items.filter((row) => row.kind === "live").map((row) => ({
        live_id: row.liveId,
        live_date: row.liveDate,
        live_title: row.liveTitle,
        live_type: row.liveType,
        bands: row.icons,
        url: row.url,
        is_favorite: isFavorite(row.liveId),
      })),
    ).catch(() => undefined);
    if (tab !== "all" || listFiltersActive) {
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
  }, [canUseFavoriteFeatures, items, listFiltersActive, page, pageSize, serverTotalPages, tab]);

  const isFavorite = (id: number) => favorites.favoriteLiveIdSet.has(id);
  const showConsolePanel = tab === "console" && canUseConsoleFeatures;
  const showHomePanel = tab === "home";
  const showListPanel = tab === "all" || tab === "favorites";
  const showTourListPanel = tab === "tours";
  const showTourDetailPanel = tab === "tour_detail";
  const showPerformanceGroupDetailPanel = tab === "performance_group_detail";
  const showSearchPanel = tab === "search";
  const showBrowsePanel = tab === "browse";
  const showStatisticsPanel = tab === "statistics";
  const showAboutPanel = tab === "about";
  const rows = showListPanel ? items : [];

  const total = serverTotal;
  const totalPages = serverTotalPages;
  const safePage = Math.min(page, totalPages);
  const pagedRows = rows;
  const pageLiveIds = tab === "all" ? pagedRows.filter((row) => row.kind === "live").map((row) => row.liveId) : [];
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

  const handleListFiltersChange = (nextFilters: LiveListFilters) => {
    setListFilters(nextFilters);
    setPage(1);
    setCardPage(1);
    setItems([]);
    setLoadError(null);
    pendingScrollRestoreRef.current = null;
  };

  const handleTourFiltersChange = (nextFilters: TourFilters) => {
    setTourFilters(nextFilters);
  };

  const handleConsoleLiveDataChanged = useCallback(() => {
    const latestChange = parseConsoleLiveChange(
      window.localStorage.getItem(CONSOLE_LIVE_CHANGE_STORAGE_KEY),
    );
    if (latestChange) {
      lastHandledConsoleLiveChangeNonceRef.current = latestChange.nonce;
    }
    preserveListDuringLiveRefreshRef.current = (
      activeTabRef.current === "all" || activeTabRef.current === "favorites"
    );
    preserveHomeDuringLiveRefreshRef.current = activeTabRef.current === "home";
    listSnapshotsRef.current = {};
    cardSessionsRef.current = {};
    clearLiveDataCaches();
    setHomeError(null);
    setHomeRefreshKey((key) => key + 1);
    setLiveDataRevision((revision) => revision + 1);
  }, []);

  useEffect(() => {
    const refreshIfConsoleLiveChanged = (raw: string | null) => {
      const change = parseConsoleLiveChange(raw);
      if (!change || change.nonce === lastHandledConsoleLiveChangeNonceRef.current) return;
      lastHandledConsoleLiveChangeNonceRef.current = change.nonce;
      handleConsoleLiveDataChanged();
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === CONSOLE_LIVE_CHANGE_STORAGE_KEY) {
        refreshIfConsoleLiveChanged(event.newValue);
      }
    };
    const handleFocus = () => {
      refreshIfConsoleLiveChanged(
        window.localStorage.getItem(CONSOLE_LIVE_CHANGE_STORAGE_KEY),
      );
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshIfConsoleLiveChanged(
          window.localStorage.getItem(CONSOLE_LIVE_CHANGE_STORAGE_KEY),
        );
      }
    };
    window.addEventListener("storage", handleStorage);
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [handleConsoleLiveDataChanged]);

  const handleCatalogSearch = (query: string) => {
    navigateToTab("search", { searchQuery: query });
    setSearchResult(null);
    setSearchError(null);
  };

  const handleCatalogBandSelect = (bandId: number) => {
    setCatalogBandPage(1);
    navigateToTab("browse", { catalogBandId: bandId });
  };

  const handleStatisticsScopeChange = (scope: StatisticsScope) => {
    if (scope === "favorites" && !auth.isAuthenticated) {
      setLoginError(null);
      setLoginDialogOpen(true);
      return;
    }
    setStatisticsScope(scope);
  };

  const openCatalogLive = (row: CatalogLiveRow) => {
    openLiveDetail(row);
  };

  // 页签切换统一做权限闸门，防止未登录或低权限用户进入受限页。
  const handleTabChange = (nextTab: TabKey) => {
    setNavDrawerOpen(false);
    if (nextTab === "detail" || nextTab === "tour_detail" || nextTab === "performance_group_detail") return;
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
        setTab("home");
        setPage(1);
        return;
      }
    }
    navigateToTab(nextTab);
  };

  const commitJumpPage = () => {
    const parsed = Number.parseInt(jumpPageInput, 10);
    const fallbackPage = Number.isFinite(parsed) ? parsed : safePage;
    const nextPage = Math.min(totalPages, Math.max(1, fallbackPage));
    setPage(nextPage);
    setJumpPageInput(String(nextPage));
  };

  const handleViewModeChange = async (mode: "table" | "cards") => {
    setViewMode(mode);
    localStorage.setItem("live-view-mode", mode);
    if (mode === "table") {
      setCardPage(1);
      setPage(1);
      setItems([]);
      setLoading(true);
      setLoadError(null);
      try {
        const scope = tab === "favorites" ? "favorites" as const : "all" as const;
        const performFilters = toPerformanceFilters(listFilters);
        const data = listFiltersActive
          ? await getPerformances(1, pageSize, scope, performFilters)
          : await getPerformances(1, pageSize, scope);
        setItems(performancesToDisplayRows(data.items));
        setServerTotal(data.pagination.total);
        setServerTotalPages(data.pagination.total_pages);
        setPage(data.pagination.page);
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          auth.setAnonymous();
          setTab("home");
          return;
        }
        setLoadError(error instanceof Error ? error.message : "未知错误");
      } finally {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    activeCardSessionKeyRef.current = viewMode === "cards" && (tab === "all" || tab === "favorites")
      ? getCardSessionKey(tab)
      : null;
  }, [currentListFiltersKey, pageSize, tab, viewMode]);

  useEffect(() => {
    if (pendingScrollRestoreRef.current === null) return;
    if (tab !== "all" && tab !== "favorites") return;
    if (loading || items.length === 0) return;
    const scrollY = pendingScrollRestoreRef.current;
    pendingScrollRestoreRef.current = null;
    if (scrollY <= 0) return;
    const frameId = window.requestAnimationFrame(() => window.scrollTo(0, scrollY));
    return () => window.cancelAnimationFrame(frameId);
  }, [items.length, loading, tab]);

  useEffect(() => {
    if (tab !== "all" && tab !== "favorites") {
      setShowBackToTop(false);
      return;
    }
    const syncVisibility = () => setShowBackToTop(window.scrollY > 360);
    syncVisibility();
    window.addEventListener("scroll", syncVisibility, { passive: true });
    return () => window.removeEventListener("scroll", syncVisibility);
  }, [tab]);

  const scrollBackToTop = () => {
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    window.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
  };

  const loadMoreCards = useCallback(async () => {
    if (tab !== "all" && tab !== "favorites") return;
    const sessionKey = getCardSessionKey(tab);
    const session = cardSessionsRef.current[sessionKey];
    const loadedCardPage = session?.cardPage ?? cardPage;
    const totalPages = session?.totalPages ?? serverTotalPages;
    if (cardLoadingMore || cardLoadInFlightRef.current || loadedCardPage >= totalPages) return;
    const nextPage = loadedCardPage + 1;
    cardLoadInFlightRef.current = true;
    setCardLoadingMore(true);
    try {
      const scope = tab === "favorites" ? "favorites" as const : "all" as const;
      const performFilters = toPerformanceFilters(listFilters);
      const data = listFiltersActive
        ? await getPerformances(nextPage, pageSize, scope, performFilters)
        : await getPerformances(nextPage, pageSize, scope);
      const mappedItems = performancesToDisplayRows(data.items);
      const currentSession = cardSessionsRef.current[sessionKey];
      if (currentSession && currentSession.cardPage >= data.pagination.page) return;
      const baseItems = currentSession?.items ?? items;
      const existingIds = new Set(baseItems.map(displayRowKey));
      const mergedItems = [...baseItems, ...mappedItems.filter((item) => !existingIds.has(displayRowKey(item)))];
      const nextSession: CardListSession = {
        items: mergedItems,
        total: data.pagination.total,
        totalPages: data.pagination.total_pages,
        cardPage: data.pagination.page,
      };
      cardSessionsRef.current[sessionKey] = nextSession;
      if (activeCardSessionKeyRef.current === sessionKey) {
        setItems(mergedItems);
        setServerTotal(nextSession.total);
        setServerTotalPages(nextSession.totalPages);
        setCardPage(nextSession.cardPage);
      }
    } catch {
      // load more 失败不覆盖已有数据
    } finally {
      cardLoadInFlightRef.current = false;
      setCardLoadingMore(false);
    }
  }, [
    cardLoadingMore,
    cardPage,
    currentListFiltersKey,
    items,
    listFilters,
    listFiltersActive,
    pageSize,
    serverTotalPages,
    tab,
  ]);

  useEffect(() => {
    if (viewMode !== "cards") return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          void loadMoreCards();
        }
      },
      { rootMargin: "300px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [viewMode, loadMoreCards]);

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
        setTab("home");
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
        setTab("home");
        setLoginDialogOpen(true);
      }
      logError("toggle_batch_favorite_failed", {
        desired: batchFavoriteDesired,
        count: pageLiveIds.length,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const handleBackFromDetail = () => {
    if (isAppHistoryState(window.history.state) && window.history.state.tab === "detail") {
      window.history.back();
      return;
    }
    if (previousTab === "tour_detail") {
      navigateToTab("tours");
      return;
    }
    if (previousTab === "performance_group_detail") {
      navigateToTab("all");
      return;
    }
    navigateToTab(previousTab);
  };
  const handleBackFromTourDetail = () => {
    if (isAppHistoryState(window.history.state) && window.history.state.tab === "tour_detail") {
      window.history.back();
      return;
    }
    navigateToTab("tours");
  };
  const handleBackFromPerformanceGroupDetail = () => {
    if (isAppHistoryState(window.history.state) && window.history.state.tab === "performance_group_detail") {
      window.history.back();
      return;
    }
    navigateToTab("all");
  };
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
      setTab("home");
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
    setTab("home");
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
  const liveArchiveNavigationActive = tab === "all" || tab === "favorites"
    || tab === "performance_group_detail"
    || (tab === "detail" && (previousTab === "all" || previousTab === "favorites"));
  const tourArchiveNavigationActive = tab === "tours" || tab === "tour_detail"
    || (tab === "detail" && (previousTab === "tours" || previousTab === "tour_detail"));

  return (
    <main className="page">
      <section className="panel">
        <header className="site-topbar">
          <button type="button" className="site-title" onClick={() => handleTabChange("home")}>
            BanG Dream! Live 资料库
          </button>

          <nav className="tabs" aria-label="主导航">
            {navigationItems.filter((item) => item.visible).map((item) => (
              <button
                key={item.key}
                className={`tab-btn ${tab === item.key || (item.key === "all" && liveArchiveNavigationActive) || (item.key === "tours" && tourArchiveNavigationActive) ? "active" : ""}`}
                onClick={() => handleTabChange(item.key)}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <div className="topbar-actions">
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
            <button
              type="button"
              className="theme-icon-btn"
              onClick={toggleTheme}
              aria-label={themeToggleMeta.label}
              title={themeToggleMeta.label}
            >
              {themeToggleMeta.icon}
            </button>
            <button
              type="button"
              className="topbar-menu-btn"
              aria-label="打开页面菜单"
              aria-expanded={navDrawerOpen}
              onClick={() => setNavDrawerOpen(true)}
            >
              ☰
            </button>
          </div>
        </header>
        {navDrawerOpen && (
          <div className="nav-drawer-mask" onClick={() => setNavDrawerOpen(false)}>
            <aside className="nav-drawer" aria-label="页面菜单" onClick={(event) => event.stopPropagation()}>
              <div className="nav-drawer-head">
                <strong>页面导航</strong>
                <button
                  type="button"
                  className="nav-drawer-close"
                  aria-label="关闭页面菜单"
                  onClick={() => setNavDrawerOpen(false)}
                >
                  ×
                </button>
              </div>
              <div className="nav-drawer-list">
                <button
                  type="button"
                  className={`nav-drawer-item ${tab === "home" ? "active" : ""}`}
                  onClick={() => handleTabChange("home")}
                >
                  首页
                </button>
                {navigationItems.filter((item) => item.visible).map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className={`nav-drawer-item ${tab === item.key || (item.key === "all" && liveArchiveNavigationActive) || (item.key === "tours" && tourArchiveNavigationActive) ? "active" : ""}`}
                    onClick={() => handleTabChange(item.key)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </aside>
          </div>
        )}
        {favorites.favoriteSyncWarning && <p className="favorite-sync-warning">{favorites.favoriteSyncWarning}</p>}

        {tab === "detail" && detailLiveId !== null && detailFallback !== null ? (
          <StageLedgerPage
            key={`live-${detailLiveId}-${liveDataRevision}`}
            liveId={detailLiveId}
            fallback={detailFallback}
            onBack={handleBackFromDetail}
            onOpenTour={openTourDetail}
            onOpenPerformanceGroup={openPerformanceGroupDetail}
            onOpenBand={(bandId) => {
              setCatalogBandPage(1);
              navigateToTab("browse", { catalogBandId: bandId });
            }}
            canFavorite={canUseFavoriteFeatures}
            isFavorite={isFavorite(detailLiveId)}
            isFavoriteSyncing={favorites.isFavoriteSyncing(detailLiveId)}
            onToggleFavorite={() => void toggleFavorite(detailLiveId)}
            onRequestLogin={() => {
              setLoginError(null);
              setLoginDialogOpen(true);
            }}
          />
        ) : showTourDetailPanel && detailTourId !== null && tourFallback !== null ? (
          <TourDetailPage
            key={`tour-${detailTourId}-${liveDataRevision}`}
            tourId={detailTourId}
            fallback={tourFallback}
            onBack={handleBackFromTourDetail}
            canFavorite={canUseFavoriteFeatures}
            isFavorite={isFavorite}
            isSyncing={favorites.isFavoriteSyncing}
            onToggleFavorite={(liveId) => void toggleFavorite(liveId)}
          />
        ) : showPerformanceGroupDetailPanel && detailGroupId !== null && groupFallback !== null ? (
          <PerformanceGroupDetailPage
            key={`group-${detailGroupId}-${liveDataRevision}`}
            groupId={detailGroupId}
            initialLiveId={detailGroupLiveId}
            onBack={handleBackFromPerformanceGroupDetail}
            onOpenTour={openTourDetail}
            canFavorite={canUseFavoriteFeatures}
            isFavorite={isFavorite}
            isSyncing={favorites.isFavoriteSyncing}
            onToggleFavorite={(liveId) => void toggleFavorite(liveId)}
          />
        ) : showHomePanel ? (
          <HomeDashboard
            isAuthenticated={auth.isAuthenticated}
            canUseConsoleFeatures={canUseConsoleFeatures}
            favoriteCount={favorites.favoriteLiveIds.length}
            liveTotal={homeLiveTotal}
            recentRows={homeRecentRows}
            loading={homeLoading}
            error={homeError}
            stats={catalogStats}
            onOpenLive={(row: HomeLiveRow) => openLiveDetail(row, "home")}
            onShowAll={() => handleTabChange("all")}
            onShowFavorites={() => handleTabChange("favorites")}
            onShowConsole={() => handleTabChange("console")}
            onLogin={() => {
              setLoginError(null);
              setLoginDialogOpen(true);
            }}
            onSearch={handleCatalogSearch}
            onShowBrowse={() => handleTabChange("browse")}
            onShowAbout={() => handleTabChange("about")}
          />
        ) : showSearchPanel ? (
          <SearchResultsPanel
            query={searchQuery}
            result={searchResult}
            loading={searchLoading}
            error={searchError}
            onSearch={handleCatalogSearch}
            onOpenLive={openCatalogLive}
            onSelectBand={handleCatalogBandSelect}
            onShowAbout={() => handleTabChange("about")}
          />
        ) : showBrowsePanel ? (
          <BandBrowsePanel
            bands={catalogBands}
            selectedBandId={selectedCatalogBandId}
            bandLives={catalogBandLives}
            loadingBands={catalogBandsLoading}
            loadingLives={catalogBandLivesLoading}
            error={catalogBrowseError}
            page={catalogBandPage}
            onSelectBand={handleCatalogBandSelect}
            onOpenLive={openCatalogLive}
            onPageChange={setCatalogBandPage}
          />
        ) : showStatisticsPanel ? (
          <StatisticsPanel
            scope={statisticsScope}
            filters={statisticsFilters}
            data={statisticsData}
            bands={listFilterBands}
            years={catalogStats?.years ?? []}
            loading={statisticsLoading}
            error={statisticsError}
            isAuthenticated={auth.isAuthenticated}
            onScopeChange={handleStatisticsScopeChange}
            onFiltersChange={setStatisticsFilters}
            onOpenLive={(live) => openLiveDetail({
              ...live,
              url: null,
              liveType: "other",
              icons: [],
              eventStatus: "scheduled",
              datePhase: "past",
              wasRescheduled: false,
            }, "statistics")}
          />
        ) : showAboutPanel ? (
          <AboutPanel />
        ) : showTourListPanel ? (
          <>
            <header className="list-page-heading">
              <PageTitle kicker="Tour archive" title="巡演资料" description="浏览已整理的巡演及本站收录场次。" />
            </header>
            <TourArchivePage
              filters={tourFilters}
              years={catalogStats?.years ?? []}
              bands={listFilterBands}
              onFiltersChange={handleTourFiltersChange}
              onOpenTour={openTourDetail}
            />
          </>
        ) : showListPanel ? (
          <>
            <header className="list-page-heading">
              <PageTitle
                kicker="Live archive"
                title="演出资料"
                description="浏览已收录的 Live，也可以只查看收藏内容。"
              />
              <ViewModeToggle value={viewMode} onChange={handleViewModeChange} />
            </header>
            <LiveListFiltersToolbar
              filters={listFilters}
              favoriteOnly={tab === "favorites"}
              years={catalogStats?.years ?? []}
              bands={listFilterBands}
              onChange={handleListFiltersChange}
              onFavoriteOnlyChange={(favoriteOnly) => handleTabChange(favoriteOnly ? "favorites" : "all")}
            />
            <footer className="pager">
              <div className="toolbar">
                {viewMode === "table" && (
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
                )}
                <span>总计 {total} 条</span>
              </div>
              {viewMode === "table" && (
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
              )}
            </footer>
            {viewMode === "cards" && (
              <LiveCardGrid
                rows={items}
                showStar={showFavoriteColumn}
                isFavorite={isFavorite}
                isSyncing={(id) => favorites.isFavoriteSyncing(id)}
                onToggleStar={(id) => void toggleFavorite(id)}
                onOpenLive={(row) => openLiveDetail(row as DisplayRow)}
                onOpenGroup={(groupId, groupTitle) => openPerformanceGroupDetail({ group_id: groupId, group_title: groupTitle })}
                loading={loading}
                loadError={loadError}
                sentinelRef={sentinelRef}
                loadingMore={cardLoadingMore}
                hasMore={cardPage < serverTotalPages}
                total={serverTotal}
              />
            )}
            {viewMode === "table" && (
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
                    <th>类型</th>
                    <th>乐队</th>
                    <th>URL</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedRows.map((row) => (
                    row.kind === "performance_group" ? (
                      <tr
                        key={`group-${row.groupId}`}
                        data-status-tone={getPerformanceGroupStatusPresentation(
                          row.groupStartDate,
                          row.groupEndDate,
                          row.groupCancelledLiveCount ?? 0,
                          row.groupLiveCount ?? 0,
                        ).tone}
                      >
                        {showFavoriteColumn && <td className="fav-col-cell"></td>}
                        <td>{formatPerformanceDate(row.groupStartDate, row.groupEndDate, row.liveDate)}</td>
                        <td>
                          <button
                            className="name-btn"
                            onClick={() => row.groupId !== null && openPerformanceGroupDetail({ group_id: row.groupId, group_title: row.groupTitle ?? "" })}
                            title={row.liveTitle}
                          >
                            {row.liveTitle}
                          </button>
                        </td>
                        <td>
                          <LiveTypeBadge
                            value="performance_group"
                            label={row.groupDisplayType === "single_day_multi_show" ? "单日多场" : "多日活动"}
                          />
                          {" · "}
                          {getPerformanceGroupStatusPresentation(
                            row.groupStartDate,
                            row.groupEndDate,
                            row.groupCancelledLiveCount ?? 0,
                            row.groupLiveCount ?? 0,
                          ).primary}
                        </td>
                        <td className="band-cell" title={`${row.groupIcons.length} 支乐队`}>
                          <BandIconsCell icons={row.groupIcons} rowId={row.groupId ?? 0} />
                        </td>
                        <td>
                          <span>
                            {row.groupLiveCount !== null
                              ? `${row.groupDayCount} 日 · ${row.groupLiveCount} 场${row.groupCancelledLiveCount ? ` · 取消 ${row.groupCancelledLiveCount} 场` : ""}`
                              : "-"}
                          </span>
                        </td>
                      </tr>
                    ) : (
                    <tr
                      key={row.liveId}
                      data-status-tone={getLiveStatusPresentation(
                        row.eventStatus ?? "scheduled",
                        row.datePhase ?? "past",
                        row.wasRescheduled,
                      ).tone}
                    >
                      {showFavoriteColumn && (
                        <td className="fav-col-cell">
                          {row.eventStatus !== "cancelled" && (
                            <button
                              className={`star-btn ${isFavorite(row.liveId) ? "is-fav" : ""} ${favorites.isFavoriteSyncing(row.liveId) ? "is-syncing" : ""}`}
                              onClick={() => void toggleFavorite(row.liveId)}
                              title={isFavorite(row.liveId) ? "取消收藏" : "加入收藏"}
                              aria-label={isFavorite(row.liveId) ? "取消收藏" : "加入收藏"}
                              aria-busy={favorites.isFavoriteSyncing(row.liveId)}
                            >
                              ★
                            </button>
                          )}
                        </td>
                      )}
                      <td>{row.liveDate}</td>
                      <td>
                        <button
                          className="name-btn"
                          onClick={() => openLiveDetail(row)}
                          title={row.liveTitle}
                        >
                          {row.liveTitle}
                        </button>
                      </td>
                      <td>
                        <LiveTypeBadge value={row.liveType} label={formatLiveType(row.liveType)} />
                        {` · ${formatLiveStatusText(
                          row.eventStatus ?? "scheduled",
                          row.datePhase ?? "past",
                          row.wasRescheduled,
                        )}`}
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
                            aria-label={`打开《${row.liveTitle}》的资料来源`}
                          >
                            <ExternalLinkIcon />
                          </a>
                        ) : (
                          <span>-</span>
                        )}
                      </td>
                    </tr>
                    )
                  ))}
                  {loadError && (
                    <tr>
                      <td colSpan={showFavoriteColumn ? 6 : 5} className="empty-cell">
                        <ContentState
                          kind="error"
                          title="数据加载失败"
                          description={loadError}
                          layout="rows"
                          compact
                        />
                      </td>
                    </tr>
                  )}
                  {!loadError && pagedRows.length === 0 && (
                    <tr>
                      <td colSpan={showFavoriteColumn ? 6 : 5} className="empty-cell">
                        {loading ? (
                          <ContentState kind="loading" title="加载中..." layout="rows" compact />
                        ) : (
                          <ContentState
                            kind="empty"
                            title="当前没有可展示的数据"
                            description="可以调整筛选条件后再试。"
                            layout="rows"
                            compact
                          />
                        )}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              </div>
            )}
            {showBackToTop && (
              <button
                type="button"
                className="back-to-top-btn"
                aria-label="回到顶部"
                title="回到顶部"
                onClick={scrollBackToTop}
              >
                <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                  <path d="m3 10 5-5 5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
          </>
        ) : showConsolePanel ? (
          <ConsoleInsertPanel initialMode="live_create" onLiveDataChanged={handleConsoleLiveDataChanged} />
        ) : (
          <AboutPanel />
        )}
      </section>

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
