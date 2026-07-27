import { useEffect, useMemo, useState } from "react";

import {
  correctConsoleBandLineupVersion,
  createConsoleBand,
  createConsoleBandLineupVersion,
  createConsoleBandNameVersion,
  getBandHistoryBackfillPreflight,
  getConsoleBandHistory,
  getConsoleBandLineupImpact,
  initializeConsoleBandHistory,
  type BandHistoryBackfillPreflight,
  type ConsoleBandCreatePayload,
  type ConsoleBandHistory,
  type ConsoleBandLineupVersion,
} from "../../api";
import { useAuth } from "../../auth/AuthProvider";
import { UpdateDiffTable, type UpdateChange } from "./UpdateDiffTable";
import type { BandOption } from "./types";


type BandAdminSectionProps = {
  bands: BandOption[];
  onMessage: (message: string) => void;
  onBandsChanged: () => Promise<void>;
};

type CorrectionImpact = {
  band_id: number;
  lineup_version_id: number;
  live_ids: number[];
  setlist_row_count: number;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseMembers(value: string): string[] {
  return [...new Set(value.split(/[\n,，]+/).map((member) => member.trim()).filter(Boolean))];
}

function membersText(members: string[]): string {
  return members.join("\n");
}

function buildBandCorrectionChanges(
  version: ConsoleBandLineupVersion | null,
  label: string,
  members: string[],
  validFrom: string,
  validTo: string,
): UpdateChange[] {
  if (version === null) return [];
  const values: Array<[string, string, string]> = [
    ["version_label", version.version_label, label.trim()],
    ["members", version.members.join(" / "), members.join(" / ")],
    ["valid_from", version.valid_from ?? "-", validFrom || "-"],
    ["valid_to", version.valid_to ?? "-", validTo || "-"],
  ];
  return values.flatMap(([field, before, after]) => before === after ? [] : [{ field, before, after }]);
}

function dateText(value: string | null): string {
  return value ?? "未设置";
}

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
  const [currentName, setCurrentName] = useState("");
  const [currentAbbr, setCurrentAbbr] = useState("");
  const [currentMembers, setCurrentMembers] = useState("");
  const [initialVersionNo, setInitialVersionNo] = useState("1");
  const [initialValidFrom, setInitialValidFrom] = useState("");
  const [confirmInitialize, setConfirmInitialize] = useState(false);

  const [nameVersionName, setNameVersionName] = useState("");
  const [nameVersionAbbr, setNameVersionAbbr] = useState("");
  const [nameValidFrom, setNameValidFrom] = useState("");
  const [nameValidTo, setNameValidTo] = useState("");
  const [nameMakeCurrent, setNameMakeCurrent] = useState(false);

  const [lineupVersionNo, setLineupVersionNo] = useState("");
  const [lineupVersionLabel, setLineupVersionLabel] = useState("");
  const [lineupPredecessorId, setLineupPredecessorId] = useState("");
  const [lineupChangeType, setLineupChangeType] =
    useState<"initial" | "addition" | "removal" | "replacement" | "correction">("addition");
  const [lineupMembers, setLineupMembers] = useState("");
  const [lineupValidFrom, setLineupValidFrom] = useState("");
  const [lineupValidTo, setLineupValidTo] = useState("");
  const [lineupMakeCurrent, setLineupMakeCurrent] = useState(false);

  const [correctingVersion, setCorrectingVersion] = useState<ConsoleBandLineupVersion | null>(null);
  const [correctionImpact, setCorrectionImpact] = useState<CorrectionImpact | null>(null);
  const [correctionLabel, setCorrectionLabel] = useState("");
  const [correctionMembers, setCorrectionMembers] = useState("");
  const [correctionValidFrom, setCorrectionValidFrom] = useState("");
  const [correctionValidTo, setCorrectionValidTo] = useState("");
  const [correctionConfirming, setCorrectionConfirming] = useState(false);
  const [preflight, setPreflight] = useState<BandHistoryBackfillPreflight | null>(null);

  const hydrateCurrentDraft = (nextHistory: ConsoleBandHistory) => {
    const currentLineup = nextHistory.lineup_versions.find((version) => version.valid_to === null);
    setCurrentName(nextHistory.current_name);
    setCurrentAbbr(nextHistory.current_abbr);
    setCurrentMembers(membersText(nextHistory.current_members));
    setInitialVersionNo(String(currentLineup?.version_no ?? 1));
  };

  const loadHistory = async (bandId: number) => {
    setLoading(true);
    try {
      const response = await getConsoleBandHistory(bandId);
      setSelectedBandId(bandId);
      setHistory(response);
      hydrateCurrentDraft(response);
    } catch (error) {
      onMessage(`加载乐队历史失败：${errorMessage(error)}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedBandId !== null || realBands.length === 0) return;
    void loadHistory(realBands[0].band_id);
  }, [realBands, selectedBandId]);

  const applyHistory = async (nextHistory: ConsoleBandHistory, message: string) => {
    setHistory(nextHistory);
    hydrateCurrentDraft(nextHistory);
    await onBandsChanged();
    onMessage(message);
  };

  const resetCreateDraft = () => {
    setCreateIdRange("regular");
    setCreateName("");
    setCreateAbbr("");
    setCreateMembers("");
    setCreateValidFrom("");
  };

  const submitCreate = async () => {
    const payload: ConsoleBandCreatePayload = {
      id_range: createIdRange,
      band_name: createName,
      band_abbr: createAbbr,
      members: parseMembers(createMembers),
      valid_from: createValidFrom || null,
    };
    setSubmitting(true);
    try {
      const response = await createConsoleBand(payload, auth.csrfToken ?? "");
      setSelectedBandId(response.item.band_id);
      setHistory(response.history);
      hydrateCurrentDraft(response.history);
      setConfirmCreate(false);
      setCreating(false);
      resetCreateDraft();
      await onBandsChanged();
      onMessage(`已新增 Band #${response.item.band_id}（${response.item.band_name}）并初始化 V1`);
    } catch (error) {
      onMessage(`新增乐队失败：${errorMessage(error)}`);
    } finally {
      setSubmitting(false);
    }
  };

  const initializeCurrent = async () => {
    if (selectedBandId === null) return;
    setSubmitting(true);
    try {
      const nextHistory = await initializeConsoleBandHistory(
        selectedBandId,
        {
          band_name: currentName,
          band_abbr: currentAbbr,
          members: parseMembers(currentMembers),
          version_no: Number(initialVersionNo),
          version_label: initialVersionLabel,
          valid_from: initialValidFrom || null,
          valid_to: null,
          note: "控制台确认当前资料并初始化历史版本",
        },
        auth.csrfToken ?? "",
      );
      setConfirmInitialize(false);
      await applyHistory(nextHistory, `已确认并初始化 Band #${selectedBandId}`);
    } catch (error) {
      onMessage(`初始化乐队历史失败：${errorMessage(error)}`);
    } finally {
      setSubmitting(false);
    }
  };

  const createNameVersion = async () => {
    if (selectedBandId === null) return;
    setSubmitting(true);
    try {
      const nextHistory = await createConsoleBandNameVersion(
        selectedBandId,
        {
          band_name: nameVersionName,
          band_abbr: nameVersionAbbr.trim() || null,
          valid_from: nameValidFrom || null,
          valid_to: nameMakeCurrent ? null : nameValidTo || null,
          note: null,
          make_current: nameMakeCurrent,
        },
        auth.csrfToken ?? "",
      );
      setNameVersionName("");
      setNameVersionAbbr("");
      setNameValidFrom("");
      setNameValidTo("");
      setNameMakeCurrent(false);
      await applyHistory(nextHistory, `已新增 Band #${selectedBandId} 名称版本`);
    } catch (error) {
      onMessage(`新增名称版本失败：${errorMessage(error)}`);
    } finally {
      setSubmitting(false);
    }
  };

  const createLineupVersion = async () => {
    if (selectedBandId === null) return;
    setSubmitting(true);
    try {
      const nextHistory = await createConsoleBandLineupVersion(
        selectedBandId,
        {
          version_no: lineupVersionNo ? Number(lineupVersionNo) : null,
          version_label: lineupVersionLabel,
          predecessor_id: lineupPredecessorId ? Number(lineupPredecessorId) : null,
          change_type: lineupChangeType,
          members: parseMembers(lineupMembers),
          valid_from: lineupValidFrom || null,
          valid_to: lineupMakeCurrent ? null : lineupValidTo || null,
          note: null,
          make_current: lineupMakeCurrent,
        },
        auth.csrfToken ?? "",
      );
      setLineupVersionNo("");
      setLineupVersionLabel("");
      setLineupPredecessorId("");
      setLineupMembers("");
      setLineupValidFrom("");
      setLineupValidTo("");
      setLineupMakeCurrent(false);
      await applyHistory(nextHistory, `已新增 Band #${selectedBandId} 阵容版本`);
    } catch (error) {
      onMessage(`新增阵容版本失败：${errorMessage(error)}`);
    } finally {
      setSubmitting(false);
    }
  };

  const beginCorrection = async (version: ConsoleBandLineupVersion) => {
    if (selectedBandId === null) return;
    setLoading(true);
    try {
      const impact = await getConsoleBandLineupImpact(selectedBandId, version.lineup_version_id);
      setCorrectingVersion(version);
      setCorrectionConfirming(false);
      setCorrectionImpact(impact);
      setCorrectionLabel(version.version_label);
      setCorrectionMembers(membersText(version.members));
      setCorrectionValidFrom(version.valid_from ?? "");
      setCorrectionValidTo(version.valid_to ?? "");
    } catch (error) {
      onMessage(`加载资料修正影响范围失败：${errorMessage(error)}`);
    } finally {
      setLoading(false);
    }
  };

  const submitCorrection = async () => {
    if (selectedBandId === null || correctingVersion === null || correctionImpact === null) return;
    setSubmitting(true);
    try {
      const nextHistory = await correctConsoleBandLineupVersion(
        selectedBandId,
        correctingVersion.lineup_version_id,
        {
          version_label: correctionLabel,
          members: parseMembers(correctionMembers),
          valid_from: correctionValidFrom || null,
          valid_to: correctionValidTo || null,
          note: "开发整理期资料修正",
          confirmed_live_ids: correctionImpact.live_ids,
        },
        auth.csrfToken ?? "",
      );
      setCorrectingVersion(null);
      setCorrectionImpact(null);
      setCorrectionConfirming(false);
      await applyHistory(nextHistory, `已修正阵容版本 #${correctingVersion.lineup_version_id}`);
    } catch (error) {
      onMessage(`资料修正失败：${errorMessage(error)}`);
    } finally {
      setSubmitting(false);
    }
  };

  const runPreflight = async () => {
    setLoading(true);
    try {
      const result = await getBandHistoryBackfillPreflight();
      setPreflight(result);
      onMessage(result.ready ? "历史关系回填预检通过" : `历史关系回填预检发现 ${result.issues.length} 项问题`);
    } catch (error) {
      onMessage(`历史关系回填预检失败：${errorMessage(error)}`);
    } finally {
      setLoading(false);
    }
  };

  const initializeDisabled =
    submitting ||
    currentName.trim() === "" ||
    parseMembers(currentMembers).length === 0 ||
    Number(initialVersionNo) < 1;
  const createDisabled =
    submitting ||
    createName.trim() === "" ||
    parseMembers(createMembers).length === 0;
  const initialVersionLabel = `${currentName.trim()} V${initialVersionNo}`;
  const correctionChanges = buildBandCorrectionChanges(
    correctingVersion,
    correctionLabel,
    parseMembers(correctionMembers),
    correctionValidFrom,
    correctionValidTo,
  );

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
            <option key={band.band_id} value={band.band_id}>
              #{band.band_id} {band.band_name}
            </option>
          ))}
        </select>
        <button type="button" className="console-ghost-btn" disabled={submitting} onClick={() => setCreating((current) => !current)}>
          {creating ? "收起新增" : "新增 Band"}
        </button>
        <button type="button" className="console-ghost-btn" disabled={loading} onClick={() => void runPreflight()}>
          回填预检
        </button>
      </div>

      {creating && (
        <div className="tour-admin-block">
          <h3>新增 Band</h3>
          <div className="tour-admin-fields band-admin-current-fields">
            <label>
              编号段
              <select
                value={createIdRange}
                onChange={(event) => setCreateIdRange(event.target.value as ConsoleBandCreatePayload["id_range"])}
              >
                <option value="regular">常规编号（1–99）</option>
                <option value="special">特殊编号（101+，100 保留）</option>
              </select>
            </label>
            <label>
              当前名称
              <input value={createName} onChange={(event) => setCreateName(event.target.value)} />
            </label>
            <label>
              缩写
              <input value={createAbbr} onChange={(event) => setCreateAbbr(event.target.value)} />
            </label>
            <label>
              生效日期（可空）
              <input type="date" value={createValidFrom} onChange={(event) => setCreateValidFrom(event.target.value)} />
            </label>
            <label className="band-admin-members-field">
              当前成员（每行一人）
              <textarea rows={6} value={createMembers} onChange={(event) => setCreateMembers(event.target.value)} />
            </label>
          </div>
          <p className="console-admin-hint">ID 由服务端按所选编号段连续分配；新增成功时同时建立当前名称与 V1 阵容历史。</p>
          <div className="console-submit-row">
            <button type="button" className="console-submit-btn" disabled={createDisabled} onClick={() => setConfirmCreate(true)}>
              检查新增资料
            </button>
          </div>
        </div>
      )}

      {history && (
        <>
          <div className="tour-admin-block">
            <h3>当前资料候选</h3>
            <div className="tour-admin-fields band-admin-current-fields">
              <label>
                当前名称
                <input value={currentName} disabled={history.initialized} onChange={(event) => setCurrentName(event.target.value)} />
              </label>
              <label>
                缩写
                <input value={currentAbbr} disabled={history.initialized} onChange={(event) => setCurrentAbbr(event.target.value)} />
              </label>
              <label>
                当前阵容版本号（标签自动生成）
                <input type="number" min={1} value={initialVersionNo} disabled={history.initialized} onChange={(event) => setInitialVersionNo(event.target.value)} />
              </label>
              <label>
                生效日期（可空）
                <input type="date" value={initialValidFrom} disabled={history.initialized} onChange={(event) => setInitialValidFrom(event.target.value)} />
              </label>
              <label className="band-admin-members-field">
                当前成员（每行一人）
                <textarea rows={6} value={currentMembers} disabled={history.initialized} onChange={(event) => setCurrentMembers(event.target.value)} />
              </label>
            </div>
            <div className="console-submit-row">
              {history.initialized ? (
                <span className="console-admin-hint">当前资料已确认并建立版本；后续变化请新增名称或阵容版本。</span>
              ) : (
                <button type="button" className="console-submit-btn" disabled={initializeDisabled} onClick={() => setConfirmInitialize(true)}>
                  确认并初始化当前版本
                </button>
              )}
            </div>
          </div>

          {history.initialized && (
            <>
              <div className="tour-admin-block">
                <h3>历史名称</h3>
                <div className="console-table-wrap">
                  <table className="console-admin-table band-history-table" aria-label="乐队历史名称">
                    <thead>
                      <tr><th>ID</th><th>名称</th><th>缩写</th><th>有效期</th><th>引用 Live</th></tr>
                    </thead>
                    <tbody>
                      {history.name_versions.map((version) => (
                        <tr key={version.name_version_id}>
                          <td>{version.name_version_id}</td>
                          <td>{version.band_name}</td>
                          <td>{version.band_abbr ?? "-"}</td>
                          <td>{dateText(version.valid_from)} → {dateText(version.valid_to)}</td>
                          <td>{version.live_ids.length}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="tour-admin-fields band-version-form">
                  <label>名称<input value={nameVersionName} onChange={(event) => setNameVersionName(event.target.value)} /></label>
                  <label>缩写<input value={nameVersionAbbr} onChange={(event) => setNameVersionAbbr(event.target.value)} /></label>
                  <label>生效日期<input type="date" value={nameValidFrom} onChange={(event) => setNameValidFrom(event.target.value)} /></label>
                  <label>结束日期<input type="date" value={nameValidTo} disabled={nameMakeCurrent} onChange={(event) => setNameValidTo(event.target.value)} /></label>
                  <label className="song-cover-field">
                    <span>设为当前名称</span>
                    <span className="song-cover-control">
                      <input type="checkbox" checked={nameMakeCurrent} onChange={(event) => setNameMakeCurrent(event.target.checked)} />是
                    </span>
                  </label>
                </div>
                <div className="console-submit-row">
                  <button type="button" className="console-submit-btn" disabled={submitting || !nameVersionName.trim()} onClick={() => void createNameVersion()}>
                    新增名称版本
                  </button>
                </div>
              </div>

              <div className="tour-admin-block">
                <h3>阵容时间线</h3>
                <div className="console-table-wrap">
                  <table className="console-admin-table band-history-table" aria-label="乐队阵容时间线">
                    <thead>
                      <tr><th>版本</th><th>类型</th><th>成员</th><th>变化</th><th>有效期</th><th>引用</th><th>操作</th></tr>
                    </thead>
                    <tbody>
                      {history.lineup_versions.map((version) => (
                        <tr key={version.lineup_version_id}>
                          <td>V{version.version_no} · {version.version_label}</td>
                          <td>{version.change_type}</td>
                          <td>{version.members.join(" / ")}</td>
                          <td>
                            {version.added_members.length > 0 ? `+ ${version.added_members.join(" / ")}` : ""}
                            {version.removed_members.length > 0 ? ` − ${version.removed_members.join(" / ")}` : ""}
                            {version.added_members.length === 0 && version.removed_members.length === 0 ? "-" : ""}
                          </td>
                          <td>{dateText(version.valid_from)} → {dateText(version.valid_to)}</td>
                          <td>{version.live_ids.length} Live</td>
                          <td>
                            <button type="button" className="console-ghost-btn" onClick={() => void beginCorrection(version)}>
                              资料修正
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="tour-admin-fields band-version-form">
                  <label>版本号（可空）<input type="number" min={1} value={lineupVersionNo} onChange={(event) => setLineupVersionNo(event.target.value)} /></label>
                  <label>版本标签<input value={lineupVersionLabel} onChange={(event) => setLineupVersionLabel(event.target.value)} /></label>
                  <label>
                    直接前驱
                    <select value={lineupPredecessorId} onChange={(event) => setLineupPredecessorId(event.target.value)}>
                      <option value="">无</option>
                      {history.lineup_versions.map((version) => (
                        <option key={version.lineup_version_id} value={version.lineup_version_id}>
                          V{version.version_no} · {version.version_label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    变化类型
                    <select value={lineupChangeType} onChange={(event) => setLineupChangeType(event.target.value as typeof lineupChangeType)}>
                      <option value="addition">增加</option>
                      <option value="removal">减少</option>
                      <option value="replacement">更换</option>
                      <option value="correction">资料修正</option>
                      <option value="initial">初始</option>
                    </select>
                  </label>
                  <label>生效日期<input type="date" value={lineupValidFrom} onChange={(event) => setLineupValidFrom(event.target.value)} /></label>
                  <label>结束日期<input type="date" value={lineupValidTo} disabled={lineupMakeCurrent} onChange={(event) => setLineupValidTo(event.target.value)} /></label>
                  <label className="band-admin-members-field">成员（每行一人）<textarea rows={6} value={lineupMembers} onChange={(event) => setLineupMembers(event.target.value)} /></label>
                  <label className="song-cover-field">
                    <span>设为当前阵容</span>
                    <span className="song-cover-control"><input type="checkbox" checked={lineupMakeCurrent} onChange={(event) => setLineupMakeCurrent(event.target.checked)} />是</span>
                  </label>
                </div>
                <div className="console-submit-row">
                  <button
                    type="button"
                    className="console-submit-btn"
                    disabled={submitting || !lineupVersionLabel.trim() || parseMembers(lineupMembers).length === 0}
                    onClick={() => void createLineupVersion()}
                  >
                    新增阵容版本
                  </button>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {preflight && (
        <div className="tour-admin-block" role="status">
          <h3>回填预检：{preflight.ready ? "通过" : "未通过"}</h3>
          <p>
            Setlist {preflight.setlist_row_count} 行 · Band 出演 {preflight.performance_count} 条 ·
            成员 {preflight.member_count} 条 · Live/Band 上下文 {preflight.live_band_context_count} 条
          </p>
          {preflight.issues.length > 0 && (
            <div className="console-table-wrap">
              <table className="console-admin-table band-history-table" aria-label="回填预检问题">
                <thead><tr><th>code</th><th>Live</th><th>Band</th><th>说明</th></tr></thead>
                <tbody>
                  {preflight.issues.map((issue, index) => (
                    <tr key={`${issue.code}-${issue.setlist_id ?? index}`}>
                      <td>{issue.code}</td><td>{issue.live_id ?? "-"}</td><td>{issue.band_name ?? "-"}</td><td>{issue.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {confirmInitialize && history && (
        <div className="modal-mask" onClick={() => setConfirmInitialize(false)}>
          <div className="modal console-confirm-modal compact" role="dialog" aria-modal="true" aria-labelledby="band-init-title" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head"><h2 id="band-init-title">确认当前 Band 资料</h2></div>
            <div className="console-confirm-body">
              <p>Band #{history.band_id} 将以以下内容建立当前名称与初始阵容版本：</p>
              <p><strong>{initialVersionLabel}</strong></p>
              <p>{parseMembers(currentMembers).join(" / ")}</p>
            </div>
            <div className="console-confirm-actions">
              <button type="button" className="console-ghost-btn" disabled={submitting} onClick={() => setConfirmInitialize(false)}>取消</button>
              <button type="button" className="console-submit-btn" disabled={submitting} onClick={() => void initializeCurrent()}>确认初始化</button>
            </div>
          </div>
        </div>
      )}

      {confirmCreate && (
        <div className="modal-mask" onClick={() => setConfirmCreate(false)}>
          <div className="modal console-confirm-modal compact" role="dialog" aria-modal="true" aria-labelledby="band-create-title" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head"><h2 id="band-create-title">确认新增 Band</h2></div>
            <div className="console-confirm-body">
              <p>
                编号段：{createIdRange === "regular" ? "常规编号（1–99）" : "特殊编号（101+，100 保留）"}
              </p>
              <p>最终 ID 将由服务端在提交时分配。</p>
              <p><strong>{createName.trim()} V1</strong></p>
              <p>{parseMembers(createMembers).join(" / ")}</p>
              <p>生效日期：{createValidFrom || "未设置"}</p>
            </div>
            <div className="console-confirm-actions">
              <button type="button" className="console-ghost-btn" disabled={submitting} onClick={() => setConfirmCreate(false)}>返回修改</button>
              <button type="button" className="console-submit-btn" disabled={submitting} onClick={() => void submitCreate()}>确认新增</button>
            </div>
          </div>
        </div>
      )}

      {correctingVersion && correctionImpact && (
        <div className="modal-mask" onClick={() => {
          setCorrectingVersion(null);
          setCorrectionConfirming(false);
        }}>
          <div className="modal console-confirm-modal wide" role="dialog" aria-modal="true" aria-labelledby="band-correction-title" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <h2 id="band-correction-title">
                {correctionConfirming ? "确认资料修正" : "资料修正"}：{correctingVersion.version_label}
              </h2>
            </div>
            <div className="console-confirm-body">
              <p className="console-admin-warning">
                影响 {correctionImpact.live_ids.length} 场 Live、{correctionImpact.setlist_row_count} 条 Setlist：
                {correctionImpact.live_ids.length > 0 ? correctionImpact.live_ids.join(" / ") : "无引用"}
              </p>
              {correctionConfirming ? (
                <UpdateDiffTable changes={correctionChanges} ariaLabel="乐队资料修改内容" />
              ) : (
                <div className="tour-admin-fields">
                  <label>版本标签<input value={correctionLabel} onChange={(event) => setCorrectionLabel(event.target.value)} /></label>
                  <label>生效日期<input type="date" value={correctionValidFrom} onChange={(event) => setCorrectionValidFrom(event.target.value)} /></label>
                  <label>结束日期<input type="date" value={correctionValidTo} onChange={(event) => setCorrectionValidTo(event.target.value)} /></label>
                  <label className="band-admin-members-field">成员（每行一人）<textarea rows={8} value={correctionMembers} onChange={(event) => setCorrectionMembers(event.target.value)} /></label>
                </div>
              )}
            </div>
            <div className="console-confirm-actions">
              <button
                type="button"
                className="console-ghost-btn"
                disabled={submitting}
                onClick={() => {
                  if (correctionConfirming) setCorrectionConfirming(false);
                  else setCorrectingVersion(null);
                }}
              >
                {correctionConfirming ? "返回修改" : "取消"}
              </button>
              <button
                type="button"
                className="console-submit-btn"
                disabled={
                  submitting ||
                  !correctionLabel.trim() ||
                  parseMembers(correctionMembers).length === 0 ||
                  correctionChanges.length === 0
                }
                onClick={() => {
                  if (correctionConfirming) void submitCorrection();
                  else setCorrectionConfirming(true);
                }}
              >
                {correctionConfirming ? "确认资料修正" : "检查修改"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
