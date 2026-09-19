import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";

import { LocalityAdminSection } from "../LocalityAdminSection";

const api = vi.hoisted(() => ({
  getConsoleLocalities: vi.fn(), createConsoleLocality: vi.fn(), previewConsoleLocality: vi.fn(), saveConsoleLocality: vi.fn(),
}));
vi.mock("../../../api", () => api);
vi.mock("../../../auth/AuthProvider", () => ({ useAuth: () => ({ csrfToken: "csrf" }) }));

const tokyo = { id: 5, country_code: "JP", admin_area: "東京都", locality_name: "千代田区", area_level: "locality" as const, state_token: "1".repeat(64) };

beforeEach(() => {
  vi.clearAllMocks();
  api.getConsoleLocalities.mockResolvedValue({ items: [tokyo], total: 1, page: 1, page_size: 20 });
});

test("manages verified localities independently of a Venue", async () => {
  const user = userEvent.setup();
  render(<LocalityAdminSection onMessage={vi.fn()} />);
  await screen.findByRole("combobox", { name: "已登记地区" });
  expect(screen.getByRole("button", { name: "登记已核验地区" })).toBeEnabled();

  await user.click(screen.getByRole("button", { name: "登记已核验地区" }));
  await user.type(screen.getByLabelText("国家／地区代码"), "JP");
  await user.type(screen.getByLabelText("城市名称"), "横滨市");
  await user.click(screen.getByRole("button", { name: "提交插入" }));
  const dialog = await screen.findByRole("dialog", { name: "确认登记地区" });
  expect(dialog).toHaveTextContent("城市横滨市");
  api.createConsoleLocality.mockResolvedValue({ ...tokyo, id: 6, locality_name: "横滨市" });
  await user.click(within(dialog).getByRole("button", { name: "提交插入" }));
  expect(api.createConsoleLocality).toHaveBeenCalledWith({
    country_code: "JP", admin_area: null, locality_name: "横滨市", area_level: "locality",
  }, "csrf");
});

test("previews an existing locality correction with its impact before saving", async () => {
  const user = userEvent.setup();
  render(<LocalityAdminSection onMessage={vi.fn()} />);
  await screen.findByRole("combobox", { name: "已登记地区" });
  await user.selectOptions(screen.getByRole("combobox", { name: "已登记地区" }), "5");
  await user.click(screen.getByRole("button", { name: "修改已选地区" }));
  await user.clear(screen.getByLabelText("城市名称"));
  await user.type(screen.getByLabelText("城市名称"), "新宿区");
  api.previewConsoleLocality.mockResolvedValue({ before: tokyo, after: { country_code: "JP", admin_area: "東京都", locality_name: "新宿区", area_level: "locality", expected_state_token: tokyo.state_token }, venue_count: 2, live_count: 4 });
  await user.click(screen.getByRole("button", { name: "预览修改" }));
  const dialog = await screen.findByRole("dialog", { name: "确认地区资料修改" });
  expect(dialog).toHaveTextContent("引用 Venue2");
  expect(dialog).toHaveTextContent("关联 Live4");
  expect(api.previewConsoleLocality).toHaveBeenCalledWith(5, expect.objectContaining({ expected_state_token: tokyo.state_token, locality_name: "新宿区" }));
});
