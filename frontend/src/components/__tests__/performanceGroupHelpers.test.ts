import { describe, expect, test } from "vitest";

import { getGroupedLiveShortTitle } from "../performanceGroupHelpers";

describe("getGroupedLiveShortTitle", () => {
  // 测试点：Live 名称以活动组名称开头时，返回去除前缀后的部分
  test("removes group title prefix from live title", () => {
    expect(
      getGroupedLiveShortTitle(
        "Ave Mujica LIVE TOUR 2026 Exitus 東京公演",
        "Ave Mujica LIVE TOUR 2026 Exitus",
      ),
    ).toBe("東京公演");
  });

  // 测试点：Live 名称不以活动组名称开头时，返回完整原名称
  test("returns full live title when it does not start with group title", () => {
    expect(
      getGroupedLiveShortTitle(
        "Roselia Herbst LIVE 2026",
        "Ave Mujica LIVE TOUR 2026 Exitus",
      ),
    ).toBe("Roselia Herbst LIVE 2026");
  });

  // 测试点：去除前缀后结果为空字符串时，保留原 Live 名称
  test("keeps original live title when trimmed result would be empty", () => {
    expect(
      getGroupedLiveShortTitle("MyGO!!!!! 1st LIVE", "MyGO!!!!! 1st LIVE"),
    ).toBe("MyGO!!!!! 1st LIVE");
  });

  // 测试点：活动组名称和 Live 名称相同时，保留原名称
  test("retains original title when group and live titles are identical", () => {
    expect(
      getGroupedLiveShortTitle("Poppin'Party 10th Anniversary", "Poppin'Party 10th Anniversary"),
    ).toBe("Poppin'Party 10th Anniversary");
  });

  // 测试点：去除前缀后正确 trim 首尾空格
  test("trims whitespace after removing prefix", () => {
    expect(
      getGroupedLiveShortTitle(
        "BanG Dream! 12th LIVE DAY 1: Poppin'Party",
        "BanG Dream! 12th LIVE",
      ),
    ).toBe("DAY 1: Poppin'Party");
  });

  // 测试点：不做大小写模糊匹配
  test("does not do case-insensitive matching", () => {
    expect(
      getGroupedLiveShortTitle(
        "Roselia Herbst LIVE 2026",
        "roselia herbst live 2026",
      ),
    ).toBe("Roselia Herbst LIVE 2026");
  });
});
