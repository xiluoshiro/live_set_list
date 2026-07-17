import { describe, expect, test } from "vitest";

import { formatLiveType, LIVE_TYPE_LABELS, LIVE_TYPE_OPTIONS } from "./constants";

describe("Live 类型中文映射", () => {
  // 测试点：控制台、列表与统计页共用同一字典，并将 multi_act 稳定显示为“拼盘”。
  test("multi_act 使用统一的拼盘标签", () => {
    expect(LIVE_TYPE_LABELS.multi_act).toBe("拼盘");
    expect(formatLiveType("multi_act")).toBe("拼盘");
    expect(LIVE_TYPE_OPTIONS.find((option) => option.value === "multi_act")?.label).toBe("拼盘");
  });
});
