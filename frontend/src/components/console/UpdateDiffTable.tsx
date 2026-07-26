export type UpdateChange = {
  field: string;
  before: string;
  after: string;
};

type UpdateDiffTableProps = {
  changes: UpdateChange[];
  ariaLabel?: string;
};

export function UpdateDiffTable({
  changes,
  ariaLabel = "修改内容",
}: UpdateDiffTableProps) {
  return (
    <div className="console-confirm-table-wrap">
      <table
        className="console-admin-table console-confirm-table live-update-diff-table"
        aria-label={ariaLabel}
      >
        <thead>
          <tr>
            <th>字段</th>
            <th>原值</th>
            <th>新值</th>
          </tr>
        </thead>
        <tbody>
          {changes.map((change) => (
            <tr key={change.field}>
              <th>{change.field}</th>
              <td>{change.before}</td>
              <td>{change.after}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
