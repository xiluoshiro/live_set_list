import { describe, expect, test } from "vitest";

import { getPerformanceGroupStatusPresentation } from "./liveStatus";


describe("performance group status", () => {
  // 测试点：多日活动在首场前、日期范围内和末场后分别显示未开始、进行中与已结束。
  test.each([
    ["2026-08-02T00:00:00", "未开始", "upcoming"],
    ["2026-08-05T00:00:00", "进行中", "today"],
    ["2026-08-08T00:00:00", "已结束", "past"],
  ] as const)("derives status at %s", (now, label, tone) => {
    expect(getPerformanceGroupStatusPresentation(
      "2026-08-03",
      "2026-08-07",
      0,
      4,
      new Date(now),
    )).toEqual({ primary: label, tone });
  });

  // 测试点：活动组所有子场次均取消时，取消状态优先于日期范围。
  test("prioritizes all-cancelled groups", () => {
    expect(getPerformanceGroupStatusPresentation(
      "2026-08-03",
      "2026-08-07",
      4,
      4,
      new Date("2026-08-05T00:00:00"),
    )).toEqual({ primary: "已取消", tone: "cancelled" });
  });
});
