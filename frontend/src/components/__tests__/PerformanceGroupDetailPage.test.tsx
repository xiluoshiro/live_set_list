import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { PerformanceGroupDetailPage } from "../PerformanceGroupDetailPage";

const apiMocks = vi.hoisted(() => ({
  getLiveDetail: vi.fn(),
  getPerformanceGroupDetail: vi.fn(),
}));

vi.mock("../../api", () => ({
  getLiveDetail: apiMocks.getLiveDetail,
  getPerformanceGroupDetail: apiMocks.getPerformanceGroupDetail,
}));

vi.mock("../../logger", () => ({
  logError: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
}));

const getLiveDetailMock = vi.mocked(apiMocks.getLiveDetail);
const getPerformanceGroupDetailMock = vi.mocked(apiMocks.getPerformanceGroupDetail);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeDetailResponse(overrides: Record<string, unknown> = {}) {
  const groupTitle = (overrides.group_title as string) ?? "BanG Dream! 12th LIVE";
  return {
    group_id: 1,
    group_title: groupTitle,
    start_date: "2025-04-26",
    end_date: "2025-04-27",
    day_count: 2,
    live_count: 3,
    display_type: "multi_day" as const,
    bands: [
      { band_id: 1, band_name: "Poppin'Party", band_abbr: "PoPiPa" },
      { band_id: 2, band_name: "Roselia", band_abbr: "Roselia" },
    ],
    venues: ["Tokyo Dome", "大阪城ホール"],
    lives: [
      {
        live_id: 101,
        live_date: "2025-04-26",
        live_title: "BanG Dream! 12th LIVE DAY 1: Poppin'Party",
        live_type: "oneman",
        start_time: "18:00:00+09:00",
        venue: "Tokyo Dome",
        bands: [1],
        url: "https://example.com/live/101",
        is_favorite: false,
        has_setlist: true,
      },
      {
        live_id: 102,
        live_date: "2025-04-27",
        live_title: "BanG Dream! 12th LIVE DAY 2: Roselia",
        live_type: "oneman",
        start_time: "17:30:00+09:00",
        venue: "Tokyo Dome",
        bands: [2],
        url: "https://example.com/live/102",
        is_favorite: false,
        has_setlist: true,
      },
      {
        live_id: 103,
        live_date: "2025-04-27",
        live_title: "BanG Dream! 12th LIVE DAY 2: After Party",
        live_type: "oneman",
        start_time: "20:00:00+09:00",
        venue: "Tokyo Dome",
        bands: [1, 2],
        url: "https://example.com/live/103",
        is_favorite: false,
        has_setlist: false,
      },
    ],
    ...overrides,
  };
}

function makeLiveDetailResponse(liveId: number) {
  return {
    live_id: liveId,
    live_date: "2025-04-26",
    live_title: `Live ${liveId}`,
    live_type: "oneman",
    venue: "Tokyo Dome",
    opening_time: "17:00:00+09:00",
    start_time: "18:00:00+09:00",
    bands: [1],
    band_names: ["Poppin'Party"],
    url: `https://example.com/live/${liveId}`,
    is_favorite: false,
    event_attendees: [],
    detail_rows: [],
  };
}

