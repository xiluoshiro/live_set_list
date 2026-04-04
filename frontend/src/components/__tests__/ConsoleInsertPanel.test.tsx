import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ConsoleInsertPanel } from "../ConsoleInsertPanel";

describe("ConsoleInsertPanel", () => {
  test("默认渲染新增入口与Live字段表格", () => {
    // 测试点：控制台基础结构存在，且默认是新增Live视图。
    render(<ConsoleInsertPanel />);

    expect(screen.getByRole("tab", { name: "新增Live" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "新增歌曲" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "新增乐队" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "live_id" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "live_date" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "live_title" })).toBeInTheDocument();
  });

  test("提交新增Live后会出现一条mock插入记录", async () => {
    // 测试点：最小插入路径可用（填写标题/乐队ID并提交）。
    const user = userEvent.setup();
    render(<ConsoleInsertPanel />);

    await user.clear(screen.getByPlaceholderText("请输入Live标题"));
    await user.type(screen.getByPlaceholderText("请输入Live标题"), "控制台插入样例");
    await user.clear(screen.getByPlaceholderText("1,2,3"));
    await user.type(screen.getByPlaceholderText("1,2,3"), "1,4");
    await user.click(screen.getByRole("button", { name: "提交插入" }));

    expect(screen.getByText(/已新增Live/)).toBeInTheDocument();
    expect(screen.getByText("控制台插入样例")).toBeInTheDocument();
    expect(screen.getByText("1,4")).toBeInTheDocument();
  });
});
