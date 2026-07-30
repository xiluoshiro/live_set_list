import type { RefObject } from "react";

import type { BandOption, Position, SongInsertRow } from "./types";

type SongAdminSectionProps = {
  bandOptions: BandOption[];
  insertedSongs: SongInsertRow[];
  songCandidates: SongInsertRow[];
  songQuery: string;
  songBandFilterId: number | null;
  songPage: number;
  songTotal: number;
  songTotalPages: number;
  songLoading: boolean;
  editingSongId: number | null;
  songName: string;
  songBandId: number | null;
  songCover: boolean;
  songBandOpen: boolean;
  songBandMenuPos: Position | null;
  songBandTriggerRef: RefObject<HTMLButtonElement>;
  songBandMenuRef: RefObject<HTMLDivElement>;
  onSongNameChange: (value: string) => void;
  onSongQueryChange: (value: string) => void;
  onSongBandFilterChange: (bandId: number | null) => void;
  onQuerySongs: () => void;
  onSongPageChange: (page: number) => void;
  onSelectSong: (songId: number) => void;
  onCreateNewSong: () => void;
  onSongCoverChange: (checked: boolean) => void;
  onOpenSongBandMenu: () => void;
  onSelectSongBand: (bandId: number) => void;
  onClearSong: () => void;
  onSubmitSong: () => void;
  submitDisabled: boolean;
};

