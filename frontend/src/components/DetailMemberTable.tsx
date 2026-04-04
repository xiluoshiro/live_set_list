import { useEffect, useMemo, useState } from "react";

import type { LiveDetailBandMember, LiveDetailRow } from "../api";

type OtherPopoverState = {
  rowId: string;
  left: number;
  top: number;
};

type MemberStatusTableProps = {
  rows?: LiveDetailRow[];
  loading?: boolean;
  error?: string | null;
  seed?: number;
};

const BASE_ROWS: Omit<LiveDetailRow, "row_id">[] = [
  {
    song_name: "春日序曲",
    band_members: [
      {
        band_id: 1,
        band_name: "Poppin'Party",
        present_members: ["主唱", "吉他", "贝斯", "鼓手", "键盘"],
        present_count: 5,
        total_count: 5,
        is_full: true,
      },
    ],
    other_members: [],
    comments: [],
  },
  {
    song_name: "夜行线",
    band_members: [
      {
        band_id: 2,
        band_name: "Afterglow",
        present_members: ["主唱", "吉他", "鼓手", "键盘"],
        present_count: 4,
        total_count: 5,
        is_full: false,
      },
      {
        band_id: 3,
        band_name: "Pastel*Palettes",
        present_members: ["主唱", "吉他", "贝斯", "鼓手", "键盘"],
        present_count: 5,
        total_count: 5,
        is_full: true,
      },
      {
        band_id: 4,
        band_name: "Roselia",
        present_members: ["主唱", "吉他", "贝斯", "鼓手", "键盘"],
        present_count: 5,
        total_count: 5,
        is_full: true,
      },
    ],
    other_members: [{ key: "键盘支援", value: ["远程连线"] }],
    comments: ["短版"],
  },
  {
    song_name: "逆光海岸",
    band_members: [
      {
        band_id: 1,
        band_name: "Poppin'Party",
        present_members: ["主唱", "吉他", "贝斯", "鼓手", "键盘"],
        present_count: 5,
        total_count: 5,
        is_full: true,
      },
      {
        band_id: 2,
        band_name: "Afterglow",
        present_members: ["主唱", "吉他", "贝斯", "鼓手", "键盘"],
        present_count: 5,
        total_count: 5,
        is_full: true,
      },
      {
        band_id: 3,
        band_name: "Pastel*Palettes",
        present_members: ["主唱", "吉他", "鼓手", "键盘"],
        present_count: 4,
        total_count: 5,
        is_full: false,
      },
      {
        band_id: 5,
        band_name: "Hello, Happy World!",
        present_members: ["主唱", "吉他", "贝斯", "鼓手", "键盘"],
        present_count: 5,
        total_count: 5,
        is_full: true,
      },
      {
        band_id: 6,
        band_name: "RAISE A SUILEN",
        present_members: ["主唱", "吉他", "贝斯", "鼓手", "DJ"],
        present_count: 5,
        total_count: 5,
        is_full: true,
      },
    ],
    other_members: [
      { key: "和声", value: ["双声部"] },
      { key: "采样", value: ["预置触发"] },
      { key: "打击乐", value: ["额外一轨"] },
    ],
    comments: ["翻唱"],
  },
  {
    song_name: "零界点",
    band_members: [
      {
        band_id: 1,
        band_name: "Poppin'Party",
        present_members: ["主唱", "吉他", "贝斯", "鼓手", "键盘"],
        present_count: 5,
        total_count: 5,
        is_full: true,
      },
      {
        band_id: 2,
        band_name: "Afterglow",
        present_members: ["主唱", "吉他", "贝斯", "鼓手", "键盘"],
        present_count: 5,
        total_count: 5,
        is_full: true,
      },
      {
        band_id: 3,
        band_name: "Pastel*Palettes",
        present_members: ["主唱", "吉他", "贝斯", "鼓手", "键盘"],
        present_count: 5,
        total_count: 5,
        is_full: true,
      },
      {
        band_id: 4,
        band_name: "Roselia",
        present_members: ["主唱", "吉他", "贝斯", "鼓手"],
        present_count: 4,
        total_count: 5,
        is_full: false,
      },
      {
        band_id: 5,
        band_name: "Hello, Happy World!",
        present_members: ["主唱", "吉他", "贝斯", "鼓手", "键盘"],
        present_count: 5,
        total_count: 5,
        is_full: true,
      },
      {
        band_id: 6,
        band_name: "RAISE A SUILEN",
        present_members: ["主唱", "吉他", "贝斯", "鼓手", "DJ"],
        present_count: 5,
        total_count: 5,
        is_full: true,
      },
      {
        band_id: 7,
        band_name: "Morfonica",
        present_members: ["主唱", "吉他", "贝斯", "鼓手", "键盘"],
        present_count: 5,
        total_count: 5,
        is_full: true,
      },
      {
        band_id: 8,
        band_name: "MyGO!!!!!",
        present_members: ["主唱", "吉他", "贝斯", "鼓手", "键盘"],
        present_count: 5,
        total_count: 5,
        is_full: true,
      },
      {
        band_id: 9,
        band_name: "Ave Mujica",
        present_members: ["主唱", "吉他", "键盘"],
        present_count: 3,
        total_count: 5,
        is_full: false,
      },
      {
        band_id: 10,
        band_name: "梦限大MIX",
        present_members: ["主唱", "吉他", "贝斯", "鼓手", "键盘"],
        present_count: 5,
        total_count: 5,
        is_full: true,
      },
    ],
    other_members: Array.from({ length: 24 }, (_, idx) => ({
      key: `扩展键${idx + 1}`,
      value: [`值${idx + 1}`],
    })),
    comments: ["短版", "翻唱"],
  },
];

