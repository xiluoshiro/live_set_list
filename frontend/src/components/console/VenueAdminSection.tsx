import { useEffect, useState, type ReactNode } from "react";

import {
  createConsoleVenue,
  createConsoleVenueNameVersion,
  getConsoleVenue,
  getConsoleVenuePage,
  updateConsoleVenueKind,
  updateConsoleVenueNameVersion,
  type ConsoleVenueDetail,
  type ConsoleVenueItem,
} from "../../api";
import { useAuth } from "../../auth/AuthProvider";
import { CompactConfirmationTable } from "./CompactConfirmationTable";
import { ConsoleDateInput, isIsoCalendarDate } from "./ConsoleDateInput";

type VenueAdminSectionProps = {
  onMessage: (message: string) => void;
  onVenuesChanged: () => Promise<void>;
};

type ConfirmationKind = "create" | "kind" | "rename" | "correction";

type VenueConfirmation = {
  title: string;
  ariaLabel: string;
  rows: ReadonlyArray<readonly [label: string, value: ReactNode]>;
  confirmLabel: string;
  submit: () => Promise<void>;
};

const VENUE_PAGE_SIZE = 100;

const KIND_LABELS: Record<ConsoleVenueDetail["venue_kind"], string> = {
  physical: "实体场馆",
  online: "线上",
  undisclosed: "未公开",
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function dateText(value: string | null, emptyText: string): string {
  return value ?? emptyText;
}

export function VenueAdminSection({ onMessage, onVenuesChanged }: VenueAdminSectionProps) {
  const auth = useAuth();
  const [venues, setVenues] = useState<ConsoleVenueItem[]>([]);
  const [selectedVenueId, setSelectedVenueId] = useState<number | null>(null);
  const [detail, setDetail] = useState<ConsoleVenueDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailLoadFailed, setDetailLoadFailed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [confirmationKind, setConfirmationKind] = useState<ConfirmationKind | null>(null);

  const [createName, setCreateName] = useState("");
  const [createKind, setCreateKind] = useState<ConsoleVenueDetail["venue_kind"]>("physical");
  const [kindDraft, setKindDraft] = useState<ConsoleVenueDetail["venue_kind"]>("physical");
  const [renameName, setRenameName] = useState("");
  const [renameDate, setRenameDate] = useState("");
  const [correctionVersionId, setCorrectionVersionId] = useState<number | null>(null);
  const [correctionName, setCorrectionName] = useState("");

  const applyDetail = (nextDetail: ConsoleVenueDetail) => {
    setDetail(nextDetail);
    setKindDraft(nextDetail.venue_kind);
    const selectedVersion = nextDetail.name_versions.find(
      (version) => version.venue_name_version_id === correctionVersionId,
    ) ?? nextDetail.name_versions.find((version) => version.is_current)
      ?? nextDetail.name_versions[0]
      ?? null;
    setCorrectionVersionId(selectedVersion?.venue_name_version_id ?? null);
    setCorrectionName(selectedVersion?.venue_name ?? "");
  };

  const loadDetail = async (venueId: number) => {
    setSelectedVenueId(venueId);
    setLoading(true);
    setDetailLoadFailed(false);
    try {
      applyDetail(await getConsoleVenue(venueId));
    } catch (error) {
      setDetail(null);
      setDetailLoadFailed(true);
      onMessage(`加载 Venue 详情失败：${errorMessage(error)}`);
    } finally {
      setLoading(false);
    }
  };

  const loadAllVenues = async (preferredVenueId?: number) => {
    setLoading(true);
    try {
      const allItems: ConsoleVenueItem[] = [];
      let nextPage = 1;
      let totalPages = 1;
      do {
        const response = await getConsoleVenuePage("", nextPage, VENUE_PAGE_SIZE);
        allItems.push(...response.items);
        totalPages = response.total_pages ?? 1;
        nextPage += 1;
      } while (nextPage <= totalPages);

      const uniqueItems = [...new Map(allItems.map((item) => [item.venue_id, item])).values()]
        .sort((left, right) => left.venue_id - right.venue_id);
      setVenues(uniqueItems);

      const nextVenueId = preferredVenueId && uniqueItems.some((item) => item.venue_id === preferredVenueId)
        ? preferredVenueId
        : selectedVenueId && uniqueItems.some((item) => item.venue_id === selectedVenueId)
          ? selectedVenueId
          : uniqueItems[0]?.venue_id ?? null;
      setSelectedVenueId(nextVenueId);
      if (nextVenueId === null) {
        setDetail(null);
        setDetailLoadFailed(false);
      } else {
        setDetailLoadFailed(false);
        try {
          applyDetail(await getConsoleVenue(nextVenueId));
        } catch (error) {
          setDetail(null);
          setDetailLoadFailed(true);
          onMessage(`加载 Venue 详情失败：${errorMessage(error)}`);
        }
      }
    } catch (error) {
      onMessage(`加载 Venue 列表失败：${errorMessage(error)}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAllVenues();
  }, []);

  const refreshAfterMutation = async (venueId: number) => {
    await loadAllVenues(venueId);
    await onVenuesChanged();
  };

  const submitCreate = async () => {
    setSubmitting(true);
    try {
      const response = await createConsoleVenue(createName.trim(), auth.csrfToken ?? "", createKind);
      setConfirmationKind(null);
      setCreating(false);
      setCreateName("");
      setCreateKind("physical");
      await refreshAfterMutation(response.item.venue_id);
      onMessage(`已新增 Venue #${response.item.venue_id} 并建立首个名称版本`);
    } catch (error) {
      onMessage(`新增 Venue 失败：${errorMessage(error)}`);
    } finally {
      setSubmitting(false);
    }
  };

  const submitKind = async () => {
    if (!detail) return;
    setSubmitting(true);
    try {
      await updateConsoleVenueKind(detail.venue_id, kindDraft, auth.csrfToken ?? "");
      setConfirmationKind(null);
      await refreshAfterMutation(detail.venue_id);
      onMessage("Venue 类型已更新");
    } catch (error) {
      onMessage(`更新 Venue 类型失败：${errorMessage(error)}`);
    } finally {
      setSubmitting(false);
    }
  };

  const submitRename = async () => {
    if (!detail) return;
    setSubmitting(true);
    try {
      await createConsoleVenueNameVersion(
        detail.venue_id,
        renameName.trim(),
        renameDate,
        auth.csrfToken ?? "",
      );
      setConfirmationKind(null);
      setRenameName("");
      setRenameDate("");
      await refreshAfterMutation(detail.venue_id);
      onMessage("正式更名已记录；既有 Live 仍保留原名称版本");
    } catch (error) {
      onMessage(`记录正式更名失败：${errorMessage(error)}`);
    } finally {
      setSubmitting(false);
    }
  };

  const submitCorrection = async () => {
    if (!detail || correctionVersionId === null) return;
    setSubmitting(true);
    try {
      await updateConsoleVenueNameVersion(
        detail.venue_id,
        correctionVersionId,
        correctionName.trim(),
        auth.csrfToken ?? "",
      );
      setConfirmationKind(null);
      await refreshAfterMutation(detail.venue_id);
      onMessage("名称资料修正已应用到引用该版本的 Live");
    } catch (error) {
      onMessage(`修正名称失败：${errorMessage(error)}`);
    } finally {
      setSubmitting(false);
    }
  };

  const currentVersion = detail?.name_versions.find((version) => version.is_current) ?? null;
  const correctionVersion = detail?.name_versions.find(
    (version) => version.venue_name_version_id === correctionVersionId,
  ) ?? null;

  const confirmation: VenueConfirmation | null = confirmationKind === "create"
    ? {
        title: "确认新增 Venue",
        ariaLabel: "新增 Venue 确认",
        rows: [["名称", createName.trim()], ["类型", KIND_LABELS[createKind]]],
        confirmLabel: "确认新增",
        submit: submitCreate,
      }
    : confirmationKind === "kind" && detail
      ? {
          title: "确认修改场地类型",
          ariaLabel: "场地类型变化确认",
          rows: [["Venue", `#${detail.venue_id} ${detail.venue_name}`], ["原类型", KIND_LABELS[detail.venue_kind]], ["新类型", KIND_LABELS[kindDraft]]],
          confirmLabel: "确认修改",
          submit: submitKind,
        }
      : confirmationKind === "rename" && detail && currentVersion
        ? {
            title: "确认追加正式名称版本",
            ariaLabel: "正式名称版本变化确认",
            rows: [
              ["Venue", `#${detail.venue_id}`],
              ["原名称", currentVersion.venue_name],
              ["原版本有效期", `${dateText(currentVersion.valid_from, "起始未记录")} → ${renameDate}`],
              ["新名称", renameName.trim()],
              ["新版本有效期", `${renameDate} → 开放`],
            ],
            confirmLabel: "确认追加",
            submit: submitRename,
          }
        : confirmationKind === "correction" && detail && correctionVersion
          ? {
              title: "确认修正名称资料",
              ariaLabel: "名称资料修正确认",
              rows: [
                ["名称版本", `#${correctionVersion.venue_name_version_id}`],
                ["修正前", correctionVersion.venue_name],
                ["修正后", correctionName.trim()],
                ["影响 Live", String(correctionVersion.live_count)],
                ["影响改期历史", String(correctionVersion.schedule_history_count)],
              ],
              confirmLabel: "确认修正",
              submit: submitCorrection,
            }
          : null;

  return (
    <section className="tour-admin-section" aria-label="Venue 管理">
      <div className="tour-admin-toolbar">
        <label htmlFor="venue-admin-select">已有 Venue</label>
        <select
          id="venue-admin-select"
          className="console-entity-select"
          value={selectedVenueId ?? ""}
          disabled={loading || venues.length === 0}
          onChange={(event) => void loadDetail(Number(event.target.value))}
        >
          {venues.length === 0 && <option value="">暂无 Venue</option>}
          {venues.map((venue) => (
            <option key={venue.venue_id} value={venue.venue_id}>#{venue.venue_id} {venue.venue_name}</option>
          ))}
        </select>
        <button type="button" className="console-ghost-btn" disabled={submitting} onClick={() => setCreating((value) => !value)}>
          {creating ? "收起新增" : "新增 Venue"}
        </button>
      </div>

      {venues.length === 0 && !loading && (
        <p className="console-admin-hint">
          暂无可管理的 Venue。<button type="button" className="console-ghost-btn" onClick={() => void loadAllVenues()}>重新加载</button>
        </p>
      )}

      {detailLoadFailed && selectedVenueId !== null && !loading && (
        <p className="console-admin-hint">
          当前 Venue 详情加载失败。<button type="button" className="console-ghost-btn" onClick={() => void loadDetail(selectedVenueId)}>重试详情</button>
        </p>
      )}

      {creating && (
        <div className="tour-admin-block">
          <h3>新增 Venue</h3>
          <div className="tour-admin-fields">
            <label>名称<input value={createName} onChange={(event) => setCreateName(event.target.value)} /></label>
            <label>类型<select value={createKind} onChange={(event) => setCreateKind(event.target.value as ConsoleVenueDetail["venue_kind"])}>
              {Object.entries(KIND_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></label>
          </div>
          <p className="console-admin-hint">服务端将在一个事务中建立稳定 Venue 和首个开放名称版本。</p>
          <div className="console-submit-row">
            <button type="button" className="console-submit-btn" disabled={submitting || !createName.trim()} onClick={() => setConfirmationKind("create")}>检查新增资料</button>
          </div>
        </div>
      )}

      {detail && (
        <>
          <div className="tour-admin-block">
            <h3>历史名称（只读）</h3>
            <div className="console-table-wrap">
              <table className="console-admin-table entity-history-table" aria-label="Venue 历史名称">
                <thead><tr><th>ID</th><th>名称</th><th>有效期</th><th>引用 Live</th><th>改期历史</th></tr></thead>
                <tbody>{detail.name_versions.map((version) => (
                  <tr key={version.venue_name_version_id}>
                    <td>{version.venue_name_version_id}</td>
                    <td>{version.venue_name}</td>
                    <td>{dateText(version.valid_from, "起始未记录")} → {dateText(version.valid_to, "开放")}</td>
                    <td>{version.live_count}</td>
                    <td>{version.schedule_history_count}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>

          <div className="tour-admin-block">
            <h3>当前场地资料</h3>
            <p className="console-admin-hint">#{detail.venue_id} {detail.venue_name}；共引用 {detail.live_count} 场 Live。</p>
            <div className="tour-admin-fields">
              <label>类型<select value={kindDraft} onChange={(event) => setKindDraft(event.target.value as ConsoleVenueDetail["venue_kind"])}>
                {Object.entries(KIND_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select></label>
            </div>
            <div className="console-submit-row">
              <button type="button" className="console-submit-btn" disabled={submitting || kindDraft === detail.venue_kind} onClick={() => setConfirmationKind("kind")}>检查场地类型变化</button>
            </div>
          </div>

          <div className="tour-admin-block">
            <h3>追加正式名称版本</h3>
            <p className="console-admin-hint">当前名称为“{currentVersion?.venue_name ?? detail.venue_name}”。提交后关闭当前版本并建立唯一后继，不改写旧 Live。</p>
            <div className="tour-admin-fields">
              <label>新名称<input value={renameName} onChange={(event) => setRenameName(event.target.value)} /></label>
              <label>生效日期<ConsoleDateInput value={renameDate} onChange={(event) => setRenameDate(event.target.value)} /></label>
            </div>
            <div className="console-submit-row">
              <button type="button" className="console-submit-btn" disabled={submitting || !renameName.trim() || !isIsoCalendarDate(renameDate) || currentVersion === null} onClick={() => setConfirmationKind("rename")}>检查名称版本变化</button>
            </div>
          </div>

          <div className="tour-admin-block">
            <h3>名称资料修正</h3>
            <p className="console-admin-hint">仅修正同一名称版本的文本；引用该版本的 Live 和改期历史会同步显示修正结果。</p>
            <div className="tour-admin-fields">
              <label>名称版本<select value={correctionVersionId ?? ""} onChange={(event) => {
                const versionId = Number(event.target.value);
                const version = detail.name_versions.find((item) => item.venue_name_version_id === versionId);
                setCorrectionVersionId(versionId);
                setCorrectionName(version?.venue_name ?? "");
              }}>
                {detail.name_versions.map((version) => (
                  <option key={version.venue_name_version_id} value={version.venue_name_version_id}>#{version.venue_name_version_id} {version.venue_name}</option>
                ))}
              </select></label>
              <label>正确名称<input value={correctionName} onChange={(event) => setCorrectionName(event.target.value)} /></label>
            </div>
            <div className="console-submit-row">
              <button type="button" className="console-submit-btn" disabled={submitting || correctionVersion === null || !correctionName.trim() || correctionName.trim() === correctionVersion.venue_name} onClick={() => setConfirmationKind("correction")}>检查资料修正</button>
            </div>
          </div>
        </>
      )}

      {confirmation && (
        <div className="modal-mask" onClick={() => !submitting && setConfirmationKind(null)}>
          <div className="modal console-confirm-modal compact" role="dialog" aria-modal="true" aria-labelledby="venue-admin-confirm-title" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head"><h2 id="venue-admin-confirm-title">{confirmation.title}</h2></div>
            <div className="console-confirm-body">
              <CompactConfirmationTable ariaLabel={confirmation.ariaLabel} rows={confirmation.rows} />
            </div>
            <div className="console-confirm-actions">
              <button type="button" className="console-ghost-btn" disabled={submitting} onClick={() => setConfirmationKind(null)}>取消</button>
              <button type="button" className="console-submit-btn" disabled={submitting} onClick={() => void confirmation.submit()}>{confirmation.confirmLabel}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
