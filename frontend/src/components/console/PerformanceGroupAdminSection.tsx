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

export function PerformanceGroupAdminSection({
  csrfToken,
  onGroupDataChanged,
}: PerformanceGroupAdminSectionProps) {
  const [groups, setGroups] = useState<EditableGroup[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [isNew, setIsNew] = useState(true);
  const [groupTitle, setGroupTitle] = useState("");
  const [stops, setStops] = useState<DraftStop[]>([]);
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
  const [message, setMessage] = useState("");
  const [insertedGroups, setInsertedGroups] = useState<
    ConsolePerformanceGroupMutationResponse["item"][]
  >([]);

  const resetForm = () => {
    setSelectedGroupId(null);
    setIsNew(true);
    setGroupTitle("");
    setStops([]);
    setCandidateQuery("");
    setCandidatePage(1);
    setCandidateTotalPages(1);
    setCandidates([]);
    setMessage("");
  };

  const loadGroupList = async () => {
    try {
      const response = await getConsolePerformanceGroups();
      setGroups(response.items);
    } catch (error) {
      setMessage(`加载活动组列表失败：${errorMessage(error)}`);
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
        if (!canceled) setMessage(`加载 Live 候选失败：${errorMessage(error)}`);
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
    setMessage("");
    try {
      const detail = await getConsolePerformanceGroup(groupId);
      setSelectedGroupId(groupId);
      setIsNew(false);
      setGroupTitle(detail.group_title);
      setStops(
        sortStops(
          detail.lives.map((stop) => ({
            live_id: stop.live_id,
            live_date: stop.live_date,
            live_title: stop.live_title,
            start_time: stop.start_time,
            venue: stop.venue,
          })),
        ),
      );
    } catch (error) {
      setMessage(`加载活动组详情失败：${errorMessage(error)}`);
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
      setMessage(`查询 Live 候选失败：${errorMessage(error)}`);
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
    setMessage("");
    try {
      const response = await getConsolePerformanceGroupLiveCandidates(
        candidateQuery,
        1,
        500,
      );
      if (response.total > 500) {
        setMessage("筛选结果超过 500 场，请缩小查询范围后再一键添加。");
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
      setMessage(
        `已添加 ${eligible.length} 场${skippedCount > 0 ? `，跳过 ${skippedCount} 场已选 Live` : ""}。`,
      );
    } catch (error) {
      setMessage(`一键添加失败：${errorMessage(error)}`);
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

  const submit = async () => {
    if (!csrfToken || !canSubmit) return;
    setSubmitting(true);
    setMessage("");
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
      setMessage(
        `${wasNew ? "创建" : "更新"}活动组成功：#${response.item.group_id} ${response.item.group_title}`,
      );
      onGroupDataChanged?.();
    } catch (error) {
      setConfirming(false);
      setMessage(`保存活动组失败：${errorMessage(error)}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="tour-admin-section" aria-label="活动组管理">
      {message && (
        <p className="console-admin-hint" role="status">
          {message}
        </p>
      )}
      <div className="tour-admin-toolbar">
        <label htmlFor="pg-admin-select">已有活动组</label>
        <select
          id="pg-admin-select"
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
          className="console-ghost-btn"
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