function getOrderedBandMembers(members: LiveDetailBandMember[]): LiveDetailBandMember[] {
  return [...members].sort((a, b) => {
    const aPartial = !a.is_full;
    const bPartial = !b.is_full;
    if (aPartial !== bPartial) return aPartial ? 1 : -1;
    const aBandId = a.band_id ?? Number.MAX_SAFE_INTEGER;
    const bBandId = b.band_id ?? Number.MAX_SAFE_INTEGER;
    if (aBandId !== bBandId) return aBandId - bBandId;
    return a.band_name.localeCompare(b.band_name, "zh-CN");
  });
}

// Build 20 mock rows by cycling base templates, so layout edge-cases stay visible.
function buildMockRows(seed: number): LiveDetailRow[] {
  return Array.from({ length: 20 }, (_, idx) => {
    const base = BASE_ROWS[(idx + seed) % BASE_ROWS.length];
    return {
      row_id: `M${idx + 1}`,
      song_name: `${base.song_name} ${idx + 1}`,
      band_members: base.band_members,
      other_members: base.other_members,
      comments: base.comments,
    };
  });
}

function estimateOtherPopoverHeight(itemCount: number): number {
  const titleHeight = 26;
  const rowHeight = 26;
  const padding = 18;
  return Math.min(220, Math.max(92, titleHeight + itemCount * rowHeight + padding));
}

function calcOtherPopoverPosition(rect: DOMRect, itemCount: number): { left: number; top: number } {
  const width = 320;
  const height = estimateOtherPopoverHeight(itemCount);
  const viewportPadding = 12;
  const offset = 6;
  const clampedLeft = Math.min(
    Math.max(viewportPadding, rect.left),
    window.innerWidth - width - viewportPadding,
  );
  const spaceBelow = window.innerHeight - rect.bottom - viewportPadding;
  const spaceAbove = rect.top - viewportPadding;
  const openUp = spaceBelow < height + offset && spaceAbove > spaceBelow;
  const preferredTop = openUp ? rect.top - offset - height : rect.bottom + offset;
  const clampedTop = Math.min(
    Math.max(viewportPadding, preferredTop),
    window.innerHeight - height - viewportPadding,
  );
  return { left: clampedLeft, top: clampedTop };
}

