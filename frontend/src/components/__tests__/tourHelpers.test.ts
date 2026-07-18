import { describe, expect, test } from "vitest";

import { getTourStopShortTitle } from "../tourHelpers";

describe("getTourStopShortTitle", () => {
  // 测试点：仅删除完全匹配的巡演名前缀，并清理余下标题两端空白。
  test("缩写巡演场次标题", () => {
    expect(getTourStopShortTitle("Tour 2026   东京公演  ", "Tour 2026")).toBe("东京公演");
    expect(getTourStopShortTitle("2026 Tour 东京公演", "Tour 2026")).toBe("2026 Tour 东京公演");
    expect(getTourStopShortTitle("Tour 2026", "Tour 2026")).toBe("Tour 2026");
  });
});
