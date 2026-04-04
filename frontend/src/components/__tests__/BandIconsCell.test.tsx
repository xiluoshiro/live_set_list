import { render, screen } from "@testing-library/react";

import { BandIconsCell } from "../BandIconsCell";

describe("BandIconsCell", () => {
  test("支持多种后端值格式并正确映射到 Band_x.svg", () => {
    // 测试点：兼容 number/string/Band_x/Band_x.svg 四种输入格式。
    render(<BandIconsCell icons={[1, "2", "Band_3", "Band_4.svg"]} rowId={100} />);

    const imgs = screen.getAllByRole("img");
    expect(imgs).toHaveLength(4);
    expect(imgs[0]).toHaveAttribute("src", "/icons/Band_1.svg");
    expect(imgs[1]).toHaveAttribute("src", "/icons/Band_2.svg");
    expect(imgs[2]).toHaveAttribute("src", "/icons/Band_3.svg");
    expect(imgs[3]).toHaveAttribute("src", "/icons/Band_4.svg");
  });

  test("非法图标值会被忽略，不渲染异常图片", () => {
    // 测试点：无效数据不会污染界面（例如 bad/超范围值）。
    render(<BandIconsCell icons={["bad", 0, 13, "Band_99"]} rowId={101} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  test("图标超过 5 个时显示省略号并标记 has-overflow", () => {
    // 测试点：超量时触发“省略号提醒 + 可滚动样式”。
    const { container } = render(<BandIconsCell icons={[1, 2, 3, 4, 5, 6]} rowId={102} />);
    expect(screen.getByText("…")).toBeInTheDocument();
    expect(container.querySelector(".icons-cell-wrap.has-overflow")).not.toBeNull();
  });

  test("图标不超过 5 个时不显示省略号并标记 no-overflow", () => {
    // 测试点：未超量时保持无省略号、无滚动条提示状态。
    const { container } = render(<BandIconsCell icons={[1, 2, 3, 4, 5]} rowId={103} />);
    expect(screen.queryByText("…")).not.toBeInTheDocument();
    expect(container.querySelector(".icons-cell-wrap.no-overflow")).not.toBeNull();
  });
});
