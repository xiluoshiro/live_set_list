import { render, screen } from "@testing-library/react";

import { ContentState } from "./ContentState";
import { LiveTypeBadge } from "./LiveTypeBadge";

// 测试点：加载状态提供可播报文案及描述。
test("内容加载状态提供可访问提示", () => {
  render(
    <ContentState kind="loading" title="加载中..." description="正在整理资料。" layout="cards" />,
  );

  expect(screen.getByRole("status")).toHaveTextContent("加载中...");
  expect(screen.getByText("正在整理资料。")).toBeInTheDocument();
});

// 测试点：Live 类型变更时，徽章显示对应的中文类型名称。
test("Live 类型徽章显示对应名称", () => {
  const { rerender } = render(<LiveTypeBadge value="oneman" />);

  expect(screen.getByText("专场")).toBeInTheDocument();

  rerender(<LiveTypeBadge value="multi_act" />);
  expect(screen.getByText("拼盘")).toBeInTheDocument();
});