describe("PerformanceGroupDetailPage", () => {
  beforeEach(() => {
    getPerformanceGroupDetailMock.mockReset();
    getLiveDetailMock.mockReset();
    getLiveDetailMock.mockResolvedValue(makeLiveDetailResponse(101));
  });

  // 测试点：加载中显示加载状态
  test("shows loading state while fetching group detail", async () => {
    const deferredDetail = deferred<ReturnType<typeof makeDetailResponse>>();
    getPerformanceGroupDetailMock.mockReturnValue(deferredDetail.promise);

    render(<PerformanceGroupDetailPage groupId={1} onBack={vi.fn()} />);

    expect(screen.getByText("加载活动组详情...")).toBeInTheDocument();

    deferredDetail.resolve(makeDetailResponse());
    await waitFor(() => {
      expect(screen.queryByText("加载活动组详情...")).not.toBeInTheDocument();
    });
  });

  // 测试点：成功加载后显示活动组标题，并按聚合日期范围展示活动状态。
  test("displays group title after successful load", async () => {
    getPerformanceGroupDetailMock.mockResolvedValue(makeDetailResponse());

    render(<PerformanceGroupDetailPage groupId={1} onBack={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("BanG Dream! 12th LIVE")).toBeInTheDocument();
    });
    expect(screen.getByRole("region", { name: "活动状态" })).toHaveTextContent("已结束");
  });

  // 测试点：活动组概览不重复显示日期范围，日期只保留在选中 Live 自身详情中。
  test("omits the aggregate date range", async () => {
    getPerformanceGroupDetailMock.mockResolvedValue(
      makeDetailResponse({ start_date: "2025-04-26", end_date: "2025-04-27" }),
    );

    render(<PerformanceGroupDetailPage groupId={1} onBack={vi.fn()} />);

    await waitFor(() => {
      expect(screen.queryByText("已收录日期：")).not.toBeInTheDocument();
      expect(screen.queryByText("2025-04-26 — 2025-04-27")).not.toBeInTheDocument();
    });
  });

  // 测试点：日数为 1 时显示"单日多场"类型
  test("displays '单日多场' type when display_type is single_day_multi_show", async () => {
    getPerformanceGroupDetailMock.mockResolvedValue(
      makeDetailResponse({
        display_type: "single_day_multi_show",
        day_count: 1,
        start_date: "2025-04-26",
        end_date: "2025-04-26",
      }),
    );

    render(<PerformanceGroupDetailPage groupId={1} onBack={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("单日多场")).toBeInTheDocument();
    });
  });

  // 测试点：日数大于 1 时显示"多日活动"类型
  test("displays '多日活动' type when display_type is multi_day", async () => {
    getPerformanceGroupDetailMock.mockResolvedValue(
      makeDetailResponse({ display_type: "multi_day", day_count: 2 }),
    );

    render(<PerformanceGroupDetailPage groupId={1} onBack={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("多日活动")).toBeInTheDocument();
    });
  });

  // 测试点：显示场次数文案（已收录 N 场 / 已收录 N 日 · M 场）
  test("displays live count text for single-day group", async () => {
    getPerformanceGroupDetailMock.mockResolvedValue(
      makeDetailResponse({
        display_type: "single_day_multi_show",
        day_count: 1,
        live_count: 5,
        start_date: "2025-04-26",
        end_date: "2025-04-26",
      }),
    );

    render(<PerformanceGroupDetailPage groupId={1} onBack={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("已收录 5 场")).toBeInTheDocument();
    });
  });

  test("displays '已收录 N 日 · M 场' for multi-day group", async () => {
    getPerformanceGroupDetailMock.mockResolvedValue(
      makeDetailResponse({ day_count: 2, live_count: 3 }),
    );

    render(<PerformanceGroupDetailPage groupId={1} onBack={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("已收录 2 日 · 3 场")).toBeInTheDocument();
    });
  });

  // 测试点：活动组场次复用巡演的单行短标题导航，不显示日期分组或开演时间。
  test("renders a flat short-title navigation like tour stops", async () => {
    getPerformanceGroupDetailMock.mockResolvedValue(makeDetailResponse());

    render(<PerformanceGroupDetailPage groupId={1} onBack={vi.fn()} />);

    await waitFor(() => {
      const nav = screen.getByRole("navigation", { name: "活动组场次" });
      expect(within(nav).getAllByRole("button")).toHaveLength(3);
      expect(nav.querySelector("time")).toBeNull();
      expect(nav.querySelectorAll(".tour-stop-separator")).toHaveLength(2);
      expect(nav).not.toHaveTextContent("2025-04-26");
      expect(nav).not.toHaveTextContent("18:00");
    });
  });

  // 测试点：场次按钮文字为去除前缀后的短标题
  test("shortens live title buttons by removing group title prefix", async () => {
    getPerformanceGroupDetailMock.mockResolvedValue(makeDetailResponse());

    render(<PerformanceGroupDetailPage groupId={1} onBack={vi.fn()} />);

    await waitFor(() => {
      const button = screen.getByRole("button", { name: /DAY 1: Poppin'Party/ });
      expect(button).toBeInTheDocument();
      expect(button).not.toHaveTextContent("BanG Dream! 12th LIVE");
    });
  });

  // 测试点：点击场次按钮加载对应 Live 详情
  test("clicking a live button loads its detail", async () => {
    getPerformanceGroupDetailMock.mockResolvedValue(makeDetailResponse());
    getLiveDetailMock.mockReset();
    getLiveDetailMock.mockResolvedValueOnce(makeLiveDetailResponse(101));
    getLiveDetailMock.mockResolvedValueOnce(makeLiveDetailResponse(102));

    const user = userEvent.setup();

    render(<PerformanceGroupDetailPage groupId={1} onBack={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /DAY 2: Roselia/ })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /DAY 2: Roselia/ }));

    await waitFor(() => {
      expect(getLiveDetailMock).toHaveBeenCalledWith(102);
    });
  });

  // 测试点：隐藏日期和时间后仍严格保留后端给出的日期、开演时间规范顺序。
  test("preserves canonical live order without time suffixes", async () => {
    getPerformanceGroupDetailMock.mockResolvedValue(makeDetailResponse());

    render(<PerformanceGroupDetailPage groupId={1} onBack={vi.fn()} />);

    await waitFor(() => {
      const nav = screen.getByRole("navigation", { name: "活动组场次" });
      const buttons = within(nav).getAllByRole("button");
      const texts = buttons.map((b) => b.textContent ?? "");
      expect(texts[0]).toContain("DAY 1: Poppin'Party");
      expect(texts[1]).toContain("DAY 2: Roselia");
      expect(texts[2]).toContain("After Party");
      expect(texts.join(" ")).not.toContain("17:30");
      expect(texts.join(" ")).not.toContain("20:00");
    });
  });

  // 测试点：活动组内选中 Live 若属于巡演，应显示并可点击巡演反向入口。
  test("opens tour information from the selected grouped live", async () => {
    getPerformanceGroupDetailMock.mockResolvedValue(makeDetailResponse());
    getLiveDetailMock.mockResolvedValue({
      ...makeLiveDetailResponse(101),
      tour: { tour_id: 9, tour_title: "MyGO!!!!! ZEPP TOUR 2025" },
    });
    const onOpenTour = vi.fn();
    const user = userEvent.setup();

    render(<PerformanceGroupDetailPage groupId={1} onBack={vi.fn()} onOpenTour={onOpenTour} />);

    const tourLink = await screen.findByRole("button", { name: "MyGO!!!!! ZEPP TOUR 2025" });
    await user.click(tourLink);
    expect(onOpenTour).toHaveBeenCalledWith({ tour_id: 9, tour_title: "MyGO!!!!! ZEPP TOUR 2025" });
  });

  // 测试点：从普通 Live 的反向入口进入活动组时默认选中来源 Live。
  test("selects the source live passed by reverse navigation", async () => {
    getPerformanceGroupDetailMock.mockResolvedValue(makeDetailResponse());
    getLiveDetailMock.mockResolvedValue(makeLiveDetailResponse(102));

    render(<PerformanceGroupDetailPage groupId={1} initialLiveId={102} onBack={vi.fn()} />);

    await waitFor(() => expect(getLiveDetailMock).toHaveBeenCalledWith(102));
    expect(screen.getByRole("button", { name: /DAY 2: Roselia/ })).toHaveAttribute("aria-pressed", "true");
  });

  // 测试点：已登录用户可以逐场收藏活动组子 Live，组本身不出现整体收藏按钮。
  test("offers a favorite control for each child live", async () => {
    getPerformanceGroupDetailMock.mockResolvedValue(makeDetailResponse());
    const onToggleFavorite = vi.fn();
    const user = userEvent.setup();

    render(
      <PerformanceGroupDetailPage
        groupId={1}
        onBack={vi.fn()}
        canFavorite
        isFavorite={(liveId) => liveId === 101}
        onToggleFavorite={onToggleFavorite}
      />,
    );

    const removeButton = await screen.findByRole("button", { name: /取消收藏 DAY 1/ });
    const addButton = screen.getByRole("button", { name: /加入收藏 DAY 2: Roselia/ });
    expect(removeButton).toBeInTheDocument();
    await user.click(addButton);
    expect(onToggleFavorite).toHaveBeenCalledWith(102);
  });

  // 测试点：API 返回 404 时显示错误信息
  test("shows error message when API returns 404", async () => {
    getPerformanceGroupDetailMock.mockRejectedValue(new Error("Group 1 not found"));
    getLiveDetailMock.mockReset();

    render(<PerformanceGroupDetailPage groupId={1} onBack={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/活动组详情加载失败/)).toBeInTheDocument();
    });
  });

  // 测试点：参与乐队以文本形式显示在元数据行中
  test("displays participating bands as text in meta line", async () => {
    getPerformanceGroupDetailMock.mockResolvedValue(
      makeDetailResponse({
        bands: [
          { band_id: 1, band_name: "Poppin'Party", band_abbr: "PoPiPa" },
          { band_id: 2, band_name: "Roselia", band_abbr: "Roselia" },
        ],
      }),
    );

    render(<PerformanceGroupDetailPage groupId={1} onBack={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("参与乐队：")).toBeInTheDocument();
      expect(screen.getByText("Poppin'Party / Roselia")).toBeInTheDocument();
    });
  });
});
