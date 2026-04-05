import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ConsoleInsertPanel } from "../ConsoleInsertPanel";

describe("ConsoleInsertPanel", () => {
  test("默认渲染新增入口与Live字段表格", () => {
    // 测试点：控制台基础结构存在，且默认是新增Live+setlist录入视图。
    render(<ConsoleInsertPanel />);

    expect(screen.getByRole("tab", { name: "新增Live" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "新增歌曲" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "新增乐队" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("columnheader", { name: "live_date" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("columnheader", { name: "live_title" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("columnheader", { name: "abs" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("columnheader", { name: "seg" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("combobox", { name: /seg-/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("checkbox", { name: /is_short-/ }).length).toBeGreaterThan(0);
    expect(screen.getByLabelText("选择 live_id")).toBeInTheDocument();
  });

  test("提交新增Live后会出现一条mock插入记录", async () => {
    // 测试点：最小插入路径可用（选择live_id后可提交，且出现插入记录）。
    const user = userEvent.setup();
    render(<ConsoleInsertPanel />);

    await user.selectOptions(screen.getByLabelText("选择 live_id"), "101");
    await user.click(screen.getByRole("button", { name: "提交插入" }));

    expect(screen.getByText(/已为Live #101/)).toBeInTheDocument();
    expect(screen.queryByText("暂无插入记录")).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "setlist_rows" })).toBeInTheDocument();
  });
});
