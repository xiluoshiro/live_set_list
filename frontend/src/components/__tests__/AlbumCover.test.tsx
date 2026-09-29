import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { AlbumCoverGallery } from "../AlbumCover";

// 测试点：图片切换同时切换名称，数组变化恢复默认图，未命名单图及空数组正常展示。
test("gallery handles changed covers, one cover and no cover", () => {
  const first = { url: "https://img.example.test/one", name: "" };
  const second = { url: "https://img.example.test/two", name: "初回限定盤" };
  const { rerender } = render(<AlbumCoverGallery covers={[first, second]} title="盘" />);
  expect(screen.getByRole("img", { name: "盘 封面 1" })).toHaveAttribute("src", first.url);
  fireEvent.click(screen.getByRole("button", { name: "下一张" }));
  expect(screen.getByRole("img", { name: "盘 初回限定盤" })).toHaveAttribute("src", second.url);
  rerender(<AlbumCoverGallery covers={[second, first]} title="盘" />);
  expect(screen.getByText("1 / 2")).toBeInTheDocument();
  expect(screen.getByRole("img")).toHaveAttribute("src", second.url);
  rerender(<AlbumCoverGallery covers={[first]} title="盘" />);
  expect(screen.getByRole("img")).toHaveAttribute("src", first.url);
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  rerender(<AlbumCoverGallery covers={[]} title="盘" />);
  expect(screen.queryByRole("group", { name: "专辑封面" })).not.toBeInTheDocument();
});
