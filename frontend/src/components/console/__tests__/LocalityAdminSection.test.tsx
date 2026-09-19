import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";

import { LocalityAdminSection } from "../LocalityAdminSection";

const api = vi.hoisted(() => ({ createConsoleLocality: vi.fn() }));
vi.mock("../../../api", () => api);
vi.mock("../../../auth/AuthProvider", () => ({ useAuth: () => ({ csrfToken: "csrf" }) }));

beforeEach(() => { vi.clearAllMocks(); });

// 测试点：新增地区使用单行资料表，提交前展示确认内容，成功后按默认选项清空表单。
test("creates a locality and clears the form after confirmation", async () => {
  const user = userEvent.setup();
  const onMessage = vi.fn();
  render(<LocalityAdminSection onMessage={onMessage} />);

  const table = within(screen.getByRole("table", { name: "新增地区资料" }));
  expect(table.getAllByRole("columnheader").map(cell => cell.textContent)).toEqual([
    "地区层级", "国家／地区代码", "都道府县／省／州", "城市名称",
  ]);
  expect(screen.queryByRole("button", { name: "修改已选地区" })).not.toBeInTheDocument();

  await user.type(table.getByLabelText("国家／地区代码"), "jp");
  await user.type(table.getByLabelText("都道府县／省／州"), "神奈川県");
  await user.type(table.getByLabelText("城市名称"), "横浜市");
  await user.click(screen.getByRole("button", { name: "提交插入" }));

  const dialog = await screen.findByRole("dialog", { name: "确认新增地区" });
  expect(within(dialog).getByRole("table", { name: "新增地区确认" })).toHaveTextContent("JP");
  expect(dialog).toHaveTextContent("神奈川県");
  expect(dialog).toHaveTextContent("横浜市");

  api.createConsoleLocality.mockResolvedValue({ id: 6, country_code: "JP", admin_area: "神奈川県", locality_name: "横浜市", area_level: "locality", state_token: "2".repeat(64) });
  await user.click(within(dialog).getByRole("button", { name: "提交插入" }));

  expect(api.createConsoleLocality).toHaveBeenCalledWith({
    country_code: "JP", admin_area: "神奈川県", locality_name: "横浜市", area_level: "locality",
  }, "csrf");
  expect(await screen.findByText("已新增地区 #6 JP / 神奈川県 / 横浜市。")).toBeInTheDocument();
  expect(table.getByLabelText("国家／地区代码")).toHaveValue("");
  expect(onMessage).toHaveBeenCalledWith("已新增地区 #6 JP / 神奈川県 / 横浜市。");
});

// 测试点：用户关闭自动清空后，新增成功仍保留当前地区资料，便于连续录入相近地区。
test("keeps the form after creation when clear-after-create is disabled", async () => {
  const user = userEvent.setup();
  render(<LocalityAdminSection onMessage={vi.fn()} />);
  api.createConsoleLocality.mockResolvedValue({ id: 7, country_code: "JP", admin_area: "東京都", locality_name: null, area_level: "admin_area", state_token: "3".repeat(64) });

  await user.selectOptions(screen.getByLabelText("地区层级"), "admin_area");
  await user.type(screen.getByLabelText("国家／地区代码"), "JP");
  await user.type(screen.getByLabelText("都道府县／省／州"), "東京都");
  await user.click(screen.getByRole("checkbox", { name: "新增成功后清空表单" }));
  await user.click(screen.getByRole("button", { name: "提交插入" }));
  await user.click(within(await screen.findByRole("dialog", { name: "确认新增地区" })).getByRole("button", { name: "提交插入" }));

  expect(await screen.findByText("已新增地区 #7 JP / 東京都。")).toBeInTheDocument();
  expect(screen.getByLabelText("国家／地区代码")).toHaveValue("JP");
  expect(screen.getByLabelText("都道府县／省／州")).toHaveValue("東京都");
});
