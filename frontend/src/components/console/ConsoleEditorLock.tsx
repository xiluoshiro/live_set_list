import type { ReactNode } from "react";

/** Native fieldset locking also protects controls added by future editors. Dialogs use a portal. */
export function ConsoleEditorLock({ locked, children }: { locked: boolean; children: ReactNode }) {
  return <fieldset className="console-editor-fields" disabled={locked}>{children}</fieldset>;
}
