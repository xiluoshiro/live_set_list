import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { AlbumCoverGallery } from "../AlbumCover";

// 测试点：封面数组变化恢复新默认图，单图无切换操作，空数组正常省略展示。
test("gallery handles changed covers, one cover and no cover", () => {
  const first = "https://img.example.test/one";
  const second = "https://img.example.test/two";
  const { rerender } = render(<AlbumCoverGallery urls={[first, second]} title="盘" />);
  fireEvent.click(screen.getByRole("button", { name: "下一张" }));
  expect(screen.getByRole("img")).toHaveAttribute("src", second);
  rerender(<AlbumCoverGallery urls={[second, first]} title="盘" />);
  expect(screen.getByText("1 / 2")).toBeInTheDocument();
  expect(screen.getByRole("img")).toHaveAttribute("src", second);
  rerender(<AlbumCoverGallery urls={[first]} title="盘" />);
  expect(screen.getByRole("img")).toHaveAttribute("src", first);
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  rerender(<AlbumCoverGallery urls={[]} title="盘" />);
  expect(screen.queryByRole("group", { name: "专辑封面" })).not.toBeInTheDocument();
});
