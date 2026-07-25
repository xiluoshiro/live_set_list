import { render, screen } from "@testing-library/react";

import { ContentState } from "./ContentState";
import { LiveTypeBadge } from "./LiveTypeBadge";

// 测试点：加载状态提供可播报文案，并输出与卡片布局匹配的骨架占位。
test("内容加载状态输出可访问的卡片骨架", () => {
  const { container } = render(
    <ContentState kind="loading" title="加载中..." description="正在整理资料。" layout="cards" />,
  );

  expect(screen.getByRole("status")).toHaveTextContent("加载中...");
  expect(container.querySelectorAll(".content-state-skeleton span")).toHaveLength(6);
});

// 测试点：Live 类型徽章保留可读文本，并按业务类型输出稳定的视觉色调标记。
test("Live 类型徽章按类型选择色调", () => {
  const { rerender } = render(<LiveTypeBadge value="oneman" />);

  expect(screen.getByText("专场")).toHaveAttribute("data-tone", "oneman");

  rerender(<LiveTypeBadge value="multi_act" />);
  expect(screen.getByText("拼盘")).toHaveAttribute("data-tone", "multi");
});
