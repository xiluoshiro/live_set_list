import type { CatalogMember, ConsoleSongItem, SongOwnership } from "../../api";
import { parse } from "./setlistParser/generatedParser.js";
import { emptyOwnership } from "./OwnershipFields";
import type { BandOption } from "./types";

export type ParsedAlbumTrack = { song_name: string; ownership: SongOwnership; tag: string };
export const albumSongLabel = (song: Pick<ConsoleSongItem, "song_id" | "song_name" | "version_label" | "band_name">) =>
  `#${song.song_id} ${song.song_name} / ${song.version_label || "默认版本"} / ${song.band_name ?? "待回填"}`;

export function parseAlbumTrackText(text: string, bands: BandOption[], members: CatalogMember[]) {
  // Album lists also commonly use plain names or 1. numbering instead of M1.
  const input = text.split(/\r\n|\n|\r/).map(line => {
    const value = line.trim();
    if (!value || /^[<＜]/.test(value) || /^(OP|WEN|EN|RH|M)\d+[. ]/.test(value)) return value;
    return `M1. ${value.replace(/^\d+[.、．)）\s]+\s*/, "")}`;
  }).join("\n");
  const rows: ParsedAlbumTrack[] = [];
  const warnings: string[] = [];
  let tag = "";
  for (const line of parse(input)) {
    if (line.type === "performer_context") { tag = line.text; continue; }
    if (line.type !== "song_entry" || !line.songName.trim()) {
      if (line.type === "unknown_line") warnings.push(`第 ${line.line} 行未识别：${line.text}`);
      continue;
    }
    const owner = emptyOwnership();
    let unresolved = false;
    for (const token of tag.split("×").map(value => value.trim()).filter(Boolean)) {
      const from = token.match(/^(.+?)\s+from\s+(.+)$/i);
      const bandName = from?.[2].trim() ?? token;
      const band = bands.find(item => item.band_id > 0 && (item.band_name === bandName || item.band_abbr === bandName));
      if (!band) { unresolved = true; continue; }
      if (!from) {
        if (!owner.band_ids.includes(band.band_id)) owner.band_ids.push(band.band_id);
      } else {
        const group = owner.member_groups.find(item => item.band_id === band.band_id) ?? { band_id: band.band_id, member_ids: [] };
        if (!owner.member_groups.includes(group)) owner.member_groups.push(group);
        for (const name of from[1].split(/[,、]/).map(value => value.trim()).filter(Boolean)) {
          const candidates = members.filter(member => member.display_name === name);
          if (candidates.length !== 1 || !band.band_members?.includes(name)) { unresolved = true; continue; }
          if (!group.member_ids.includes(candidates[0].member_id)) group.member_ids.push(candidates[0].member_id);
        }
      }
    }
    owner.mode = owner.band_ids.length ? owner.member_groups.length ? "mixed" : "bands" : owner.member_groups.length ? "members" : "pending";
    if (unresolved) warnings.push(`第 ${line.line} 行标签未完整匹配，请确认歌曲归属：${tag}`);
    rows.push({ song_name: line.songName.trim(), tag, ownership: unresolved ? emptyOwnership() : owner });
  }
  return { rows, warnings: [...new Set(warnings)] };
}
