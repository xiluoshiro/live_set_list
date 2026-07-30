import { useEffect, useMemo, useState } from "react";

import {
  createConsoleBand,
  createConsoleBandLineupVersion,
  getConsoleBandHistory,
  getConsoleBandTransitionLiveCandidates,
  type ConsoleBandCreatePayload,
  type ConsoleBandHistory,
  type ConsoleBandLineupVersionPayload,
  type ConsoleBandTransitionLiveCandidate,
} from "../../api";
import { useAuth } from "../../auth/AuthProvider";
import { CompactConfirmationTable } from "./CompactConfirmationTable";
import type { BandOption } from "./types";


type BandAdminSectionProps = {
  bands: BandOption[];
  onMessage: (message: string) => void;
  onBandsChanged: () => Promise<void>;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseMembers(value: string): string[] {
  return [...new Set(value.split(/[\n,，]+/).map((member) => member.trim()).filter(Boolean))];
}

function dateText(value: string | null): string {
  return value ?? "开放";
}

const LINEUP_CHANGE_TYPE_LABELS: Record<
  ConsoleBandLineupVersionPayload["change_type"],
  string
> = {
  addition: "增加",
  removal: "减少",
  replacement: "更换",
  correction: "追加式资料修正",
};

export function BandAdminSection({ bands, onMessage, onBandsChanged }: BandAdminSectionProps) {
  const auth = useAuth();
  const realBands = useMemo(
    () => bands.filter((band) => band.band_id > 0).sort((left, right) => left.band_id - right.band_id),
    [bands],
  );
  const [selectedBandId, setSelectedBandId] = useState<number | null>(null);
  const [history, setHistory] = useState<ConsoleBandHistory | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [creating, setCreating] = useState(false);
  const [createIdRange, setCreateIdRange] = useState<ConsoleBandCreatePayload["id_range"]>("regular");
  const [createName, setCreateName] = useState("");
  const [createAbbr, setCreateAbbr] = useState("");
  const [createMembers, setCreateMembers] = useState("");
  const [createValidFrom, setCreateValidFrom] = useState("");
  const [confirmCreate, setConfirmCreate] = useState(false);

  const [lineupLabel, setLineupLabel] = useState("");
  const [lineupChangeType, setLineupChangeType] =
    useState<ConsoleBandLineupVersionPayload["change_type"]>("replacement");
  const [lineupMembers, setLineupMembers] = useState("");
  const [lineupValidFrom, setLineupValidFrom] = useState("");
  const [lineupNote, setLineupNote] = useState("");
  const [transitionDate, setTransitionDate] = useState("");
  const [transitionCandidates, setTransitionCandidates] =
    useState<ConsoleBandTransitionLiveCandidate[]>([]);
  const [transitionLiveId, setTransitionLiveId] = useState<number | null>(null);
  const [confirmLineup, setConfirmLineup] = useState(false);

  const loadHistory = async (bandId: number) => {
    setSelectedBandId(bandId);
    setLoading(true);
    try {
      const nextHistory = await getConsoleBandHistory(bandId);
      setHistory(nextHistory);
      setLineupMembers(nextHistory.current_members.join("\n"));
      setTransitionCandidates([]);
      setTransitionLiveId(null);
    } catch (error) {
      setHistory(null);
      onMessage(`加载 Band 历史失败：${errorMessage(error)}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (realBands.length === 0) {
      setSelectedBandId(null);
      setHistory(null);
      return;
    }
    const nextId = selectedBandId && realBands.some((band) => band.band_id === selectedBandId)
      ? selectedBandId
      : realBands[0].band_id;
    if (history?.band_id !== nextId) void loadHistory(nextId);
  }, [history?.band_id, realBands, selectedBandId]);

  const submitCreate = async () => {
    setSubmitting(true);
    try {
      const result = await createConsoleBand(
        {
          id_range: createIdRange,
          band_name: createName,
          band_abbr: createAbbr,
          members: parseMembers(createMembers),
          valid_from: createValidFrom || null,
        },
        auth.csrfToken ?? "",
      );
      setConfirmCreate(false);
      setCreating(false);
      setCreateName("");
      setCreateAbbr("");
      setCreateMembers("");
      setCreateValidFrom("");
      setSelectedBandId(result.item.band_id);
      setHistory(result.history);
      await onBandsChanged();
      onMessage(`已新增 Band #${result.item.band_id}，并原子建立名称版本、V1 阵容和成员`);
    } catch (error) {
      onMessage(`新增 Band 失败：${errorMessage(error)}`);
    } finally {
      setSubmitting(false);
    }
  };

  const queryTransitionLives = async () => {
    if (selectedBandId === null || transitionDate === "") return;
    setLoading(true);
    try {
      const candidates = await getConsoleBandTransitionLiveCandidates(selectedBandId, transitionDate);
      setTransitionCandidates(candidates);
      setTransitionLiveId(null);
      onMessage(candidates.length > 0 ? `找到 ${candidates.length} 场候选 Live` : "该日期没有关联此 Band 的 Live");
    } catch (error) {
      onMessage(`查询交接 Live 失败：${errorMessage(error)}`);
    } finally {
      setLoading(false);
    }
  };

  const submitLineup = async () => {
    if (selectedBandId === null) return;
    setSubmitting(true);
    try {
      const nextHistory = await createConsoleBandLineupVersion(
        selectedBandId,
        {
          version_label: lineupLabel,
          change_type: lineupChangeType,
          members: parseMembers(lineupMembers),
          valid_from: lineupValidFrom,
          note: lineupNote.trim() || null,
          transition_live_id: lineupChangeType === "correction" ? null : transitionLiveId,
        },
        auth.csrfToken ?? "",
      );
      setHistory(nextHistory);
      setLineupLabel("");
      setLineupMembers(nextHistory.current_members.join("\n"));
      setLineupValidFrom("");
      setLineupNote("");
      setTransitionDate("");
      setTransitionCandidates([]);
      setTransitionLiveId(null);
      setConfirmLineup(false);
      await onBandsChanged();
      onMessage(
        `已追加 Band #${selectedBandId} 的 V${
          nextHistory.lineup_versions[nextHistory.lineup_versions.length - 1]?.version_no ?? ""
        } 阵容`,
      );
    } catch (error) {
      onMessage(`新增阵容版本失败：${errorMessage(error)}`);
    } finally {
      setSubmitting(false);
    }
  };

  const currentLineup = history?.lineup_versions.find(
    (version) => version.lineup_version_id === history.current_lineup_version_id,
  ) ?? null;
  const nextMembers = parseMembers(lineupMembers);
  const currentMemberSet = new Set(currentLineup?.members ?? []);
  const nextMemberSet = new Set(nextMembers);
  const addedMembers = nextMembers.filter((member) => !currentMemberSet.has(member));
  const removedMembers = (currentLineup?.members ?? []).filter((member) => !nextMemberSet.has(member));
  const selectedTransition = transitionCandidates.find((candidate) => candidate.live_id === transitionLiveId);
  const createDisabled =
    submitting || createName.trim() === "" || parseMembers(createMembers).length === 0;
  const lineupDisabled =
    submitting ||
    lineupLabel.trim() === "" ||
    lineupValidFrom === "" ||
    nextMembers.length === 0;

  return (
    <section className="tour-admin-section" aria-label="乐队管理">
      <div className="tour-admin-toolbar">
        <label htmlFor="band-admin-select">已有 Band</label>
        <select
          id="band-admin-select"
          className="console-entity-select"
          value={selectedBandId ?? ""}
          disabled={loading}
          onChange={(event) => void loadHistory(Number(event.target.value))}
        >
          {realBands.map((band) => (
            <option key={band.band_id} value={band.band_id}>#{band.band_id} {band.band_name}</option>
          ))}
        </select>
        <button type="button" className="console-ghost-btn" disabled={submitting} onClick={() => setCreating((value) => !value)}>
          {creating ? "收起新增" : "新增 Band"}
        </button>
      </div>

      {creating && (
        <div className="tour-admin-block">
          <h3>新增 Band</h3>
          <div className="tour-admin-fields band-admin-current-fields">
            <label>编号段
              <select value={createIdRange} onChange={(event) => setCreateIdRange(event.target.value as ConsoleBandCreatePayload["id_range"])}>
                <option value="regular">常规编号（1–99）</option>
                <option value="special">特殊编号（101+，100 保留）</option>
              </select>
            </label>
            <label>当前名称<input value={createName} onChange={(event) => setCreateName(event.target.value)} /></label>
            <label>缩写<input value={createAbbr} onChange={(event) => setCreateAbbr(event.target.value)} /></label>
            <label>V1 生效日期（可空）<input type="date" value={createValidFrom} onChange={(event) => setCreateValidFrom(event.target.value)} /></label>
            <label className="band-admin-members-field">V1 成员（每行一人）
              <textarea rows={6} value={createMembers} onChange={(event) => setCreateMembers(event.target.value)} />
            </label>
          </div>
          <p className="console-admin-hint">服务端将在一个事务中写入稳定 Band、当前名称、V1 阵容及全部成员。</p>
          <div className="console-submit-row">
            <button type="button" className="console-submit-btn" disabled={createDisabled} onClick={() => setConfirmCreate(true)}>
              检查新增资料
            </button>
          </div>
        </div>
      )}

      {history && currentLineup && (
        <>
          <div className="tour-admin-block">
            <h3>历史名称（只读）</h3>
            <div className="console-table-wrap">
              <table className="console-admin-table band-history-table" aria-label="乐队历史名称">
                <thead><tr><th>ID</th><th>名称</th><th>缩写</th><th>有效期</th><th>引用 Live</th></tr></thead>
                <tbody>
                  {history.name_versions.map((version) => (
                    <tr key={version.name_version_id}>
                      <td>{version.name_version_id}</td><td>{version.band_name}</td><td>{version.band_abbr ?? "-"}</td>
                      <td>{dateText(version.valid_from)} → {dateText(version.valid_to)}</td><td>{version.live_ids.length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="tour-admin-block">
            <h3>阵容时间线（只读）</h3>
            <div className="console-table-wrap">
              <table className="console-admin-table band-history-table" aria-label="乐队阵容时间线">
                <thead><tr><th>版本</th><th>类型</th><th>成员</th><th>变化</th><th>有效期</th><th>交接 Live</th></tr></thead>
                <tbody>
                  {history.lineup_versions.map((version) => (
                    <tr key={version.lineup_version_id}>
                      <td>V{version.version_no} · {version.version_label}</td><td>{version.change_type}</td>
                      <td>{version.members.join(" / ")}</td>
                      <td>{version.added_members.length ? `+ ${version.added_members.join(" / ")}` : ""}{version.removed_members.length ? ` − ${version.removed_members.join(" / ")}` : ""}{!version.added_members.length && !version.removed_members.length ? "-" : ""}</td>
                      <td>{dateText(version.valid_from)} → {dateText(version.valid_to)}</td>
                      <td>{version.transition_live_id ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="tour-admin-block">
            <h3>追加当前阵容版本</h3>
            <p className="console-admin-hint">当前为 V{currentLineup.version_no}。提交后服务端自动闭合其有效期并建立唯一后继；已提交版本不可改写。</p>
            <div className="tour-admin-fields band-version-form">
              <label>版本标签<input value={lineupLabel} onChange={(event) => setLineupLabel(event.target.value)} /></label>
              <label>变化类型
                <select value={lineupChangeType} onChange={(event) => {
                  const value = event.target.value as ConsoleBandLineupVersionPayload["change_type"];
                  setLineupChangeType(value);
                  if (value === "correction") setTransitionLiveId(null);
                }}>
                  <option value="addition">增加</option><option value="removal">减少</option>
                  <option value="replacement">更换</option><option value="correction">追加式资料修正</option>
                </select>
              </label>
              <label>生效日期<input type="date" value={lineupValidFrom} onChange={(event) => setLineupValidFrom(event.target.value)} /></label>
              <label className="band-admin-members-field">新版本成员（每行一人）
                <textarea rows={6} value={lineupMembers} onChange={(event) => setLineupMembers(event.target.value)} />
              </label>
              <label className="band-admin-members-field">备注
                <textarea rows={3} value={lineupNote} onChange={(event) => setLineupNote(event.target.value)} />
              </label>
            </div>
            {lineupChangeType !== "correction" && (
              <div className="tour-admin-fields band-version-form">
                <label>交接 Live 日期（可空）
                  <input type="date" value={transitionDate} onChange={(event) => setTransitionDate(event.target.value)} />
                </label>
                <button type="button" className="console-ghost-btn" disabled={loading || !transitionDate} onClick={() => void queryTransitionLives()}>
                  查询候选
                </button>
                <label>交接 Live（可空）
                  <select value={transitionLiveId ?? ""} onChange={(event) => setTransitionLiveId(event.target.value ? Number(event.target.value) : null)}>
                    <option value="">不设置交接 Live</option>
                    {transitionCandidates.map((candidate) => (
                      <option key={candidate.live_id} value={candidate.live_id}>#{candidate.live_id} {candidate.live_name}</option>
                    ))}
                  </select>
                </label>
              </div>
            )}
            <div className="console-submit-row">
              <button type="button" className="console-submit-btn" disabled={lineupDisabled} onClick={() => setConfirmLineup(true)}>
                检查版本变化
              </button>
            </div>
          </div>
        </>
      )}

      {confirmCreate && (
        <div className="modal-mask" onClick={() => !submitting && setConfirmCreate(false)}>
          <div className="modal console-confirm-modal compact" role="dialog" aria-modal="true" aria-labelledby="band-create-title" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head"><h2 id="band-create-title">确认新增 Band</h2></div>
            <div className="console-confirm-body">
              <CompactConfirmationTable ariaLabel="新增 Band 确认" rows={[
                ["编号段", createIdRange === "regular" ? "1–99" : "101+"],
                ["名称", createName.trim()],
                ["缩写", createAbbr.trim() || "-"],
                ["V1 生效日", createValidFrom || "-"],
                ["V1 成员", parseMembers(createMembers).join(" / ")],
              ]} />
            </div>
            <div className="console-confirm-actions">
              <button type="button" className="console-ghost-btn" disabled={submitting} onClick={() => setConfirmCreate(false)}>取消</button>
              <button type="button" className="console-submit-btn" disabled={submitting} onClick={() => void submitCreate()}>确认新增</button>
            </div>
          </div>
        </div>
      )}

      {confirmLineup && currentLineup && (
        <div className="modal-mask" onClick={() => !submitting && setConfirmLineup(false)}>
          <div className="modal console-confirm-modal compact" role="dialog" aria-modal="true" aria-labelledby="band-lineup-title" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head"><h2 id="band-lineup-title">确认追加阵容版本</h2></div>
            <div className="console-confirm-body">
              <CompactConfirmationTable ariaLabel="阵容版本变化确认" rows={[
                ["版本", `V${currentLineup.version_no} → V${currentLineup.version_no + 1}`],
                ["版本标签", lineupLabel.trim() || "-"],
                ["变化类型", LINEUP_CHANGE_TYPE_LABELS[lineupChangeType]],
                ["旧版本有效期", `${dateText(currentLineup.valid_from)} → ${lineupValidFrom}`],
                ["新版本有效期", `${lineupValidFrom} → 开放`],
                ["新版本成员", parseMembers(lineupMembers).join(" / ")],
                ["增加成员", addedMembers.join(" / ") || "-"],
                ["移除成员", removedMembers.join(" / ") || "-"],
                ["备注", lineupNote.trim() || "-"],
                ["交接 Live", selectedTransition ? `#${selectedTransition.live_id} ${selectedTransition.live_name}` : "无"],
              ]} />
            </div>
            <div className="console-confirm-actions">
              <button type="button" className="console-ghost-btn" disabled={submitting} onClick={() => setConfirmLineup(false)}>取消</button>
              <button type="button" className="console-submit-btn" disabled={submitting} onClick={() => void submitLineup()}>确认追加</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
