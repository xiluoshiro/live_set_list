import type { ReactNode } from "react";

type CompactConfirmationTableProps = {
  rows: ReadonlyArray<readonly [label: string, value: ReactNode]>;
  ariaLabel?: string;
};

export function CompactConfirmationTable({
  rows,
  ariaLabel,
}: CompactConfirmationTableProps) {
  return (
    <div className="console-confirm-table-wrap">
      <table
        className="console-admin-table console-confirm-table"
        aria-label={ariaLabel}
      >
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label}>
              <th>{label}</th>
              <td>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
