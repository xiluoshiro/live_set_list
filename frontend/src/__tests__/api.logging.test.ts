import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const logInfoMock = vi.fn();
const logErrorMock = vi.fn();

vi.mock("../logger", () => ({
  logInfo: logInfoMock,
  logWarn: vi.fn(),
  logError: logErrorMock,
}));

type FetchMock = ReturnType<typeof vi.fn>;

function makeJsonResponse<T>(payload: T, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => payload,
  } as Response;
}

describe("api logging", () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    vi.resetModules();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    logInfoMock.mockReset();
    logErrorMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("成功请求会记录开始和成功日志", async () => {
    // 测试点：真实发出的 API 请求成功后，应留下 start/success 两层网络日志。
    fetchMock.mockResolvedValueOnce(makeJsonResponse({ ok: true, result: 1 }));
    const { checkDbHealth } = await import("../api");

    await checkDbHealth();

    expect(logInfoMock).toHaveBeenNthCalledWith(
      1,
      "api_request_start",
      expect.objectContaining({
        method: "GET",
        request_kind: "health",
      }),
    );
    expect(logInfoMock).toHaveBeenNthCalledWith(
      2,
      "api_request_success",
      expect.objectContaining({
        method: "GET",
        request_kind: "health",
        status: 200,
      }),
    );
    expect(logErrorMock).not.toHaveBeenCalled();
  });

  test("非 2xx 响应会记录错误日志", async () => {
    // 测试点：后端返回非 2xx 时，API 层应记录 error 日志并保留响应状态。
    fetchMock.mockResolvedValueOnce(makeJsonResponse({ detail: "boom" }, false, 500));
    const { getLiveDetail } = await import("../api");

    await expect(getLiveDetail(1)).rejects.toThrow("Request failed: 500");

    expect(logErrorMock).toHaveBeenCalledWith(
      "api_request_error",
      expect.objectContaining({
        method: "GET",
        request_kind: "live_detail",
        status: 500,
        message: "Request failed: 500",
      }),
    );
  });

  test("请求超时会记录错误日志", async () => {
    // 测试点：网络超时会统一落成 Request timeout 日志，方便和业务错误区分。
    fetchMock.mockRejectedValueOnce(new DOMException("The operation was aborted.", "AbortError"));
    const { getLiveDetailsBatch } = await import("../api");

    await expect(getLiveDetailsBatch([1])).rejects.toThrow("Request timeout");

    expect(logErrorMock).toHaveBeenCalledWith(
      "api_request_error",
      expect.objectContaining({
        method: "POST",
        request_kind: "live_details_batch",
        message: "Request timeout",
      }),
    );
  });
});
