import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { ConsoleInsertPanel } from "../ConsoleInsertPanel";

const apiMocks = vi.hoisted(() => ({
  getConsoleSongs: vi.fn(),
  getConsoleBands: vi.fn(),
  getConsoleVenues: vi.fn(),
}));

vi.mock("../../api", () => ({
  getConsoleSongs: apiMocks.getConsoleSongs,
  getConsoleBands: apiMocks.getConsoleBands,
  getConsoleVenues: apiMocks.getConsoleVenues,
}));

describe("ConsoleInsertPanel", () => {
  beforeEach(() => {
    apiMocks.getConsoleSongs.mockReset();
    apiMocks.getConsoleBands.mockReset();
    apiMocks.getConsoleVenues.mockReset();
    apiMocks.getConsoleSongs.mockResolvedValue({ items: [] });
    apiMocks.getConsoleBands.mockResolvedValue({ items: [] });
    apiMocks.getConsoleVenues.mockResolvedValue({ items: [] });
  });

  test("默认渲染新增入口与Setlist字段表格", async () => {
    // 测试点：控制台基础结构存在，且默认是新增Setlist录入视图。
    render(<ConsoleInsertPanel />);
    await waitFor(() => expect(apiMocks.getConsoleSongs).toHaveBeenCalledWith(undefined, 100));

    expect(screen.getByRole("tab", { name: "新增Live" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "新增Setlist" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "新增歌曲" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "新增乐队" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "显示详细信息" })).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader", { name: "live_date" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("columnheader", { name: "live_title" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("columnheader", { name: "abs" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("columnheader", { name: "seg" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("combobox", { name: /seg-/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("checkbox", { name: /is_short-/ }).length).toBeGreaterThan(0);
    expect(screen.getByLabelText("选择 live_id")).toBeInTheDocument();
  });

  test("提交新增Setlist后会出现一条mock插入记录", async () => {
    // 测试点：最小插入路径可用（选择live_id后可提交，且出现插入记录）。
    const user = userEvent.setup();
    render(<ConsoleInsertPanel />);
    await waitFor(() => expect(apiMocks.getConsoleSongs).toHaveBeenCalledWith(undefined, 100));

    await user.selectOptions(screen.getByLabelText("选择 live_id"), "101");
    await user.click(screen.getByRole("button", { name: "提交插入" }));

    expect(screen.getByText(/已为Live #101/)).toBeInTheDocument();
    expect(screen.queryByText("暂无插入记录")).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "setlist_rows" })).toBeInTheDocument();
  });

  test("只读查询接口会加载候选数据并用于歌曲查询", async () => {
    // 测试点：控制台只读 API 接入后，band 候选与歌曲查询不再只依赖本地 mock。
    const user = userEvent.setup();
    apiMocks.getConsoleBands.mockResolvedValue({
      items: [{ band_id: 9, band_name: "Real Band", band_abbr: "real", band_members: ["Vocal", "Guitar"] }],
    });
    apiMocks.getConsoleSongs
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({
        items: [{ song_id: 901, song_name: "春日序曲", band_id: 9, cover: false }],
      })
      .mockResolvedValueOnce({
        items: [{ song_id: 902, song_name: "逆光海岸", band_id: 9, cover: false }],
      });

    render(<ConsoleInsertPanel />);

    await waitFor(() => expect(apiMocks.getConsoleBands).toHaveBeenCalledWith(undefined, 100));
    await user.click(screen.getByRole("tab", { name: "新增歌曲" }));
    await user.click(screen.getByRole("button", { name: "请选择 band_id" }));
    expect(await screen.findByText("9 - Real Band")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "新增Setlist" }));
    await user.click(screen.getByRole("button", { name: "查询歌曲" }));

    await waitFor(() => expect(apiMocks.getConsoleSongs).toHaveBeenCalledWith("春日序曲", 10));
    expect(apiMocks.getConsoleSongs).toHaveBeenCalledWith("逆光海岸", 10);
    expect(await screen.findByText("查询歌曲完成：匹配 3 行，未匹配 0 行。")).toBeInTheDocument();
  });
});
