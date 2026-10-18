import type { ReactNode } from "react";
import { ConfirmationTables, type UpdateChange } from "./ConfirmationTables";

type CompactConfirmationTableProps = {
  rows?: ReadonlyArray<readonly [label: string, value: ReactNode]>;
  changes?: UpdateChange[];
  ariaLabel?: string;
};

export function CompactConfirmationTable({
  rows = [],
  changes,
  ariaLabel,
}: CompactConfirmationTableProps) {
  return (
    <>
      {rows.length > 0 && <div className="console-confirm-table-wrap">
        <table
          className="console-admin-table console-confirm-table"
          aria-label={ariaLabel}
        >
          <tbody>
            {rows.map(([label, value]) => (
              <tr key={label}>
                <th scope="row">{label}</th>
                <td>{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>}
      {changes && <ConfirmationTables changes={changes} ariaLabel={ariaLabel} />}
    </>
  );
}
