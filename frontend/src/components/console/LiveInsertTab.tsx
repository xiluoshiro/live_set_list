import type { MutableRefObject, ReactNode, RefObject } from "react";

import { SEGMENT_OPTIONS } from "./constants";
import { getBandMembersTemplate, summarizeBandMember, summarizeOtherMember } from "./helpers";
import type { ParsedSetlistWarning } from "./setlistParser/types";
import type { BandOption, DerivedSegment, LiveInsertBundle, LiveInsertRow, Position, SetlistDraftRow } from "./types";

type LiveInsertTabProps = {
  lives: LiveInsertRow[];
  selectedLiveId: number;
  livePage: number;
  liveTotal: number;
  liveTotalPages: number;
  isLiveLoading: boolean;
  didSongLookup: boolean;
  setlistRows: SetlistDraftRow[];
  derivedSegments: DerivedSegment[];
  submittedBundles: LiveInsertBundle[];
  displayedBundle: LiveInsertBundle | null;
  mockBands: BandOption[];
  editingBandRow: SetlistDraftRow | null;
  editingOtherRow: SetlistDraftRow | null;
  bandMemberMenuPos: Position | null;
  otherMemberMenuPos: Position | null;
  songModalRowKey: number | null;
  bandMemberTriggerRefs: MutableRefObject<Record<number, HTMLButtonElement | null>>;
  bandMemberMenuRef: RefObject<HTMLDivElement>;
  otherMemberTriggerRefs: MutableRefObject<Record<number, HTMLButtonElement | null>>;
  otherMemberMenuRef: RefObject<HTMLDivElement>;
  setlistPasteText: string;
  setlistParseWarnings: ParsedSetlistWarning[];
  setlistParsePreviewRows: SetlistDraftRow[];
  setlistParsePreviewOpen: boolean;
  onSelectedLiveIdChange: (liveId: number) => void;
  onLivePageChange: (page: number) => void;
  onSetlistPasteTextChange: (value: string) => void;
  onPreviewSetlistPaste: () => void;
  onApplySetlistPaste: () => void;
  onClearSetlistPaste: () => void;
  onOpenFullSetlistPreview: () => void;
  onCloseFullSetlistPreview: () => void;
  onUpdateSetlistSongName: (rowKey: number, value: string) => void;
  onSetSongModalRowKey: (rowKey: number | null) => void;
  onUpdateSetlistSegment: (rowKey: number, value: string) => void;
  onToggleSetlistShort: (rowKey: number, checked: boolean) => void;
  onOpenBandMemberMenu: (rowKey: number) => void;
  onOpenOtherMemberMenu: (rowKey: number) => void;
  onShowCurrentSetlist: () => void;
  onAddSetlistRow: () => void;
  onRemoveLastSetlistRow: () => void;
  onQuerySongsForSetlist: () => void;
  onSubmitLiveWithSetlist: () => void;
  submitDisabled: boolean;
  onToggleBandForSetlistRow: (rowKey: number, bandName: string) => void;
  onToggleBandMemberForSetlistRow: (rowKey: number, bandName: string, memberName: string) => void;
  onUpdateOtherMemberEntry: (
    rowKey: number,
    entryId: number,
    key: "member_key" | "member_value",
    value: string,
  ) => void;
  onRemoveOtherMemberEntry: (rowKey: number, entryId: number) => void;
  onAddOtherMemberEntry: (rowKey: number) => void;
  renderSongAdminSection: () => ReactNode;
};

