import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

import { MemberStatusTable } from "../DetailMemberTable";

describe("MemberStatusTable", () => {
  test("详情表格表头为 5 列：编号/曲目名称/乐队成员/其他成员/备注", () => {
    // 测试点：看护详情表格表头结构，防止列名被误改。
    render(<MemberStatusTable seed={1} />);
    expect(screen.getByRole("columnheader", { name: "编号" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "曲目名称" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "乐队成员" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "其他成员" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "备注" })).toBeInTheDocument();
  });

  test("mock 数据渲染行数正确（20 行数据 + 1 行表头）", () => {
    // 测试点：表格行数基于组件内 mock 生成规则，确保为固定 20 行。
    render(<MemberStatusTable seed={2} />);
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(21);
  });

  test("乐队成员单元格点击后可打开“参加队员”二级详情", async () => {
    // 测试点：点击乐队成员区域打开二级详情弹层。
    const user = userEvent.setup();
    render(<MemberStatusTable seed={1} />);

    const bandButtons = screen.getAllByTitle("点击查看参加队员");
    await user.click(bandButtons[0]);

    expect(screen.getByText(/乐队成员详情/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "关闭乐队详情" })).toBeInTheDocument();
  });

  test("其他成员 +N 按钮可打开浮层，点击外部可关闭", async () => {
    // 测试点：+N 按钮打开“其他成员明细”浮层，点外部关闭。
    const user = userEvent.setup();
    render(<MemberStatusTable seed={4} />);

    const moreButton = screen.getAllByRole("button", { name: /\+\d+/ })[0];
    await user.click(moreButton);
    expect(screen.getByText("其他成员明细")).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    await waitFor(() => {
      expect(screen.queryByText("其他成员明细")).not.toBeInTheDocument();
    });
  });

  test("当 +N 按钮靠近底部时，浮层优先向上弹出", async () => {
    // 测试点：验证 +N 浮层定位规则（靠近底部时向上优先）。
    const user = userEvent.setup();
    render(<MemberStatusTable seed={4} />);

    const originalInnerHeight = window.innerHeight;
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 740,
    });

    const moreButton = screen.getAllByRole("button", { name: /\+\d+/ })[0];
    const rectSpy = vi.spyOn(moreButton, "getBoundingClientRect").mockReturnValue({
      x: 100,
      y: 700,
      width: 40,
      height: 22,
      top: 700,
      right: 140,
      bottom: 722,
      left: 100,
      toJSON: () => ({}),
    } as DOMRect);

    await user.click(moreButton);

    const popover = document.querySelector(".other-floating-popover") as HTMLElement;
    expect(popover).not.toBeNull();
    const top = Number.parseFloat(popover.style.top || "0");
    expect(top).toBeLessThan(700);

    rectSpy.mockRestore();
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: originalInnerHeight,
    });
  });

  test("其他成员 value 为空时标签不显示冒号", () => {
    // 测试点：other_member.value 为 [] 时，标签仅显示 key，不带 ':'。
    render(
      <MemberStatusTable
        rows={[
          {
            row_id: "M1",
            song_name: "测试曲",
            band_members: [],
            other_members: [{ key: "键盘支援", value: [] }],
            comments: [],
          },
        ]}
      />,
    );

    expect(screen.getByRole("button", { name: "键盘支援" })).toBeInTheDocument();
    expect(screen.queryByText("键盘支援:")).not.toBeInTheDocument();
  });

  test("没有 +N 时点击其他成员标签也可打开明细", async () => {
    // 测试点：仅 1-2 个其他成员时，点击标签同样可展开浮层。
    const user = userEvent.setup();
    render(
      <MemberStatusTable
        rows={[
          {
            row_id: "M1",
            song_name: "测试曲",
            band_members: [],
            other_members: [{ key: "键盘支援", value: ["远程连线"] }],
            comments: [],
          },
        ]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "键盘支援:远程连线" }));
    expect(screen.getByText("其他成员明细")).toBeInTheDocument();
  });
});

