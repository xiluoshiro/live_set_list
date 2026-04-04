import { useEffect, useMemo, useState } from "react";

type MemberKV = { key: string; value: string };
type ConsoleBandMember = {
  bandId: number;
  bandName: string;
  current: number;
  total: number;
  presentMembers: string[];
};
type ConsoleRow = {
  id: number;
  songName: string;
  bandMembers: ConsoleBandMember[];
  otherMembers: MemberKV[];
  comments: string[];
};
type OtherPopoverState = {
  rowId: number;
  left: number;
  top: number;
};

const BASE_ROWS: Omit<ConsoleRow, "id">[] = [
  {
    songName: "春日序曲",
    bandMembers: [
      {
        bandId: 1,
        bandName: "Poppin'Party",
        current: 5,
        total: 5,
        presentMembers: ["主唱", "吉他", "贝斯", "鼓手", "键盘"],
      },
    ],
    otherMembers: [],
    comments: [],
  },
  {
    songName: "夜行线",
    bandMembers: [
      {
        bandId: 2,
        bandName: "Afterglow",
        current: 4,
        total: 5,
        presentMembers: ["主唱", "吉他", "鼓手", "键盘"],
      },
      {
        bandId: 3,
        bandName: "Pastel*Palettes",
        current: 5,
        total: 5,
        presentMembers: ["主唱", "吉他", "贝斯", "鼓手", "键盘"],
      },
      {
        bandId: 4,
        bandName: "Roselia",
        current: 5,
        total: 5,
        presentMembers: ["主唱", "吉他", "贝斯", "鼓手", "键盘"],
      },
    ],
    otherMembers: [{ key: "键盘支援", value: "远程连线" }],
    comments: ["短版"],
  },
  {
    songName: "逆光海岸",
    bandMembers: [
      {
        bandId: 1,
        bandName: "Poppin'Party",
        current: 5,
        total: 5,
        presentMembers: ["主唱", "吉他", "贝斯", "鼓手", "键盘"],
      },
      {
        bandId: 2,
        bandName: "Afterglow",
        current: 5,
        total: 5,
        presentMembers: ["主唱", "吉他", "贝斯", "鼓手", "键盘"],
      },
      {
        bandId: 3,
        bandName: "Pastel*Palettes",
        current: 4,
        total: 5,
        presentMembers: ["主唱", "吉他", "鼓手", "键盘"],
      },
      {
        bandId: 5,
        bandName: "Hello, Happy World!",
        current: 5,
        total: 5,
        presentMembers: ["主唱", "吉他", "贝斯", "鼓手", "键盘"],
      },
      {
        bandId: 6,
        bandName: "RAISE A SUILEN",
        current: 5,
        total: 5,
        presentMembers: ["主唱", "吉他", "贝斯", "鼓手", "DJ"],
      },
    ],
    otherMembers: [
      { key: "和声", value: "双声部" },
      { key: "采样", value: "预置触发" },
      { key: "打击乐", value: "额外一轨" },
    ],
    comments: ["翻唱"],
  },
  {
    songName: "零界点",
    bandMembers: [
      {
        bandId: 1,
        bandName: "Poppin'Party",
        current: 5,
        total: 5,
        presentMembers: ["主唱", "吉他", "贝斯", "鼓手", "键盘"],
      },
      {
        bandId: 2,
        bandName: "Afterglow",
        current: 5,
        total: 5,
        presentMembers: ["主唱", "吉他", "贝斯", "鼓手", "键盘"],
      },
      {
        bandId: 3,
        bandName: "Pastel*Palettes",
        current: 5,
        total: 5,
        presentMembers: ["主唱", "吉他", "贝斯", "鼓手", "键盘"],
      },
      {
        bandId: 4,
        bandName: "Roselia",
        current: 4,
        total: 5,
        presentMembers: ["主唱", "吉他", "贝斯", "鼓手"],
      },
      {
        bandId: 5,
        bandName: "Hello, Happy World!",
        current: 5,
        total: 5,
        presentMembers: ["主唱", "吉他", "贝斯", "鼓手", "键盘"],
      },
      {
        bandId: 6,
        bandName: "RAISE A SUILEN",
        current: 5,
        total: 5,
        presentMembers: ["主唱", "吉他", "贝斯", "鼓手", "DJ"],
      },
      {
        bandId: 7,
        bandName: "Morfonica",
        current: 5,
        total: 5,
        presentMembers: ["主唱", "吉他", "贝斯", "鼓手", "键盘"],
      },
      {
        bandId: 8,
        bandName: "MyGO!!!!!",
        current: 5,
        total: 5,
        presentMembers: ["主唱", "吉他", "贝斯", "鼓手", "键盘"],
      },
      {
        bandId: 9,
        bandName: "Ave Mujica",
        current: 3,
        total: 5,
        presentMembers: ["主唱", "吉他", "键盘"],
      },
      {
        bandId: 10,
        bandName: "梦限大MIX",
        current: 5,
        total: 5,
        presentMembers: ["主唱", "吉他", "贝斯", "鼓手", "键盘"],
      },
    ],
    otherMembers: Array.from({ length: 24 }, (_, idx) => ({
      key: `扩展键${idx + 1}`,
      value: `值${idx + 1}`,
    })),
    comments: ["短版", "翻唱"],
  },
];

