import { afterEach, describe, expect, it, vi } from "vitest";

type FormatStartTime = (value: string | null, dateIso?: string) => string;

async function loadFormatStartTime(timezone: string): Promise<FormatStartTime> {
  vi.stubEnv("TZ", timezone);
  vi.resetModules();
  const module = await import("../CalendarDayDetail");
  return module.formatStartTime;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("formatStartTime 时区转换", () => {
  it("用户时区 +08:00 下，+09:00 的场次显示为本地 18:00", async () => {
    // 测试点：+09:00 场次（UTC 10:00）在 Asia/Shanghai 应显示 18:00，验证正偏移换算。
    const formatStartTime = await loadFormatStartTime("Asia/Shanghai");
    expect(formatStartTime("19:00:00+09:00", "2026-08-06")).toBe("18:00");
  });

  it("用户时区 +08:00 下，UTC 场次 10:30 显示为 18:30", async () => {
    // 测试点：零偏移场次在 +08:00 用户时区应显示 18:30，验证秒数包含在解析中。
    const formatStartTime = await loadFormatStartTime("Asia/Shanghai");
    expect(formatStartTime("10:30:00+00:00", "2026-08-06")).toBe("18:30");
  });

  it("用户时区 +08:00 下，负偏移 -05:00 的场次跨日换算为 08:00", async () => {
    // 测试点：19:00-05:00 的 UTC 时刻已是次日 00:00，在 +08:00 应显示次日 08:00，验证跨日边界。
    const formatStartTime = await loadFormatStartTime("Asia/Shanghai");
    expect(formatStartTime("19:00:00-05:00", "2026-08-06")).toBe("08:00");
  });

  it("用户时区 +08:00 下，半小时偏移 -03:30 的场次显示为 23:30", async () => {
    // 测试点：12:00-03:30（UTC 15:30）在 +08:00 应显示 23:30，验证非整点偏移换算。
    const formatStartTime = await loadFormatStartTime("Asia/Shanghai");
    expect(formatStartTime("12:00:00-03:30", "2026-08-06")).toBe("23:30");
  });

  it("无秒数的紧凑格式同样解析", async () => {
    // 测试点：HH:MM+HH:MM 无秒格式应同 HH:MM:SS 一样换算，验证正则的秒数可选项。
    const formatStartTime = await loadFormatStartTime("Asia/Shanghai");
    expect(formatStartTime("19:00+09:00", "2026-08-06")).toBe("18:00");
  });

  it("America/New_York 夏季（EDT，UTC-4）的 UTC 场次显示为 08:00", async () => {
    // 测试点：夏令时月份 12:00 UTC 在纽约应显示 08:00，验证 DST 规则生效。
    const formatStartTime = await loadFormatStartTime("America/New_York");
    expect(formatStartTime("12:00:00+00:00", "2026-08-06")).toBe("08:00");
  });

  it("America/New_York 冬季（EST，UTC-5）的 UTC 场次显示为 07:00", async () => {
    // 测试点：非夏令时月份 12:00 UTC 在纽约应显示 07:00，验证同一时区冬夏换算不同。
    const formatStartTime = await loadFormatStartTime("America/New_York");
    expect(formatStartTime("12:00:00+00:00", "2026-01-06")).toBe("07:00");
  });

  it("用户与场次同偏移（+09:00）时显示不变", async () => {
    // 测试点：同偏移时本地显示等于表盘时间，验证换算不引入偏差。
    const formatStartTime = await loadFormatStartTime("Asia/Tokyo");
    expect(formatStartTime("19:00:00+09:00", "2026-08-06")).toBe("19:00");
  });

  it("跨日边界的场次只取本地小时分钟", async () => {
    // 测试点：23:30-05:00 的 UTC 时刻为次日 04:30，在 +08:00 应显示 12:30，验证只输出 HH:MM 不拼接日期。
    const formatStartTime = await loadFormatStartTime("Asia/Shanghai");
    expect(formatStartTime("23:30:00-05:00", "2026-08-06")).toBe("12:30");
  });

  it("null 返回 时间未定", async () => {
    // 测试点：无开演时间时应显示占位文案而非崩溃，验证空值回退。
    const formatStartTime = await loadFormatStartTime("Asia/Shanghai");
    expect(formatStartTime(null)).toBe("时间未定");
  });

  it("无偏移或畸形字符串回退原解析逻辑", async () => {
    // 测试点：后端异常数据（无偏移或不可解析）应按原逻辑截取或原样返回，保证展示不中断。
    const formatStartTime = await loadFormatStartTime("Asia/Shanghai");
    expect(formatStartTime("19:00", "2026-08-06")).toBe("19:00");
    expect(formatStartTime("not-a-time", "2026-08-06")).toBe("not-a-time");
  });
});
