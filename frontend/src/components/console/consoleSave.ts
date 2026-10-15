/** Call only after a committed write: a failed read must never turn success into a failed save. */
export async function refreshConsoleAfterSave(
  refreshers: Array<() => Promise<unknown>>, success: string, onMessage: (message: string) => void,
) {
  const results = await Promise.allSettled(refreshers.map(refresh => Promise.resolve().then(refresh)));
  onMessage(success + (results.some(result => result.status === "rejected")
    ? "；候选刷新失败，请重新查询，无需重复提交。" : ""));
}
