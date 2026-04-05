import type { RefObject } from "react";

import type { BandOption, Position, SongInsertRow } from "./types";

type SongAdminSectionProps = {
  mockBands: BandOption[];
  nextSongId: number;
  insertedSongs: SongInsertRow[];
  songName: string;
  songBandId: number;
  songCover: boolean;
  songBandOpen: boolean;
  songBandMenuPos: Position | null;
  songBandTriggerRef: RefObject<HTMLButtonElement | null>;
  songBandMenuRef: RefObject<HTMLDivElement | null>;
  onSongNameChange: (value: string) => void;
  onSongCoverChange: (checked: boolean) => void;
  onOpenSongBandMenu: () => void;
  onSelectSongBand: (bandId: number) => void;
  onSubmitSong: () => void;
};

export function SongAdminSection({
  mockBands,
  nextSongId,
  insertedSongs,
  songName,
  songBandId,
  songCover,
  songBandOpen,
  songBandMenuPos,
  songBandTriggerRef,
  songBandMenuRef,
  onSongNameChange,
  onSongCoverChange,
  onOpenSongBandMenu,
  onSelectSongBand,
  onSubmitSong,
}: SongAdminSectionProps) {
  const selectedBandText = (() => {
    const selected = mockBands.find((band) => band.band_id === songBandId);
    if (!selected) return "请选择 band_id";
    return `${selected.band_id} - ${selected.band_name}`;
  })();

  return (
    <>
      <table className="console-admin-table song-admin-form-table">
        <thead>
          <tr>
            <th>song_name</th>
            <th>band_id</th>
            <th>cover</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <input
                value={songName}
                onChange={(e) => onSongNameChange(e.target.value)}
                placeholder="请输入歌曲名"
              />
            </td>
            <td>
              <button
                ref={songBandTriggerRef}
                type="button"
                className="bands-picker-trigger song-band-trigger"
                onClick={onOpenSongBandMenu}
                title={selectedBandText}
              >
                {selectedBandText}
              </button>
            </td>
            <td>
              <input
                className="is-short-check"
                aria-label="song-cover"
                type="checkbox"
                checked={songCover}
                onChange={(e) => onSongCoverChange(e.target.checked)}
              />
            </td>
          </tr>
        </tbody>
      </table>

      {songBandOpen && songBandMenuPos && (
        <div
          className="bands-floating-menu"
          ref={songBandMenuRef}
          style={{ top: songBandMenuPos.top, left: songBandMenuPos.left, width: songBandMenuPos.width }}
        >
          {mockBands.map((band) => (
            <label key={band.band_id}>
              <input
                type="radio"
                name="song-band-picker"
                checked={songBandId === band.band_id}
                onChange={() => onSelectSongBand(band.band_id)}
              />
              <span>
                {band.band_id} - {band.band_name}
              </span>
            </label>
          ))}
        </div>
      )}

      <div className="console-submit-row song-submit-row">
        <button type="button" onClick={onSubmitSong} className="console-submit-btn">
          提交插入
        </button>
      </div>

      <table className="console-admin-table song-result-table">
        <thead>
          <tr>
            <th>song_id</th>
            <th>song_name</th>
          </tr>
        </thead>
        <tbody>
          {insertedSongs.length === 0 ? (
            <tr>
              <td colSpan={2} className="empty-cell">暂无新增歌曲记录</td>
            </tr>
          ) : (
            insertedSongs.map((row) => (
              <tr key={row.song_id}>
                <td>{row.song_id}</td>
                <td>{row.song_name}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </>
  );
}
