import { describe, expect, it } from "vitest";

import {
  formatIsoDate,
  getCurrentMonthKey,
  getDaysInMonth,
  getFirstWeekdayOffset,
  getMonthDateRange,
  getMonthParts,
  monthKeyToLabel,
  monthKeyToShortLabel,
  shiftMonthKey,
} from "../calendarMonth";

describe("calendarMonth", () => {
  it("构造 YYYY-MM 月份键并解析", () => {
    // 测试点：月份键统一为两位月份数字的 YYYY-MM 格式。
    expect(getMonthParts("2026-08")).toEqual({ year: 2026, month: 8 });
  });

  it("从客户端日期取当前月份键", () => {
    // 测试点：当前月由客户端本地日期确定。
    const now = new Date(2026, 7, 3);
    expect(getCurrentMonthKey(now)).toBe("2026-08");
  });

  it("跨年平移月份键", () => {
    // 测试点：向前或向后平移月份，跨年时年份正确进位。
    expect(shiftMonthKey("2026-08", 1)).toBe("2026-09");
    expect(shiftMonthKey("2026-08", -1)).toBe("2026-07");
    expect(shiftMonthKey("2026-12", 1)).toBe("2027-01");
    expect(shiftMonthKey("2026-01", -1)).toBe("2025-12");
    expect(shiftMonthKey("2026-08", 4)).toBe("2026-12");
    expect(shiftMonthKey("2026-08", 5)).toBe("2027-01");
  });

  it("生成月份标题文案", () => {
    // 测试点：月份标题和短标签保持固定格式。
    expect(monthKeyToLabel("2026-08")).toBe("2026 年 8 月");
    expect(monthKeyToShortLabel("2026-08")).toBe("2026.08");
  });

  it("返回左闭右开的月内日期范围", () => {
    // 测试点：月内范围为当月 1 日到次月 1 日，跨年月份正确。
    const { monthStart, nextMonthStart } = getMonthDateRange("2026-08");
    expect(monthStart).toEqual(new Date(2026, 7, 1));
    expect(nextMonthStart).toEqual(new Date(2026, 8, 1));
    const december = getMonthDateRange("2026-12");
    expect(december.nextMonthStart).toEqual(new Date(2027, 0, 1));
  });

  it("计算当月天数与首日星期偏移", () => {
    // 测试点：2026-08 有 31 天；周一为首的日历中 8 月 1 日（周六）偏移为 5。
    expect(getDaysInMonth("2026-08")).toBe(31);
    expect(getDaysInMonth("2026-02")).toBe(28);
    expect(getFirstWeekdayOffset("2026-08")).toBe(5);
  });

  it("格式化 ISO 日期为补零字符串", () => {
    // 测试点：ISO 日期各段补零，保持与后端 live_date 格式一致。
    expect(formatIsoDate(2026, 8, 3)).toBe("2026-08-03");
    expect(formatIsoDate(2026, 12, 31)).toBe("2026-12-31");
  });
});
