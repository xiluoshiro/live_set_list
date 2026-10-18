import type { CatalogMember, SongOwnership } from "../../api";
import { ownershipFields } from "./OwnershipFields";
import type { BandOption } from "./types";

export type BatchSongConfirmRow = {
  row_key: number; song_name: string; ownership: SongOwnership;
};

export function BatchSongConfirmation({ rows, bands, members, busy, errors = [], onOwnershipChange }: {
  rows: BatchSongConfirmRow[]; bands: BandOption[]; members: CatalogMember[]; busy: boolean;
  errors?: string[]; onOwnershipChange: (rowKey: number, ownership: SongOwnership) => void;
}) {
  const memberBands = [...new Set(rows.flatMap(row => row.ownership.member_groups.map(group => group.band_id)))].sort((left, right) => left - right);
  return <>
    {errors.length > 0 && <ul className="setlist-paste-warnings" style={{ marginBottom: 12 }}>
      {errors.map((error, index) => <li key={index}>{error}</li>)}
    </ul>}
    <div className="console-table-wrap console-confirm-setlist-wrap">
      <table className="console-admin-table console-confirm-batch-song-table" aria-label="批量新增歌曲确认">
        <colgroup><col /><col className="song-create-mode-column" />
          <col className="song-create-band-column" />
          <col className="song-create-members-column" />
          {memberBands.map(id => <col key={id} className="song-create-members-column" />)}
        </colgroup>
        <thead><tr><th>歌曲名称</th><th>归属模式</th>
          <th>归属乐队</th><th>成员所属乐队</th>
          {memberBands.map(id => <th key={id}>{bands.find(band => band.band_id === id)?.band_name ?? `#${id}`} 固定成员</th>)}
        </tr></thead>
        <tbody>{rows.map(row => {
          const fields = ownershipFields(row.ownership, bands, members, busy, owner => onOwnershipChange(row.row_key, owner), { hideMemberLabels: true });
          return <tr key={row.row_key}>
            <td>{row.song_name}</td><td>{fields.ownershipModeField}</td>
            <td>{fields.hasBands ? fields.bandPicker : "—"}</td>
            <td>{fields.hasMembers ? fields.memberBandPicker : "—"}</td>
            {memberBands.map(id => {
              const index = row.ownership.member_groups.findIndex(group => group.band_id === id);
              return <td key={id}>{index >= 0 ? fields.memberPickers[index] : "—"}</td>;
            })}
          </tr>;
        })}</tbody>
      </table>
    </div>
  </>;
}