export function LiveInsertTab({
  lives,
  selectedLiveId,
  livePage,
  liveTotal,
  liveTotalPages,
  isLiveLoading,
  didSongLookup,
  setlistRows,
  derivedSegments,
  submittedBundles,
  displayedBundle,
  mockBands,
  editingBandRow,
  editingOtherRow,
  bandMemberMenuPos,
  otherMemberMenuPos,
  songModalRowKey,
  bandMemberTriggerRefs,
  bandMemberMenuRef,
  otherMemberTriggerRefs,
  otherMemberMenuRef,
  setlistPasteText,
  setlistParseWarnings,
  setlistParsePreviewRows,
  setlistParsePreviewOpen,
  onSelectedLiveIdChange,
  onLivePageChange,
  onSetlistPasteTextChange,
  onPreviewSetlistPaste,
  onApplySetlistPaste,
  onClearSetlistPaste,
  onOpenFullSetlistPreview,
  onCloseFullSetlistPreview,
  onUpdateSetlistSongName,
  onSetSongModalRowKey,
  onUpdateSetlistSegment,
  onToggleSetlistShort,
  onOpenBandMemberMenu,
  onOpenOtherMemberMenu,
  onShowCurrentSetlist,
  onAddSetlistRow,
  onRemoveLastSetlistRow,
  onQuerySongsForSetlist,
  onSubmitLiveWithSetlist,
  submitDisabled,
  onToggleBandForSetlistRow,
  onToggleBandMemberForSetlistRow,
  onUpdateOtherMemberEntry,
  onRemoveOtherMemberEntry,
  onAddOtherMemberEntry,
  renderSongAdminSection,
}: LiveInsertTabProps) {
  const normalizedLiveTotalPages = Math.max(liveTotalPages, 1);
  const isPreviousLivePageDisabled = isLiveLoading || livePage <= 1;
  const isNextLivePageDisabled = isLiveLoading || livePage >= normalizedLiveTotalPages;

  return (
    <>
      <div className="live-id-selector">
        <label htmlFor="live-id-select">选择 live_id</label>
        <select
          id="live-id-select"
          value={selectedLiveId}
          disabled={isLiveLoading || lives.length === 0}
          onChange={(e) => onSelectedLiveIdChange(Number(e.target.value))}
        >
          {isLiveLoading ? (
            <option value={0}>加载 live 候选中...</option>
          ) : lives.length === 0 ? (
            <option value={0}>暂无 live 候选</option>
          ) : (
            lives.map((live) => (
              <option key={live.live_id} value={live.live_id}>
                {live.live_id} - {live.live_title} ({live.live_date})
              </option>
            ))
          )}
        </select>
        <span className="live-page-status">
          第 {livePage} / {normalizedLiveTotalPages} 页，共 {liveTotal} 条
        </span>
        <button
          type="button"
          className="console-ghost-btn"
          onClick={() => onLivePageChange(Math.max(1, livePage - 1))}
          disabled={isPreviousLivePageDisabled}
        >
          上一页
        </button>
        <button
          type="button"
          className="console-ghost-btn"
          onClick={() => onLivePageChange(livePage + 1)}
          disabled={isNextLivePageDisabled}
        >
          下一页
        </button>
        <button type="button" className="console-ghost-btn" onClick={onShowCurrentSetlist}>
          显示详细信息
        </button>
      </div>

      <section className="setlist-paste-panel" aria-label="批量粘贴 Setlist">
        <div className="setlist-paste-head">
          <div>
            <h4>批量粘贴 Setlist</h4>
            <p>粘贴官网文本后先解析预览，确认无误再应用到下方表格。</p>
          </div>
          <div className="setlist-paste-actions">
            <button type="button" className="console-ghost-btn" onClick={onPreviewSetlistPaste}>
              解析预览
            </button>
            <button
              type="button"
              className="console-submit-btn"
              onClick={onApplySetlistPaste}
              disabled={setlistPasteText.trim() === ""}
            >
              应用到表格
            </button>
            <button type="button" className="console-ghost-btn" onClick={onClearSetlistPaste}>
              清空
            </button>
          </div>
        </div>
        <textarea
          className="setlist-paste-textarea"
          aria-label="批量粘贴 Setlist 文本"
          value={setlistPasteText}
          onChange={(event) => onSetlistPasteTextChange(event.target.value)}
          placeholder="例如：&#10;＜Roselia×愛美 from Poppin'Party＞&#10;M1. BLACK SHOUT&#10;EN1. BRAVE JEWEL"
        />
        {(setlistParsePreviewRows.length > 0 || setlistParseWarnings.length > 0) && (
          <div className="setlist-paste-preview">
            <p className="setlist-paste-summary">
              预览：{setlistParsePreviewRows.length} 行，提示 {setlistParseWarnings.length} 条
            </p>
            {setlistParseWarnings.length > 0 && (
              <ul className="setlist-paste-warnings">
                {setlistParseWarnings.slice(0, 6).map((warning, index) => (
                  <li key={`${warning.line}-${index}`}>
                    第 {warning.line} 行：{warning.message}
                  </li>
                ))}
              </ul>
            )}
            {setlistParsePreviewRows.length > 0 && (
              <div className="setlist-paste-preview-list">
                {setlistParsePreviewRows.slice(0, 3).map((row, index) => (
                  <span key={row.row_key}>
                    {index + 1}. {row.segment_start_type || "-"} {row.song_name} / {summarizeBandMember(row)}
                  </span>
                ))}
                {setlistParsePreviewRows.length > 3 && (
                  <button type="button" className="setlist-preview-more-btn" onClick={onOpenFullSetlistPreview}>
                    ... 还有 {setlistParsePreviewRows.length - 3} 行，查看全部
                  </button>
                )}
                {setlistParsePreviewRows.length <= 3 && (
                  <button type="button" className="setlist-preview-more-btn" onClick={onOpenFullSetlistPreview}>
                    显示详情
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      <div className="console-table-wrap setlist-input-wrap">
        <table className="console-admin-table setlist-table">
          <thead>
            <tr>
              <th>song_name</th>
              <th>sid</th>
              <th>abs</th>
              <th>seg</th>
              <th>sub</th>
              <th>short</th>
              <th>band_member</th>
              <th>other_member</th>
            </tr>
          </thead>
          <tbody>
            {setlistRows.map((row, index) => (
              <tr key={row.row_key}>
                <td>
                  <input
                    value={row.song_name}
                    onChange={(e) => onUpdateSetlistSongName(row.row_key, e.target.value)}
                    placeholder="请输入歌曲名"
                  />
                </td>
                <td>
                  {row.song_id !== "" ? (
                    <span className="readonly-cell">{row.song_id}</span>
                  ) : didSongLookup && row.song_name.trim() !== "" ? (
                    <button
                      type="button"
                      className="song-missing-btn"
                      onClick={() => onSetSongModalRowKey(row.row_key)}
                    >
                      未匹配
                    </button>
                  ) : (
                    <span className="readonly-cell">-</span>
                  )}
                </td>
                <td>
                  <span className="readonly-cell">{index + 1}</span>
                </td>
                <td>
                  <select
                    aria-label={`seg-${row.row_key}`}
                    value={row.segment_start_type}
                    onChange={(e) => onUpdateSetlistSegment(row.row_key, e.target.value)}
                  >
                    <option value="">-</option>
                    {SEGMENT_OPTIONS.map((segmentOption) => (
                      <option key={segmentOption} value={segmentOption}>
                        {segmentOption}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <span className="readonly-cell">{derivedSegments[index]?.subOrder ?? 1}</span>
                </td>
                <td>
                  <input
                    className="is-short-check"
                    aria-label={`is_short-${row.row_key}`}
                    type="checkbox"
                    checked={row.is_short}
                    onChange={(e) => onToggleSetlistShort(row.row_key, e.target.checked)}
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="band-member-trigger"
                    ref={(element) => {
                      bandMemberTriggerRefs.current[row.row_key] = element;
                    }}
                    onClick={() => onOpenBandMemberMenu(row.row_key)}
                  >
                    {summarizeBandMember(row)}
                  </button>
                </td>
                <td>
                  <button
                    type="button"
                    className="other-member-trigger"
                    ref={(element) => {
                      otherMemberTriggerRefs.current[row.row_key] = element;
                    }}
                    onClick={() => onOpenOtherMemberMenu(row.row_key)}
                  >
                    {summarizeOtherMember(row)}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="setlist-actions-row">
        <button type="button" className="console-ghost-btn" onClick={onAddSetlistRow}>新增一行</button>
        <button type="button" className="console-ghost-btn" onClick={onRemoveLastSetlistRow}>删除末行</button>
      </div>

      <div className="console-submit-row">
        <button type="button" onClick={onQuerySongsForSetlist} className="console-ghost-btn">
          查询歌曲
        </button>
        <button type="button" onClick={onSubmitLiveWithSetlist} className="console-submit-btn" disabled={submitDisabled}>
          提交插入
        </button>
      </div>

      <div className="console-table-wrap live-history-wrap">
        <table className="console-admin-table live-history-table">
          <thead>
            <tr>
              <th>live_id</th>
              <th>live_date</th>
              <th>live_title</th>
              <th>bands</th>
              <th>url</th>
              <th>setlist_rows</th>
            </tr>
          </thead>
          <tbody>
            {submittedBundles.length === 0 ? (
              <tr>
                <td colSpan={6} className="empty-cell">暂无插入记录</td>
              </tr>
            ) : (
              submittedBundles.map((bundle) => (
                <tr key={bundle.live.live_id}>
                  <td>{bundle.live.live_id}</td>
                  <td>{bundle.live.live_date}</td>
                  <td>{bundle.live.live_title}</td>
                  <td>{bundle.live.bands.join(",")}</td>
                  <td>{bundle.live.url ?? "-"}</td>
                  <td>{bundle.setlist_rows.length}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {displayedBundle && (
        <div className="console-table-wrap setlist-preview-wrap">
          <table className="console-admin-table setlist-table">
            <thead>
              <tr>
                <th>song_id</th>
                <th>absolute_order</th>
                <th>segment_type</th>
                <th>sub_order</th>
                <th>is_short</th>
                <th>band_member</th>
                <th>other_member</th>
              </tr>
            </thead>
            <tbody>
              {displayedBundle.setlist_rows.map((row) => (
                <tr key={`${displayedBundle.live.live_id}-${row.absolute_order}`}>
                  <td>{row.song_id}</td>
                  <td>{row.absolute_order}</td>
                  <td>{row.segment_type}</td>
                  <td>{row.sub_order}</td>
                  <td>{row.is_short ? "true" : "false"}</td>
                  <td>{row.band_member}</td>
                  <td>{row.other_member}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editingBandRow && bandMemberMenuPos && (
        <div
          className="band-member-floating-menu"
          ref={bandMemberMenuRef}
          onMouseDown={(event) => event.stopPropagation()}
          onWheel={(event) => event.stopPropagation()}
          style={{ top: bandMemberMenuPos.top, left: bandMemberMenuPos.left, width: bandMemberMenuPos.width }}
        >
          {mockBands.map((band) => {
            const selected = editingBandRow.band_member[band.band_name] ?? [];
            const bandChecked = selected.length > 0;
            const memberOptions =
              band.band_members && band.band_members.length > 0
                ? band.band_members
                : getBandMembersTemplate(band.band_name);
            return (
              <div key={band.band_id} className="band-member-block">
                <label className="band-member-main">
                  <input
                    type="checkbox"
                    checked={bandChecked}
                    onChange={() => onToggleBandForSetlistRow(editingBandRow.row_key, band.band_name)}
                  />
                  <span>{band.band_name}</span>
                </label>
                {bandChecked && (
                  <div className="band-member-sub-list">
                    {memberOptions.map((memberOption) => (
                      <label key={memberOption}>
                        <input
                          type="checkbox"
                          checked={selected.includes(memberOption)}
                          onChange={() =>
                            onToggleBandMemberForSetlistRow(editingBandRow.row_key, band.band_name, memberOption)
                          }
                        />
                        <span>{memberOption}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {editingOtherRow && otherMemberMenuPos && (
        <div
          className="other-member-floating-menu"
          ref={otherMemberMenuRef}
          onMouseDown={(event) => event.stopPropagation()}
          onWheel={(event) => event.stopPropagation()}
          style={{ top: otherMemberMenuPos.top, left: otherMemberMenuPos.left, width: otherMemberMenuPos.width }}
        >
          <div className="other-member-editor">
            {editingOtherRow.other_member.map((entry) => (
              <div key={entry.entry_id} className="other-member-row">
                <input
                  value={entry.member_key}
                  onChange={(e) =>
                    onUpdateOtherMemberEntry(editingOtherRow.row_key, entry.entry_id, "member_key", e.target.value)
                  }
                  placeholder="key"
                />
                <input
                  value={entry.member_value}
                  onChange={(e) =>
                    onUpdateOtherMemberEntry(editingOtherRow.row_key, entry.entry_id, "member_value", e.target.value)
                  }
                  placeholder="value"
                />
                <button
                  type="button"
                  className="mini-ghost-btn"
                  onClick={() => onRemoveOtherMemberEntry(editingOtherRow.row_key, entry.entry_id)}
                >
                  -
                </button>
              </div>
            ))}
            <button
              type="button"
              className="mini-ghost-btn add"
              onClick={() => onAddOtherMemberEntry(editingOtherRow.row_key)}
            >
              +
            </button>
          </div>
        </div>
      )}

      {songModalRowKey !== null && (
        <div className="song-modal-backdrop" role="presentation" onClick={() => onSetSongModalRowKey(null)}>
          <div className="song-modal" role="dialog" aria-label="歌曲查询结果" onClick={(e) => e.stopPropagation()}>
            <div className="song-modal-header">
              <strong>未匹配歌曲，请先新增或确认歌名</strong>
              <button
                type="button"
                className="modal-action-btn close"
                aria-label="关闭"
                onClick={() => onSetSongModalRowKey(null)}
              >
                <span className="modal-action-glyph close">✕</span>
              </button>
            </div>
            {renderSongAdminSection()}
          </div>
        </div>
      )}

      {setlistParsePreviewOpen && (
        <div className="song-modal-backdrop" role="presentation" onClick={onCloseFullSetlistPreview}>
          <div
            className="song-modal setlist-full-preview-modal"
            role="dialog"
            aria-label="完整 Setlist 解析预览"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="song-modal-header">
              <strong>完整 Setlist 解析预览</strong>
              <button
                type="button"
                className="modal-action-btn close"
                aria-label="关闭完整预览"
                onClick={onCloseFullSetlistPreview}
              >
                <span className="modal-action-glyph close">✕</span>
              </button>
            </div>
            <div className="console-table-wrap setlist-full-preview-table-wrap">
              <table className="console-admin-table setlist-full-preview-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>seg</th>
                    <th>song_name</th>
                    <th>band_member</th>
                    <th>other_member</th>
                  </tr>
                </thead>
                <tbody>
                  {setlistParsePreviewRows.map((row, index) => (
                    <tr key={row.row_key}>
                      <td>{index + 1}</td>
                      <td>{row.segment_start_type || "-"}</td>
                      <td>{row.song_name}</td>
                      <td><code>{JSON.stringify(row.band_member)}</code></td>
                      <td>{summarizeOtherMember(row)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
