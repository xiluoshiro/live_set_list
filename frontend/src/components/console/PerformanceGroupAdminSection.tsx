import { useEffect, useMemo, useState } from "react";

import {
  createConsolePerformanceGroup,
  getConsolePerformanceGroup,
  getConsolePerformanceGroups,
  getConsolePerformanceGroupLiveCandidates,
  updateConsolePerformanceGroup,
  type ConsolePerformanceGroupLiveCandidate,
  type ConsolePerformanceGroupMutationResponse,
  type ConsolePerformanceGroupUpsertPayload,
} from "../../api";
import { getGroupedLiveShortTitle } from "../performanceGroupHelpers";
import { UpdateDiffTable, type UpdateChange } from "./UpdateDiffTable";

type DraftStop = {
  live_id: number;
  live_date: string;
  live_title: string;
  start_time: string;
  venue: string | null;
};

type EditableGroup = {
  group_id: number;
  group_title: string;
};

type PerformanceGroupAdminSectionProps = {
  csrfToken: string;
  onMessage: (message: string) => void;
  onGroupDataChanged?: () => void;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatStartTime(startTime: string): string {
  return startTime.slice(0, 5);
}

function sortStops(stops: DraftStop[]): DraftStop[] {
  return [...stops].sort(
    (left, right) =>
      left.live_date.localeCompare(right.live_date) ||
      left.start_time.localeCompare(right.start_time) ||
      left.live_id - right.live_id,
  );
}

function candidateToDraft(
  candidate: ConsolePerformanceGroupLiveCandidate,
): DraftStop {
  return {
    live_id: candidate.live_id,
    live_date: candidate.live_date,
    live_title: candidate.live_title,
    start_time: candidate.start_time,
    venue: candidate.venue,
  };
}

function formatGroupStop(stop: DraftStop): string {
  return `${stop.live_id} · ${stop.live_date} · ${stop.live_title}`;
}

function buildGroupUpdateChanges(
  originalPayload: ConsolePerformanceGroupUpsertPayload | null,
  currentPayload: ConsolePerformanceGroupUpsertPayload,
  originalStops: DraftStop[],
  currentStops: DraftStop[],
): UpdateChange[] {
  if (originalPayload === null) return [];
  const changes: UpdateChange[] = [];
  if (originalPayload.group_title !== currentPayload.group_title) {
    changes.push({
      field: "group_title",
      before: originalPayload.group_title,
      after: currentPayload.group_title,
    });
  }
  const originalIds = new Set(originalPayload.live_ids);
  const currentIds = new Set(currentPayload.live_ids);
  const originalDetails = new Map(originalStops.map((stop) => [stop.live_id, stop]));
  const currentDetails = new Map(currentStops.map((stop) => [stop.live_id, stop]));
  for (const liveId of [...new Set([...originalIds, ...currentIds])].sort((a, b) => a - b)) {
    if (originalIds.has(liveId) === currentIds.has(liveId)) continue;
    changes.push({
      field: `live_ids[live_id=${liveId}]`,
      before: originalIds.has(liveId)
        ? formatGroupStop(originalDetails.get(liveId) as DraftStop)
        : "-",
      after: currentIds.has(liveId)
        ? formatGroupStop(currentDetails.get(liveId) as DraftStop)
        : "-",
    });
  }
  return changes;
}

export function PerformanceGroupAdminSection({
  csrfToken,
  onMessage,
  onGroupDataChanged,
}: PerformanceGroupAdminSectionProps) {
  const [groups, setGroups] = useState<EditableGroup[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [isNew, setIsNew] = useState(true);
  const [groupTitle, setGroupTitle] = useState("");
  const [stops, setStops] = useState<DraftStop[]>([]);
  const [originalPayload, setOriginalPayload] =
    useState<ConsolePerformanceGroupUpsertPayload | null>(null);
  const [originalStops, setOriginalStops] = useState<DraftStop[]>([]);
  const [candidateQuery, setCandidateQuery] = useState("");
  const [candidatePage, setCandidatePage] = useState(1);
  const [candidateTotalPages, setCandidateTotalPages] = useState(1);
  const [candidates, setCandidates] = useState<
    ConsolePerformanceGroupLiveCandidate[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [insertedGroups, setInsertedGroups] = useState<
    ConsolePerformanceGroupMutationResponse["item"][]
  >([]);

  const resetForm = () => {
    setSelectedGroupId(null);
    setIsNew(true);
    setGroupTitle("");
    setStops([]);
    setOriginalPayload(null);
    setOriginalStops([]);
    setCandidateQuery("");
    setCandidatePage(1);
    setCandidateTotalPages(1);
    setCandidates([]);
  };

  const loadGroupList = async () => {
    try {
      const response = await getConsolePerformanceGroups();
      setGroups(response.items);
    } catch (error) {
      onMessage(`加载活动组列表失败：${errorMessage(error)}`);
    }
  };

  useEffect(() => {
    void loadGroupList();
  }, []);

  useEffect(() => {
    let canceled = false;
    setCandidateLoading(true);
    getConsolePerformanceGroupLiveCandidates(candidateQuery, candidatePage, 20)
      .then((response) => {
        if (canceled) return;
        setCandidates(response.items);
        setCandidatePage(response.page);
        setCandidateTotalPages(response.total_pages);
      })
      .catch((error) => {
        if (!canceled) onMessage(`加载 Live 候选失败：${errorMessage(error)}`);
      })
      .finally(() => {
        if (!canceled) setCandidateLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [candidatePage]);

  const loadSelectedGroup = async (groupId: number) => {
    setLoading(true);
    try {
      const detail = await getConsolePerformanceGroup(groupId);
      setSelectedGroupId(groupId);
      setIsNew(false);
      setGroupTitle(detail.group_title);
      const loadedStops = sortStops(
        detail.lives.map((stop) => ({
            live_id: stop.live_id,
            live_date: stop.live_date,
            live_title: stop.live_title,
            start_time: stop.start_time,
            venue: stop.venue,
          })),
      );
      setStops(loadedStops);
      setOriginalStops(loadedStops.map((stop) => ({ ...stop })));
      setOriginalPayload({
        group_title: detail.group_title,
        live_ids: loadedStops.map((stop) => stop.live_id),
      });
    } catch (error) {
      onMessage(`加载活动组详情失败：${errorMessage(error)}`);
    } finally {
      setLoading(false);
    }
  };

  const queryCandidates = async (query = candidateQuery) => {
    setCandidateLoading(true);
    setCandidatePage(1);
    try {
      const response = await getConsolePerformanceGroupLiveCandidates(
        query,
        1,
        20,
      );
      setCandidates(response.items);
      setCandidateTotalPages(response.total_pages);
    } catch (error) {
      onMessage(`查询 Live 候选失败：${errorMessage(error)}`);
    } finally {
      setCandidateLoading(false);
    }
  };

  const addCandidate = (candidate: ConsolePerformanceGroupLiveCandidate) => {
    if (stops.some((stop) => stop.live_id === candidate.live_id)) return;
    setStops((current) => sortStops([...current, candidateToDraft(candidate)]));
  };

  const addAllFilteredCandidates = async () => {
    setCandidateLoading(true);
    try {
      const response = await getConsolePerformanceGroupLiveCandidates(
        candidateQuery,
        1,
        500,
      );
      if (response.total > 500) {
        onMessage("筛选结果超过 500 场，请缩小查询范围后再一键添加。");
        return;
      }
      const existingIds = new Set(stops.map((stop) => stop.live_id));
      const eligible = response.items.filter(
        (candidate) => !existingIds.has(candidate.live_id),
      );
      const skippedCount = response.items.length - eligible.length;
      setStops((current) =>
        sortStops([...current, ...eligible.map(candidateToDraft)]),
      );
      onMessage(
        `已添加 ${eligible.length} 场${skippedCount > 0 ? `，跳过 ${skippedCount} 场已选 Live` : ""}。`,
      );
    } catch (error) {
      onMessage(`一键添加失败：${errorMessage(error)}`);
    } finally {
      setCandidateLoading(false);
    }
  };

  const sortedStops = useMemo(() => sortStops(stops), [stops]);

  const payload = useMemo<ConsolePerformanceGroupUpsertPayload>(
    () => ({
      group_title: groupTitle.trim(),
      live_ids: sortedStops.map((stop) => stop.live_id),
    }),
    [groupTitle, sortedStops],
  );

  const canSubmit =
    payload.group_title !== "" && payload.live_ids.length >= 2;
  const updateChanges = useMemo(
    () => buildGroupUpdateChanges(
      originalPayload,
      payload,
      originalStops,
      sortedStops,
    ),
    [originalPayload, originalStops, payload, sortedStops],
  );

  const submit = async () => {
    if (!csrfToken || !canSubmit) return;
    setSubmitting(true);
    try {
      const wasNew = isNew;
      const response = wasNew
        ? await createConsolePerformanceGroup(payload, csrfToken)
        : await updateConsolePerformanceGroup(
            selectedGroupId as number,
            payload,
            csrfToken,
          );
      setConfirming(false);
      if (wasNew) {
        setInsertedGroups((current) => [response.item, ...current]);
      }
      resetForm();
      await Promise.all([loadGroupList(), queryCandidates("")]);
      onMessage(
        `${wasNew ? "创建" : "更新"}活动组成功：#${response.item.group_id} ${response.item.group_title}`,
      );
      onGroupDataChanged?.();
    } catch (error) {
      setConfirming(false);
      onMessage(`保存活动组失败：${errorMessage(error)}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="tour-admin-section" aria-label="活动组管理">
      <div className="tour-admin-toolbar">
        <label htmlFor="pg-admin-select">已有活动组</label>
        <select
          id="pg-admin-select"
          className="console-entity-select"
          value={selectedGroupId ?? ""}
          onChange={(event) => {
            const groupId = Number(event.target.value);
            if (groupId > 0) void loadSelectedGroup(groupId);
          }}
          disabled={loading || groups.length === 0}
        >
          <option value="">- 新建活动组 -</option>
          {groups.map((group) => (
            <option key={group.group_id} value={group.group_id}>
              #{group.group_id} {group.group_title}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="console-submit-btn"
          onClick={() => {
            resetForm();
            void queryCandidates("");
          }}
        >
          新建活动组
        </button>
      </div>

      <div className="tour-admin-fields">
        <label>
          活动组名称
          <input
            value={groupTitle}
            maxLength={255}
            onChange={(event) => setGroupTitle(event.target.value)}
          />
        </label>
      </div>

      <div className="tour-admin-block">
        <h3>搜索并添加场次</h3>
        <div className="tour-candidate-search">
          <input
            value={candidateQuery}
            placeholder="输入 Live ID 或标题"
            onChange={(event) => setCandidateQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void queryCandidates();
            }}
          />
          <button
            type="button"
            className="console-ghost-btn"
            onClick={() => void queryCandidates()}
          >
            查询
          </button>
          <button
            type="button"
            className="console-ghost-btn"
            disabled={candidateLoading}
            onClick={() => void addAllFilteredCandidates()}
          >
            一键添加筛选结果
          </button>
        </div>
        <div className="console-table-wrap">
          <table className="console-admin-table tour-candidate-table">
            <colgroup>
              <col className="tour-candidate-col-date" />
              <col className="tour-candidate-col-time" />
              <col className="tour-candidate-col-live" />
              <col className="tour-candidate-col-venue" />
              <col className="tour-candidate-col-action" />
            </colgroup>
            <thead>
              <tr>
                <th>日期</th>
                <th>开演</th>
                <th>Live</th>
                <th>场地</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((candidate) => {
                const alreadyAdded = stops.some(
                  (stop) => stop.live_id === candidate.live_id,
                );
                return (
                  <tr key={candidate.live_id}>
                    <td>{candidate.live_date}</td>
                    <td>{formatStartTime(candidate.start_time)}</td>
                    <td>
                      #{candidate.live_id} {candidate.live_title}
                    </td>
                    <td>{candidate.venue ?? "-"}</td>
                    <td>
                      <button
                        type="button"
                        className="console-submit-btn"
                        disabled={alreadyAdded}
                        onClick={() => addCandidate(candidate)}
                      >
                        {alreadyAdded ? "已添加" : "添加"}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {!candidateLoading && candidates.length === 0 && (
                <tr>
                  <td colSpan={5}>没有符合条件的 Live</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="tour-candidate-pager">
          <button
            type="button"
            className="console-ghost-btn"
            onClick={() =>
              setCandidatePage((page) => Math.max(1, page - 1))
            }
            disabled={candidateLoading || candidatePage <= 1}
          >
            上一页
          </button>
          <span>
            第 {candidatePage} / {candidateTotalPages} 页
          </span>
          <button
            type="button"
            className="console-ghost-btn"
            onClick={() =>
              setCandidatePage((page) =>
                Math.min(candidateTotalPages, page + 1),
              )
            }
            disabled={
              candidateLoading || candidatePage >= candidateTotalPages
            }
          >
            下一页
          </button>
        </div>
      </div>

      <div className="tour-admin-block">
        <h3>已选场次（{sortedStops.length}）</h3>
        <div className="console-table-wrap">
          <table
            className="console-admin-table tour-stop-table"
            aria-label="已选场次"
          >
            <thead>
              <tr>
                <th>日期</th>
                <th>开演</th>
                <th>Live</th>
                <th>场地</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {sortedStops.map((stop) => (
                <tr key={stop.live_id}>
                  <td>{stop.live_date}</td>
                  <td>{formatStartTime(stop.start_time)}</td>
                  <td>
                    #{stop.live_id} {stop.live_title}
                  </td>
                  <td>{stop.venue ?? "-"}</td>
                  <td>
                    <button
                      type="button"
                      className="console-ghost-btn"
                      onClick={() =>
                        setStops((current) =>
                          current.filter(
                            (item) => item.live_id !== stop.live_id,
                          ),
                        )
                      }
                    >
                      移除
                    </button>
                  </td>
                </tr>
              ))}
              {sortedStops.length === 0 && (
                <tr>
                  <td colSpan={5}>至少添加两场 Live 后才能保存活动组。</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="console-submit-row">
        <button
          type="button"
          className="console-ghost-btn"
          onClick={() => {
            resetForm();
            void queryCandidates("");
          }}
        >
          清空
        </button>
        <button
          type="button"
          className="console-submit-btn"
          disabled={!canSubmit || loading}
          onClick={() => setConfirming(true)}
        >
          {isNew ? "新建" : "更新"}
        </button>
      </div>

      {confirming && (
        <div
          className="modal-mask"
          onClick={() => !submitting && setConfirming(false)}
        >
          <div
            className="modal console-confirm-modal compact tour"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pg-confirm-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <h2 id="pg-confirm-title">
                确认{isNew ? "创建" : "更新"}活动组
              </h2>
              <div className="modal-actions">
                <button
                  type="button"
                  className="modal-action-btn close"
                  aria-label="关闭"
                  disabled={submitting}
                  onClick={() => setConfirming(false)}
                >
                  <span className="modal-action-glyph close">✕</span>
                </button>
              </div>
            </div>
            <div className="console-confirm-body">
              {isNew ? (
                <>
                  <div className="console-confirm-table-wrap">
                    <table className="console-admin-table console-confirm-table">
                      <tbody>
                        <tr>
                          <th>group_title</th>
                          <td>{payload.group_title}</td>
                        </tr>
                        <tr>
                          <th>live_count</th>
                          <td>{sortedStops.length}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <div className="console-table-wrap console-confirm-setlist-wrap">
                    <table
                      className="console-admin-table console-confirm-setlist-table"
                      aria-label="确认场次"
                    >
                      <thead>
                        <tr>
                          <th>live_date</th>
                          <th>live_id</th>
                          <th>short_title</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedStops.map((stop) => (
                          <tr key={stop.live_id}>
                            <td>{stop.live_date}</td>
                            <td>{stop.live_id}</td>
                            <td>
                              {getGroupedLiveShortTitle(
                                stop.live_title,
                                payload.group_title,
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <UpdateDiffTable changes={updateChanges} ariaLabel="活动组修改内容" />
              )}
            </div>
            <div className="console-confirm-actions">
              <button
                type="button"
                className="console-ghost-btn"
                disabled={submitting}
                onClick={() => setConfirming(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="console-submit-btn"
                disabled={submitting}
                onClick={() => void submit()}
              >
                {submitting ? "提交中..." : "确认提交"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="console-table-wrap live-history-wrap">
        <table
          className="console-admin-table live-history-table tour-history-table"
          aria-label="新增活动组记录"
        >
          <thead>
            <tr>
              <th>group_id</th>
              <th>group_title</th>
              <th>live_count</th>
            </tr>
          </thead>
          <tbody>
            {insertedGroups.length === 0 ? (
              <tr>
                <td colSpan={3} className="empty-cell">
                  暂无新增活动组记录
                </td>
              </tr>
            ) : (
              insertedGroups.map((group) => (
                <tr key={group.group_id}>
                  <td>{group.group_id}</td>
                  <td>{group.group_title}</td>
                  <td>{group.live_count}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
