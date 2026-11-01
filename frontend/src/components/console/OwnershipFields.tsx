import type { CatalogMember, SongOwnership } from "../../api";
import type { BandOption } from "./types";
import { ConsoleMultiSelect } from "./ConsoleMultiSelect";

export const emptyOwnership = (): SongOwnership => ({ mode: "pending", band_ids: [], member_groups: [] });
export function ownershipFromPerformers(performers: Record<string, string[]>, bands: BandOption[], members: CatalogMember[]): SongOwnership {
  const owner = emptyOwnership();
  for (const [name, names] of Object.entries(performers)) {
    const band = bands.find(item => item.band_id > 0 && item.band_name === name);
    if (!band) return emptyOwnership();
    const wholeBand = names.length === 0 || !band.band_members?.length ||
      (names.length === band.band_members.length && names.every(member => band.band_members!.includes(member)));
    if (wholeBand) owner.band_ids.push(band.band_id);
    else {
      const ids = names.map(name => {
        const matches = members.filter(member => member.display_name === name);
        return matches.length === 1 ? matches[0].member_id : null;
      });
      if (ids.some(id => id === null)) return emptyOwnership();
      owner.member_groups.push({ band_id: band.band_id, member_ids: ids as number[] });
    }
  }
  owner.band_ids.sort((left, right) => left - right);
  owner.member_groups.sort((left, right) => left.band_id - right.band_id);
  owner.mode = owner.band_ids.length ? owner.member_groups.length ? "mixed" : "bands" : owner.member_groups.length ? "members" : "pending";
  return ownershipValid(owner) ? owner : emptyOwnership();
}
export const ownershipValid = (owner: SongOwnership) => owner.mode === "pending" ||
  ((owner.mode === "members" || owner.band_ids.length > 0) &&
   (owner.mode === "bands" || (owner.member_groups.length > 0 && owner.member_groups.every(group => group.member_ids.length > 0))) &&
   new Set(owner.member_groups.flatMap(group => group.member_ids)).size === owner.member_groups.reduce((sum, group) => sum + group.member_ids.length, 0));
export const ownershipSummary = (owner: SongOwnership, bands: BandOption[], members: CatalogMember[]) =>
  owner.mode === "pending" ? "待回填" : [
    ...owner.band_ids.map(id => bands.find(band => band.band_id === id)?.band_name ?? `#${id}`),
    ...owner.member_groups.map(group => `${bands.find(band => band.band_id === group.band_id)?.band_name ?? `#${group.band_id}`}：${group.member_ids.map(id => members.find(member => member.member_id === id)?.display_name ?? `#${id}`).join("、")}`),
  ].join(" / ");

export function ownershipFields(owner: SongOwnership, bands: BandOption[], members: CatalogMember[], disabled: boolean, onChange: (owner: SongOwnership) => void,
  { hideMemberLabels = false }: { hideMemberLabels?: boolean } = {}) {
  const bandOptions = bands.filter(band => band.band_id > 0).sort((left, right) => left.band_id - right.band_id)
    .map(band => ({ id: band.band_id, label: band.band_name }));
  const hasBands = owner.mode === "bands" || owner.mode === "mixed";
  const hasMembers = owner.mode === "members" || owner.mode === "mixed";
  const ownershipModeField = <select aria-label="归属模式" disabled={disabled} value={owner.mode} onChange={event => {
    const mode = event.target.value as SongOwnership["mode"];
    onChange({ mode, band_ids: mode === "bands" || mode === "mixed" ? owner.band_ids : [], member_groups: mode === "members" || mode === "mixed" ? owner.member_groups : [] });
  }}>
    <option value="pending">待回填</option><option value="bands">乐队</option><option value="members">成员</option><option value="mixed">乐队与成员</option>
  </select>;
  const bandPicker = <ConsoleMultiSelect label="归属乐队" options={bandOptions} hideLabel showIds value={owner.band_ids} disabled={disabled}
    onChange={band_ids => onChange({ ...owner, band_ids: band_ids.sort((left, right) => left - right) })} />;
  const memberBandPicker = <ConsoleMultiSelect label="成员所属乐队" options={bandOptions} hideLabel showIds
    value={owner.member_groups.map(group => group.band_id)} disabled={disabled}
    onChange={ids => onChange({ ...owner, member_groups: ids.sort((left, right) => left - right).map(id => owner.member_groups.find(group => group.band_id === id) ?? { band_id: id, member_ids: [] }) })} />;
  const memberPickers = owner.member_groups.map(group => {
    const band = bands.find(band => band.band_id === group.band_id);
    const memberOptions = members.filter(member => band?.band_members?.includes(member.display_name))
      .map(member => ({ id: member.member_id, label: member.display_name }));
    return <ConsoleMultiSelect key={group.band_id}
      label={`${band?.band_name ?? `#${group.band_id}`} 固定成员`}
      options={memberOptions} value={group.member_ids} disabled={disabled} hideLabel={hideMemberLabels}
      onChange={member_ids => onChange({ ...owner, member_groups: owner.member_groups.map(item => item.band_id === group.band_id ? { ...item, member_ids } : item) })} />;
  });
  return { bandOptions, hasBands, hasMembers, ownershipModeField, bandPicker, memberBandPicker, memberPickers };
}
