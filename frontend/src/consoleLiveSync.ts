export const CONSOLE_LIVE_CHANGE_STORAGE_KEY = "live-set-list-console-live-change";

export type ConsoleLiveChangeAction = "created" | "updated" | "setlist_appended";

export type ConsoleLiveChange = {
  action: ConsoleLiveChangeAction;
  liveId: number;
  changedAt: string;
  nonce: string;
};

let eventSequence = 0;

export function publishConsoleLiveChange(action: ConsoleLiveChangeAction, liveId: number): void {
  if (typeof window === "undefined" || !Number.isInteger(liveId) || liveId < 1) return;
  try {
    eventSequence += 1;
    const event: ConsoleLiveChange = {
      action,
      liveId,
      changedAt: new Date().toISOString(),
      nonce: `${Date.now()}-${eventSequence}`,
    };
    window.localStorage.setItem(CONSOLE_LIVE_CHANGE_STORAGE_KEY, JSON.stringify(event));
  } catch {
    // 跨标签页通知不可用时仍由服务端冲突校验保证写入安全。
  }
}

export function parseConsoleLiveChange(raw: string | null): ConsoleLiveChange | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<ConsoleLiveChange>;
    if (
      !["created", "updated", "setlist_appended"].includes(value.action ?? "")
      || !Number.isInteger(value.liveId)
      || (value.liveId ?? 0) < 1
      || typeof value.changedAt !== "string"
      || typeof value.nonce !== "string"
    ) {
      return null;
    }
    return value as ConsoleLiveChange;
  } catch {
    return null;
  }
}