function getOrderedBandMembers(members: ConsoleBandMember[]): ConsoleBandMember[] {
  return [...members].sort((a, b) => {
    const aPartial = a.current < a.total;
    const bPartial = b.current < b.total;
    if (aPartial === bPartial) return a.bandId - b.bandId;
    return aPartial ? 1 : -1;
  });
}

// Build 20 mock rows by cycling base templates, so layout edge-cases stay visible.
function buildMockRows(seed: number): ConsoleRow[] {
  return Array.from({ length: 20 }, (_, idx) => {
    const base = BASE_ROWS[(idx + seed) % BASE_ROWS.length];
    return {
      id: idx + 1,
      songName: `${base.songName} ${idx + 1}`,
      bandMembers: base.bandMembers,
      otherMembers: base.otherMembers,
      comments: base.comments,
    };
  });
}

export function MemberStatusTable({ seed }: { seed: number }) {
  const rows = useMemo(() => buildMockRows(seed), [seed]);
  const [bandDetailRow, setBandDetailRow] = useState<ConsoleRow | null>(null);
  const [otherPopover, setOtherPopover] = useState<OtherPopoverState | null>(null);

  const activeOtherRow = useMemo(() => {
    if (!otherPopover) return null;
    return rows.find((row) => row.id === otherPopover.rowId) ?? null;
  }, [otherPopover, rows]);

  useEffect(() => {
    if (!otherPopover) return;
    const handleOutsideDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest(".other-floating-popover") || target.closest(".other-more-btn")) return;
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
            {rows.map((row) => {
              const orderedMembers = getOrderedBandMembers(row.bandMembers);
              const bandCount = orderedMembers.length;
              const previewOthers = row.otherMembers.slice(0, 2);
              const extraCount = Math.max(0, row.otherMembers.length - previewOthers.length);
              const validComments = row.comments.filter((c) => c.trim() !== "");
              return (
                <tr key={row.id}>
                  <td>{row.id}</td>
                  <td title={row.songName}>{row.songName}</td>
                  <td>
                    <button
                      type="button"
                      className="console-band-btn"
                      onClick={() => setBandDetailRow(row)}
                      title="点击查看参加队员"
                    >
                      <span className={`console-band-grid ${bandCount > 5 ? "grid-two" : "grid-one"}`}>
                        {orderedMembers.map((member) => {
                          const isFull = member.current >= member.total;
                          return (
                            <span
                              key={`${row.id}-${member.bandId}`}
                              className={`band-tile ${isFull ? "full" : "partial"}`}
                              title={`${member.bandName} 已参加 ${member.current} 人`}
                            >
                              <img
                                src={`/icons/Band_${member.bandId}.svg`}
                                alt={member.bandName}
                                className="band-tile-icon"
                              />
                            </span>
                          );
                        })}
                      </span>
                    </button>
                  </td>
                  <td>
                    {row.otherMembers.length === 0 ? (
                      <span className="other-empty">—</span>
                    ) : (
                      <div className="other-cell">
                        {previewOthers.map((item) => (
                          <span
                            key={`${row.id}-${item.key}`}
                            className="other-tag"
                            title={`${item.key}: ${item.value}`}
                          >
                            {item.key}:{item.value}
                          </span>
                        ))}
                        {extraCount > 0 && (
                          <button
                            type="button"
                            className="other-more-btn"
                            onClick={(event) => {
                              // Anchor floating panel near +N button while keeping it inside viewport.
                              const rect = event.currentTarget.getBoundingClientRect();
                              const width = 320;
                              const clampedLeft = Math.min(
                                Math.max(12, rect.left),
                                window.innerWidth - width - 12,
                              );
                              setOtherPopover((prev) =>
                                prev?.rowId === row.id
                                  ? null
                                  : { rowId: row.id, left: clampedLeft, top: rect.bottom + 6 },
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
                        {validComments.map((c) => (
                          <span key={`${row.id}-${c}`} className="comment-tag">
                            {c}
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
            {activeOtherRow.otherMembers.map((item, idx) => (
              <li key={`${activeOtherRow.id}-${item.key}-${idx}`}>
                <span>{item.key}</span>
                <span>{item.value}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {bandDetailRow && (
        <div className="modal-mask" onClick={() => setBandDetailRow(null)}>
          <div className="console-band-modal" onClick={(e) => e.stopPropagation()}>
            <div className="console-band-modal-head">
              <h4>{bandDetailRow.songName} · 乐队成员详情</h4>
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
              {getOrderedBandMembers(bandDetailRow.bandMembers).map((member) => (
                <div key={`${bandDetailRow.id}-${member.bandId}`} className="console-band-card">
                  <div className="console-band-card-head">
                    <span className={`band-tile ${member.current >= member.total ? "full" : "partial"}`}>
                      <img
                        src={`/icons/Band_${member.bandId}.svg`}
                        alt={member.bandName}
                        className="band-tile-icon"
                      />
                    </span>
                    <strong>{member.bandName}</strong>
                  </div>
                  <p className="console-band-members">参加队员：{member.presentMembers.join(" / ")}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
