import type { ConsoleBandHistory } from "../../api";
import type { BandOption } from "./types";
import type { UpdateChange } from "./UpdateDiffTable";

const columns: Record<string, string> = {
  members: "成员",
  band_name_version_id: "使用名称",
  base_lineup_version_id: "基准阵容",
  next_lineup_version_id: "后续阵容",
};

/** Keep each submitted field visible while resolving database IDs for confirmation. */
export function describeLiveBandChanges(
  changes: UpdateChange[],
  bands: BandOption[],
  histories: Record<number, ConsoleBandHistory>,
): UpdateChange[] {
  return changes.flatMap(change => {
    const match = /^(event_attendees|band_lineup_contexts)\[band_id=(\d+)\]\.([^.[\]]+)$/.exec(change.field);
    if (!match) return [change];
    const [, source, bandIdText, column] = match;
    // The band's name and ID identify the row, rather than repeating them as a column.
    if (column === "band_id") return [];
    if (!columns[column]) return [change];
    const bandId = Number(bandIdText);
    const history = histories[bandId];
    const bandName = bands.find(band => band.band_id === bandId)?.band_name ?? history?.current_name;
    const describe = (value: string) => {
      if (value === "-") return column === "next_lineup_version_id" ? "无" : value;
      const id = Number(value);
      if (column === "band_name_version_id") {
        const name = history?.name_versions.find(version => version.name_version_id === id);
        return name ? `${name.band_name}（#${id}）` : `名称版本 #${id}`;
      }
      if (column === "base_lineup_version_id" || column === "next_lineup_version_id") {
        const lineup = history?.lineup_versions.find(version => version.lineup_version_id === id);
        return lineup ? `${lineup.version_label || `V${lineup.version_no}`}（#${id}）` : `阵容版本 #${id}`;
      }
      return value;
    };
    return [{
      ...change,
      before: describe(change.before),
      after: describe(change.after),
      table: {
        source: source === "event_attendees" ? "出演成员" : "乐队版本",
        row: bandName ? `${bandName}（#${bandId}）` : `#${bandId}`,
        rowHeading: "乐队",
        column: columns[column],
      },
    }];
  });
}
