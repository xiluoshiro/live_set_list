import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

import type { LiveDetailRow } from "../../api";
import { MemberStatusTable } from "../DetailMemberTable";

const detailRows: LiveDetailRow[] = [
  {
    row_id: "M1",
    song_name: "春日序曲",
    band_members: [
      {
        band_id: 1,
        band_name: "Poppin'Party",
        present_members: ["主唱", "吉他", "贝斯", "鼓手", "键盘"],
        present_count: 5,
        total_count: 5,
        is_full: true,
      },
    ],
    other_members: [],
    comments: [],
  },
  {
    row_id: "M2",
    song_name: "逆光海岸",
    band_members: [
      {
        band_id: 2,
        band_name: "Afterglow",
        present_members: ["主唱", "吉他", "贝斯", "鼓手", "键盘"],
        present_count: 5,
        total_count: 5,
        is_full: true,
      },
    ],
    other_members: [
      { key: "和声", value: ["双声部"] },
      { key: "采样", value: ["预置触发"] },
      { key: "打击乐", value: ["额外一轨"] },
    ],
    comments: ["翻唱"],
    ownership: { mode: "bands", band_ids: [4], member_groups: [], bands: [{ band_id: 4, band_name: "Roselia" }], groups: [] },
  },
];

describe("MemberStatusTable", () => {

  test("未传详情行时展示空数据提示", () => {
    // 测试点：缺少演出明细时展示空状态。
    render(<MemberStatusTable />);
    expect(screen.getByText("当前 Live 暂无详情数据")).toBeInTheDocument();
  });

  // 测试点：跨乐队翻唱标签应直接加载歌曲所属乐队的完整 SVG 文件。
  test("跨乐队翻唱标签展示所属乐队 SVG", () => {
    render(<MemberStatusTable rows={detailRows} />);

    const coverTag = screen.getByText("翻唱");
    expect(coverTag).toBeInTheDocument();
    expect(within(coverTag).getByRole("img", { name: "Roselia" })).toHaveAttribute("src", "/icons/Band_4.svg");
  });

  // 测试点：没有归属资料的缓存详情仍可显示文字标记。
  test("缺少归属资料时展示文字标记", () => {
    render(<MemberStatusTable rows={[{ ...detailRows[1], ownership: undefined }]} />);

    const coverTag = screen.getByText("翻唱");
    expect(within(coverTag).queryByRole("img")).not.toBeInTheDocument();
  });

  test("乐队成员单元格点击后可打开“参加队员”二级详情", async () => {
    // 测试点：点击乐队成员区域打开二级详情弹层。
    const user = userEvent.setup();
    render(<MemberStatusTable rows={detailRows} />);

    const bandButtons = screen.getAllByTitle("点击查看参加队员");
    await user.click(bandButtons[0]);

    expect(screen.getByText(/乐队成员详情/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "关闭乐队详情" })).toBeInTheDocument();
  });

  // 测试点：full_plus 显示全员与特别出演人数，成员详情包含阵容版本和特别出演类别。
  test("展示全员加特别出演状态与版本差异", async () => {
    const user = userEvent.setup();
    render(
      <MemberStatusTable
        rows={[
          {
            row_id: "M1",
            song_name: "交接曲",
            band_members: [
              {
                band_id: 4,
                band_name: "Roselia",
                lineup_usage: "handover",
                handover_baseline: "base",
                lineup_version: { lineup_version_id: 21, version_label: "Roselia V1" },
                next_lineup_version: { lineup_version_id: 22, version_label: "Roselia V2" },
                attendance_status: "full_plus",
                expected_count: 5,
                present_members: ["A", "B", "C", "D", "E", "F"],
                present_count: 6,
                missing_members: [],
                extra_members: [{ member_name: "F", category: "incoming" }],
                total_count: 5,
                is_full: true,
              },
            ],
            other_members: [],
            comments: [],
          },
        ]}
      />,
    );

    expect(screen.getByTitle("Roselia · 全员 5/5＋特别出演 1")).toBeInTheDocument();

    await user.click(screen.getByTitle("点击查看参加队员"));
    expect(screen.getByText("阵容：Roselia V1 → Roselia V2 · 交接共演（旧阵容基准）")).toBeInTheDocument();
    expect(screen.getByText("特别出演：F（新成员）")).toBeInTheDocument();
  });

  // 测试点：普通场次的成员详情展示对应乐队。
  test("普通 Live 成员详情显示乐队名", async () => {
    const user = userEvent.setup();
    render(
      <MemberStatusTable
        rows={[
          {
            row_id: "M1",
            song_name: "普通演出曲",
            band_members: [
              {
                band_id: 8,
                band_name: "RAISE A SUILEN",
                lineup_usage: "base",
                handover_baseline: null,
                lineup_version: { lineup_version_id: 31, version_label: "RAISE A SUILEN V3" },
                next_lineup_version: null,
                attendance_status: "full",
                expected_count: 5,
                present_members: ["A", "B", "C", "D", "E"],
                present_count: 5,
                missing_members: [],
                extra_members: [],
                total_count: 5,
                is_full: true,
              },
            ],
            other_members: [],
            comments: [],
          },
        ]}
      />,
    );

    await user.click(screen.getByTitle("点击查看参加队员"));
    expect(screen.getByText("阵容：RAISE A SUILEN")).toBeInTheDocument();
  });

  // 测试点：存在后继阵容即表示 Live 发生交接，基础与后继曲目都必须展示完整版本链及新旧语义。
  test.each([
    ["base", "阵容：Poppin'Party V1 → Poppin'Party V2 · 旧阵容"],
    ["next", "阵容：Poppin'Party V1 → Poppin'Party V2 · 新阵容"],
  ] as const)("交接Live的 %s 曲目展示版本", async (lineupUsage, expectedText) => {
    const user = userEvent.setup();
    render(
      <MemberStatusTable
        rows={[
          {
            row_id: "M1",
            song_name: "交接Live曲目",
            band_members: [
              {
                band_id: 1,
                band_name: "Poppin'Party",
                lineup_usage: lineupUsage,
                handover_baseline: null,
                lineup_version: { lineup_version_id: 1, version_label: "Poppin'Party V1" },
                next_lineup_version: { lineup_version_id: 2, version_label: "Poppin'Party V2" },
                attendance_status: "full",
                expected_count: lineupUsage === "base" ? 3 : 4,
                present_members: lineupUsage === "base"
                  ? ["愛美", "西本りみ", "伊藤彩沙"]
                  : ["愛美", "大塚紗英", "西本りみ", "伊藤彩沙"],
                present_count: lineupUsage === "base" ? 3 : 4,
                missing_members: [],
                extra_members: [],
                total_count: lineupUsage === "base" ? 3 : 4,
                is_full: true,
              },
            ],
            other_members: [],
            comments: [],
          },
        ]}
      />,
    );

    await user.click(screen.getByTitle("点击查看参加队员"));
    expect(screen.getByText(expectedText)).toBeInTheDocument();
  });

  test("其他成员 +N 按钮可打开浮层，点击外部可关闭", async () => {
    // 测试点：+N 按钮打开“其他成员明细”浮层，点外部关闭。
    const user = userEvent.setup();
    render(<MemberStatusTable rows={detailRows} />);

    const moreButton = screen.getAllByRole("button", { name: /\+\d+/ })[0];
    await user.click(moreButton);
    expect(screen.getByText("其他成员明细")).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    await waitFor(() => {
      expect(screen.queryByText("其他成员明细")).not.toBeInTheDocument();
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

  test("乐队图片加载失败时使用首字符兜底", () => {
    // 测试点：图片加载失败后移除损坏图片并显示乐队名对应的首字符。
    render(
      <MemberStatusTable
        rows={[
          {
            row_id: "M1",
            song_name: "测试曲",
            band_members: [
              {
                band_id: 99,
                band_name: "UnknownBand",
                present_members: ["A"],
                present_count: 1,
                total_count: 5,
                is_full: false,
              },
            ],
            other_members: [],
            comments: [],
          },
        ]}
      />,
    );

    const icon = screen.getByRole("img", { name: "UnknownBand" });
    fireEvent.error(icon);

    expect(screen.queryByRole("img", { name: "UnknownBand" })).not.toBeInTheDocument();
    const fallback = screen.getByLabelText("UnknownBand");
    expect(fallback).toHaveTextContent("U");
  });
});

