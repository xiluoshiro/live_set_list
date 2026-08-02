import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

import { ApiError, getLiveDetail, type LiveDetailResponse } from "../../api";
import { StageLedgerPage } from "../StageLedgerPage";

vi.mock("../../api", async () => {
  const actual = await vi.importActual<typeof import("../../api")>("../../api");
  return { ...actual, getLiveDetail: vi.fn() };
});

const getLiveDetailMock = vi.mocked(getLiveDetail);

function makeDetail(): LiveDetailResponse {
  return {
    live_id: 91,
    live_date: "2026-08-02",
    live_title: "Fetched Stage Ledger",
    live_type: "oneman",
    venue_id: null,
    venue: "Venue",
    opening_time: null,
    start_time: null,
    bands: [],
    band_names: [],
    url: null,
    is_favorite: false,
    event_attendees: [],
    detail_rows: [],
  };
}

function renderPage() {
  return render(
    <StageLedgerPage
      liveId={91}
      fallback={{ liveTitle: "Fallback Live", liveDate: "2026-08-02", url: null }}
      onBack={vi.fn()}
      onOpenTour={vi.fn()}
    />,
  );
}

describe("StageLedgerPage", () => {
  beforeEach(() => {
    getLiveDetailMock.mockReset();
  });

  test("成功读取后替换骨架为当前 Live 详情", async () => {
    // 测试点：页面层负责请求生命周期，成功响应后交给 Stage Ledger 内容层渲染。
    getLiveDetailMock.mockResolvedValue(makeDetail());
    renderPage();

    expect(screen.getByText("Fallback Live")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Fetched Stage Ledger" })).toBeInTheDocument();
    expect(getLiveDetailMock).toHaveBeenCalledWith(91);
  });

  test("404 显示明确找不到状态", async () => {
    // 测试点：404 不应把 fallback 标题当成成功详情，而要呈现可返回的找不到状态。
    getLiveDetailMock.mockRejectedValue(new ApiError("not found", 404));
    renderPage();

    expect(await screen.findByRole("heading", { name: "未找到这场 Live" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "返回演出资料" })).toBeInTheDocument();
  });

  test("500 可重试并恢复详情", async () => {
    // 测试点：500 先保留可理解的错误和重试入口，重试成功后不伪造空歌单。
    const user = userEvent.setup();
    getLiveDetailMock
      .mockRejectedValueOnce(new ApiError("server error", 500))
      .mockResolvedValueOnce(makeDetail());
    renderPage();

    expect(await screen.findByRole("heading", { name: "详情读取失败" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByRole("heading", { name: "Fetched Stage Ledger" })).toBeInTheDocument();
    expect(getLiveDetailMock).toHaveBeenCalledTimes(2);
  });
});
