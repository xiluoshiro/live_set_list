import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { AlbumAdminSection } from "../console/AlbumAdminSection";

const api = vi.hoisted(() => ({ getCatalogConsole: vi.fn(), songCatalogWrite: vi.fn() }));
vi.mock("../../api", () => api);
vi.mock("../../auth/AuthProvider", () => ({ useAuth: () => ({ csrfToken: "csrf" }) }));

beforeEach(() => {
  vi.clearAllMocks();
  api.getCatalogConsole.mockImplementation(async (path: string) => ({ items: path.startsWith("/songs")
    ? [{ song_id: 1, song_name: "验证曲", version_label: "通常版", band_name: "乐队 A" }] : [] }));
});

test("Instrumental 复用已有歌曲，专辑日期可未知，失败保留待提交曲目", async () => {
  // 测试点：同歌曲两条收录可排序；不创建新 song_id；保存失败仍显示确认内容与错误。
  const user = userEvent.setup();
  api.songCatalogWrite.mockRejectedValue(new Error("资料已被修改，请重新加载后编辑"));
  render(<AlbumAdminSection />);
  fireEvent.change(screen.getByLabelText("专辑名称"), { target: { value: "测试专辑" } });
  await screen.findByRole("option", { name: "#1 验证曲 / 通常版 / 乐队 A" });
  await user.selectOptions(screen.getByLabelText("收录歌曲"), "1");
  await user.click(screen.getByRole("button", { name: "添加收录" }));
  await user.click(screen.getByRole("button", { name: "添加收录" }));
  fireEvent.change(screen.getByLabelText("第 2 曲收录标识"), { target: { value: "Instrumental" } });
  await user.click(screen.getAllByRole("button", { name: "上移" })[1]);
  await user.click(screen.getByRole("button", { name: "提交插入" }));
  const dialog = screen.getByRole("dialog", { name: "确认保存专辑" });
  expect(screen.getByLabelText("第 1 曲收录标识")).toBeDisabled();
  await user.click(within(dialog).getByRole("button", { name: "确认" }));
  await waitFor(() => expect(within(dialog).getByRole("alert")).toHaveTextContent("资料已被修改"));
  expect(api.songCatalogWrite).toHaveBeenCalledTimes(1);
  expect(api.songCatalogWrite).toHaveBeenCalledWith("/albums", "POST", {
    album_name: "测试专辑", release_label: "", release_date: null, cover_path: null,
    tracks: [{ song_id: 1, track_order: 1, edition_label: "Instrumental" }, { song_id: 1, track_order: 2, edition_label: "" }],
  }, "csrf");
  expect(screen.getByLabelText("第 1 曲收录标识")).toHaveValue("Instrumental");
});
