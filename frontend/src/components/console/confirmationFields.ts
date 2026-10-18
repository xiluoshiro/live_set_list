import type { CoverEntry, SongOwnership, CatalogMember } from "../../api";
import type { BandOption } from "./types";
import type { UpdateChange } from "./UpdateDiffTable";

const ownershipModeLabels = { pending: "待回填", bands: "乐队", members: "成员", mixed: "乐队与成员" };

const listValue = (values: unknown[]) => values.map(String).join("、") || "无";

export function ownershipChanges(before: SongOwnership, after: SongOwnership, bands: BandOption[], members: CatalogMember[]): UpdateChange[] {
  const bandName = (id: number) => bands.find(band => band.band_id === id)?.band_name ?? `#${id}`;
  const memberName = (id: number) => members.find(member => member.member_id === id)?.display_name ?? `#${id}`;
  const groupIds = [...new Set([...before.member_groups, ...after.member_groups].map(group => group.band_id))];
  return [
    { field: "归属模式", before: ownershipModeLabels[before.mode], after: ownershipModeLabels[after.mode] },
    { field: "归属乐队", before: listValue(before.band_ids.map(bandName)), after: listValue(after.band_ids.map(bandName)) },
    { field: "成员所属乐队", before: listValue(before.member_groups.map(group => bandName(group.band_id))), after: listValue(after.member_groups.map(group => bandName(group.band_id))) },
    ...groupIds.map(id => ({ field: `${bandName(id)} 固定成员`, table: { source: "固定成员", row: `#${id} ${bandName(id)}`, column: "成员" },
      before: listValue((before.member_groups.find(group => group.band_id === id)?.member_ids ?? []).map(memberName)),
      after: listValue((after.member_groups.find(group => group.band_id === id)?.member_ids ?? []).map(memberName)),
    })),
  ];
}

export function coverChanges(before: CoverEntry[], after: CoverEntry[]): UpdateChange[] {
  return Array.from({ length: Math.max(before.length, after.length) }, (_, index) => [
    { field: `封面 ${index + 1} 名称`, table: { source: "封面", row: String(index + 1), column: "名称" }, before: before[index]?.name ?? "", after: after[index]?.name ?? "" },
    { field: `封面 ${index + 1} URL`, table: { source: "封面", row: String(index + 1), column: "URL" }, before: before[index]?.url ?? "", after: after[index]?.url ?? "" },
  ]).flat();
}

/** Expand structured fields; lists of scalar values remain one editable field. */
export function confirmationFieldChanges(field: string, before: unknown, after: unknown): UpdateChange[] {
  const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  const beforeRecord = record(before), afterRecord = record(after);
  const keys = [...new Set([...Object.keys(beforeRecord), ...Object.keys(afterRecord)])];
  if (keys.length) return keys.flatMap(key => confirmationFieldChanges(`${field}.${key}`, beforeRecord[key], afterRecord[key]));
  if ([before, after].some(value => Array.isArray(value) && value.some(item => item !== null && typeof item === "object"))) {
    const left = Array.isArray(before) ? before : [], right = Array.isArray(after) ? after : [];
    return Array.from({ length: Math.max(left.length, right.length) }, (_, index) =>
      confirmationFieldChanges(`${field}[${index + 1}]`, left[index], right[index])).flat();
  }
  const value = (item: unknown): string => item === null || item === undefined || item === "" ? "-"
    : Array.isArray(item) ? item.map(String).join(" / ") || "-"
    : typeof item === "object" ? "-" : String(item);
  return [{ field, before: value(before), after: value(after) }];
}

export function bandFieldChanges<T extends { band_id: number }>(field: string, before: T[], after: T[]): UpdateChange[] {
  const left = new Map(before.map(item => [item.band_id, item])), right = new Map(after.map(item => [item.band_id, item]));
  return [...new Set([...left.keys(), ...right.keys()])].sort((a, b) => a - b).flatMap(id =>
    confirmationFieldChanges(`${field}[band_id=${id}]`, left.get(id), right.get(id)));
}
