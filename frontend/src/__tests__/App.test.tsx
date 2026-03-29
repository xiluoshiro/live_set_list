import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

import App from "../App";
import { checkDbHealth, type DbHealthResponse } from "../api";

vi.mock("../api", () => ({
  checkDbHealth: vi.fn(),
}));

const checkDbHealthMock = vi.mocked(checkDbHealth);

describe("App", () => {
  beforeEach(() => {
    checkDbHealthMock.mockReset();
  });

  test("renders initial message", () => {
    render(<App />);
    expect(screen.getByText("点击按钮测试数据库连接")).toBeInTheDocument();
  });

  test("click button calls api and shows success result", async () => {
    let resolveRequest: ((value: DbHealthResponse) => void) | undefined;
    checkDbHealthMock.mockImplementation(
      () =>
        new Promise<DbHealthResponse>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    const user = userEvent.setup();

    render(<App />);
    const button = screen.getByRole("button", { name: "测试数据库(select 1)" });
    await user.click(button);

    expect(checkDbHealthMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "查询中..." })).toBeDisabled();

    expect(resolveRequest).toBeDefined();
    resolveRequest?.({ ok: true, result: 1 });

    await waitFor(() => {
      expect(
        screen.getByText("数据库连接成功，select 1 结果: 1"),
      ).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: "测试数据库(select 1)" })).toBeEnabled();
  });

  test("shows error message when api fails", async () => {
    checkDbHealthMock.mockRejectedValue(new Error("Request failed: 500"));
    const user = userEvent.setup();

    render(<App />);
    await user.click(screen.getByRole("button", { name: "测试数据库(select 1)" }));

    await waitFor(() => {
      expect(
        screen.getByText("数据库连接失败: Request failed: 500"),
      ).toBeInTheDocument();
    });
  });
});