export function SongAdminSection({
  bandOptions,
  insertedSongs,
  songCandidates,
  songQuery,
  songBandFilterId,
  songPage,
  songTotal,
  songTotalPages,
  songLoading,
  editingSongId,
  songName,
  songBandId,
  songCover,
  songBandOpen,
  songBandMenuPos,
  songBandTriggerRef,
  songBandMenuRef,
  onSongNameChange,
  onSongQueryChange,
  onSongBandFilterChange,
  onQuerySongs,
  onSongPageChange,
  onSelectSong,
  onCreateNewSong,
  onSongCoverChange,
  onOpenSongBandMenu,
  onSelectSongBand,
  onClearSong,
  onSubmitSong,
  submitDisabled,
}: SongAdminSectionProps) {
  const selectedBandText = (() => {
    const selected = bandOptions.find((band) => band.band_id === songBandId);
    if (!selected) return "请选择 band_id";
    return `${selected.band_id} - ${selected.band_name}`;
  })();

  return (
    <section className="tour-admin-section" aria-label="歌曲管理">
      <div className="tour-admin-toolbar">
        <label htmlFor="song-admin-select">已有歌曲</label>
        <select
          id="song-admin-select"
          className="console-entity-select"
          aria-label="选择要编辑的歌曲"
          value={editingSongId ?? ""}
          onChange={(event) => onSelectSong(Number(event.target.value))}
        >
          <option value="">选择要编辑的歌曲</option>
          {songCandidates.map((song) => (
            <option key={song.song_id} value={song.song_id}>
              #{song.song_id} {song.song_name} / {song.band_name ?? song.band_id}
            </option>
          ))}
        </select>
        <button type="button" className="console-submit-btn" onClick={onCreateNewSong}>新建歌曲</button>
      </div>

      <div className="tour-admin-fields song-admin-fields">
        <label>
          歌曲名称
          <input
            value={songName}
            onChange={(event) => onSongNameChange(event.target.value)}
            placeholder="请输入歌曲名"
          />
        </label>
        <fieldset className="tour-band-field">
          <legend>归属 Band</legend>
          <button
            ref={songBandTriggerRef}
            type="button"
            className="bands-picker-trigger tour-band-trigger song-band-trigger"
            onClick={onOpenSongBandMenu}
            title={selectedBandText}
          >
            {selectedBandText}
          </button>
        </fieldset>
        <label className="song-cover-field">
          <span>翻唱</span>
          <span className="song-cover-control">
            <input
              aria-label="song-cover"
              type="checkbox"
              checked={songCover}
              onChange={(event) => onSongCoverChange(event.target.checked)}
            />
            是
          </span>
        </label>
      </div>

      {songBandOpen && songBandMenuPos && (
        <div
          className="bands-floating-menu"
          ref={songBandMenuRef}
          onMouseDown={(event) => event.stopPropagation()}
          onWheel={(event) => event.stopPropagation()}
          style={{ top: songBandMenuPos.top, left: songBandMenuPos.left, width: songBandMenuPos.width }}
        >
          {bandOptions.map((band) => (
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

      <div className="tour-admin-block">
        <h3>搜索歌曲</h3>
        <div className="tour-candidate-search">
          <input
            id="song-admin-query"
            value={songQuery}
            onChange={(event) => onSongQueryChange(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") onQuerySongs(); }}
            placeholder="输入歌曲名"
          />
          <select
            className="song-band-filter"
            aria-label="按乐队查询"
            value={songBandFilterId ?? ""}
            onChange={(event) => onSongBandFilterChange(
              event.target.value === "" ? null : Number(event.target.value),
            )}
          >
            <option value="">全部 Band</option>
            {bandOptions.map((band) => (
              <option key={band.band_id} value={band.band_id}>
                {band.band_name}
              </option>
            ))}
          </select>
          <button type="button" className="console-ghost-btn" onClick={onQuerySongs}>查询</button>
        </div>
        <div className="console-table-wrap">
          <table className="console-admin-table tour-candidate-table song-candidate-table" aria-label="歌曲搜索结果">
            <colgroup>
              <col className="song-candidate-col-id" />
              <col />
              <col className="song-candidate-col-band" />
              <col className="song-candidate-col-cover" />
              <col className="tour-candidate-col-action" />
            </colgroup>
            <thead>
              <tr>
                <th>song_id</th>
                <th>song_name</th>
                <th>Band</th>
                <th>翻唱</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {songCandidates.length === 0 ? (
                <tr>
                  <td colSpan={5} className="empty-cell">没有符合条件的歌曲</td>
                </tr>
              ) : (
                songCandidates.map((song) => (
                  <tr key={song.song_id}>
                    <td>{song.song_id}</td>
                    <td>{song.song_name}</td>
                    <td>{song.band_name ?? song.band_id}</td>
                    <td>{song.cover ? "是" : "否"}</td>
                    <td>
                      <button
                        type="button"
                        className="console-submit-btn"
                        onClick={() => onSelectSong(song.song_id)}
                      >
                        {editingSongId === song.song_id ? "编辑中" : "编辑"}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="tour-candidate-pager">
          <button
            type="button"
            className="console-ghost-btn"
            onClick={() => onSongPageChange(Math.max(1, songPage - 1))}
            disabled={songLoading || songPage <= 1}
          >
            上一页
          </button>
          <span>第 {songPage} / {songTotalPages} 页 · 每页 20 首 · 共 {songTotal} 首</span>
          <button
            type="button"
            className="console-ghost-btn"
            onClick={() => onSongPageChange(Math.min(songTotalPages, songPage + 1))}
            disabled={songLoading || songPage >= songTotalPages}
          >
            下一页
          </button>
        </div>
      </div>

      <div className="console-submit-row song-submit-row">
        <button type="button" onClick={onClearSong} className="console-ghost-btn">
          清空
        </button>
        <button type="button" onClick={onSubmitSong} className="console-submit-btn" disabled={submitDisabled}>
          {editingSongId === null ? "创建歌曲" : "保存修改"}
        </button>
      </div>

      <div className="console-table-wrap live-history-wrap">
        <table
          className="console-admin-table song-result-table live-history-table"
          aria-label="歌曲操作记录"
        >
          <thead>
            <tr>
              <th>song_id</th>
              <th>song_name</th>
            </tr>
          </thead>
          <tbody>
            {insertedSongs.length === 0 ? (
              <tr>
                <td colSpan={2} className="empty-cell">暂无歌曲操作记录</td>
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
      </div>
    </section>
  );
}
