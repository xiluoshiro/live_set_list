import type { ReactNode } from "react";

/** Shared option row for the Console's band and ownership pickers. */
export function ConsoleCheckOption({ label, checked, onChange, children }: {
  label: ReactNode; checked: boolean; onChange: (checked: boolean) => void; children?: ReactNode;
}) {
  return <div className="band-member-block">
    <label className="band-member-main">
      <input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
    {children}
  </div>;
}