function normalizeRows(rows: LiveDetailRow[]): LiveDetailRow[] {
  return rows.map((row) => ({
    row_id: String(row.row_id),
    song_name: String(row.song_name),
    band_members: (row.band_members ?? []).map((member) => ({
      band_id: typeof member.band_id === "number" ? member.band_id : null,
      band_name: String(member.band_name),
      present_members: Array.isArray(member.present_members)
        ? member.present_members.map((name) => String(name))
        : [],
      present_count: Number(member.present_count ?? 0),
      total_count: Number(member.total_count ?? 0),
      is_full: Boolean(member.is_full),
    })),
    other_members: (row.other_members ?? []).map((other) => ({
      key: String(other.key),
      value: Array.isArray(other.value)
        ? other.value.map((item) => String(item))
        : [String(other.value ?? "")].filter((v) => v !== ""),
    })),
    comments: Array.isArray(row.comments) ? row.comments.map((item) => String(item)) : [],
  }));
}

export function MemberStatusTable({ rows, loading = false, error = null, seed = 1 }: MemberStatusTableProps) {
  const sourceRows = useMemo(() => normalizeRows(rows ?? buildMockRows(seed)), [rows, seed]);
  const [bandDetailRow, setBandDetailRow] = useState<LiveDetailRow | null>(null);
  const [otherPopover, setOtherPopover] = useState<OtherPopoverState | null>(null);

  const activeOtherRow = useMemo(() => {
    if (!otherPopover) return null;
    return sourceRows.find((row) => row.row_id === otherPopover.rowId) ?? null;
  }, [otherPopover, sourceRows]);

  useEffect(() => {
    if (!otherPopover) return;
    const handleOutsideDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (
        target.closest(".other-floating-popover") ||
        target.closest(".other-more-btn") ||
        target.closest(".other-tag-btn")
      ) {
        return;
      }
      setOtherPopover(null);
    };
    const handleResize = () => setOtherPopover(null);
    window.addEventListener("mousedown", handleOutsideDown);
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("mousedown", handleOutsideDown);
      window.removeEventListener("resize", handleResize);
    };
  }, [otherPopover]);

  useEffect(() => {
    if (bandDetailRow && !sourceRows.some((row) => row.row_id === bandDetailRow.row_id)) {
      setBandDetailRow(null);
    }
    if (otherPopover && !sourceRows.some((row) => row.row_id === otherPopover.rowId)) {
      setOtherPopover(null);
    }
  }, [bandDetailRow, otherPopover, sourceRows]);

  return (
    <>
      <div className="console-table-wrap detail-member-table-wrap">
        <table className="console-table">
          <thead>
            <tr>
              <th>编号</th>
              <th>曲目名称</th>
              <th>乐队成员</th>
              <th>其他成员</th>
              <th>备注</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={5} className="empty-cell">
                  详情加载中...
                </td>
              </tr>
            )}
            {!loading && error && (
              <tr>
                <td colSpan={5} className="empty-cell">
                  详情加载失败: {error}
                </td>
              </tr>
            )}
            {!loading && !error && sourceRows.length === 0 && (
              <tr>
                <td colSpan={5} className="empty-cell">
                  当前 Live 暂无详情数据
                </td>
              </tr>
            )}
            {!loading && !error &&
              sourceRows.map((row) => {
                const orderedMembers = getOrderedBandMembers(row.band_members);
                const bandCount = orderedMembers.length;
                const previewOthers = row.other_members.slice(0, 2);
                const extraCount = Math.max(0, row.other_members.length - previewOthers.length);
                const validComments = row.comments.filter((c) => c.trim() !== "");
                return (
                  <tr key={row.row_id}>
                    <td>{row.row_id}</td>
                    <td title={row.song_name}>{row.song_name}</td>
                    <td>
                      <button
                        type="button"
                        className="console-band-btn"
                        onClick={() => setBandDetailRow(row)}
                        title="点击查看参加队员"
                      >
                        <span className={`console-band-grid ${bandCount > 5 ? "grid-two" : "grid-one"}`}>
                          {orderedMembers.map((member, idx) => (
                            <span
                              key={`${row.row_id}-${member.band_name}-${idx}`}
                              className={`band-tile ${member.is_full ? "full" : "partial"}`}
                              title={`${member.band_name} 已参加 ${member.present_count} 人`}
                            >
                              {typeof member.band_id === "number" && member.band_id > 0 ? (
                                <img
                                  src={`/icons/Band_${member.band_id}.svg`}
                                  alt={member.band_name}
                                  className="band-tile-icon"
                                />
                              ) : (
                                <span className="band-tile-fallback">?</span>
                              )}
                            </span>
                          ))}
                        </span>
                      </button>
                    </td>
                    <td>
                      {row.other_members.length === 0 ? (
                        <span className="other-empty">—</span>
                      ) : (
                        <div className="other-cell">
                          {previewOthers.map((item) => {
                            const valueText = item.value.join(" / ").trim();
                            const labelText = valueText ? `${item.key}:${valueText}` : item.key;
                            return (
                              <button
                                type="button"
                                key={`${row.row_id}-${item.key}`}
                                className="other-tag other-tag-btn"
                                title={labelText}
                                onClick={(event) => {
                                  const rect = event.currentTarget.getBoundingClientRect();
                                  const nextPos = calcOtherPopoverPosition(rect, row.other_members.length);
                                  setOtherPopover((prev) =>
                                    prev?.rowId === row.row_id
                                      ? null
                                      : { rowId: row.row_id, left: nextPos.left, top: nextPos.top },
                                  );
                                }}
                              >
                                {labelText}
                              </button>
                            );
                          })}
                          {extraCount > 0 && (
                            <button
                              type="button"
                              className="other-more-btn"
                              onClick={(event) => {
                                const rect = event.currentTarget.getBoundingClientRect();
                                const nextPos = calcOtherPopoverPosition(rect, row.other_members.length);
                                setOtherPopover((prev) =>
                                  prev?.rowId === row.row_id
                                    ? null
                                    : { rowId: row.row_id, left: nextPos.left, top: nextPos.top },
                                );
                              }}
                            >
                              +{extraCount}
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                    <td title={validComments.join("/")}>
                      {validComments.length > 0 ? (
                        <div className="comment-tags">
                          {validComments.map((comment) => (
                            <span key={`${row.row_id}-${comment}`} className="comment-tag">
                              {comment}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {otherPopover && activeOtherRow && (
        <div
          className="other-floating-popover"
          style={{ left: `${otherPopover.left}px`, top: `${otherPopover.top}px` }}
        >
          <div className="other-popover-title">其他成员明细</div>
          <ul>
            {activeOtherRow.other_members.map((item, idx) => (
              <li key={`${activeOtherRow.row_id}-${item.key}-${idx}`}>
                <span>{item.key}</span>
                <span>{item.value.join(" / ")}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {bandDetailRow && (
        <div className="modal-mask" onClick={() => setBandDetailRow(null)}>
          <div className="console-band-modal" onClick={(e) => e.stopPropagation()}>
            <div className="console-band-modal-head">
              <h4>{bandDetailRow.song_name} · 乐队成员详情</h4>
              <button
                type="button"
                className="modal-action-btn close"
                onClick={() => setBandDetailRow(null)}
                aria-label="关闭乐队详情"
              >
                <span className="modal-action-glyph close">✕</span>
              </button>
            </div>

            <div className="console-band-member-list">
              {getOrderedBandMembers(bandDetailRow.band_members).map((member, idx) => (
                <div key={`${bandDetailRow.row_id}-${member.band_name}-${idx}`} className="console-band-card">
                  <div className="console-band-card-head">
                    <span className={`band-tile ${member.is_full ? "full" : "partial"}`}>
                      {typeof member.band_id === "number" && member.band_id > 0 ? (
                        <img
                          src={`/icons/Band_${member.band_id}.svg`}
                          alt={member.band_name}
                          className="band-tile-icon"
                        />
                      ) : (
                        <span className="band-tile-fallback">?</span>
                      )}
                    </span>
                    <strong>{member.band_name}</strong>
                  </div>
                  <p className="console-band-members">参加队员：{member.present_members.join(" / ")}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

