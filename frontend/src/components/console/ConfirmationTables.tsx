import { Fragment } from "react";

export type UpdateChange = {
  field: string;
  before: string;
  after: string;
  table?: { source: string; row: string; column: string; rowHeading?: string };
};

// Structured confirmation paths use brackets for record identity and dots for fields.
function tableCell(change: UpdateChange): UpdateChange["table"] {
  if (change.table) return change.table;
  const path = /^(.*)\[([^\]]+)\](?:\.(.*))?$/.exec(change.field);
  if (!path) return undefined;
  return {
    source: path[1].replace(/\[[^\]]+\]/g, ""),
    row: [...change.field.matchAll(/\[([^\]]+)\]/g)].map(match => match[1]).join(" / "),
    column: path[3] || "值",
  };
}

export function ConfirmationTables({ changes, ariaLabel, updating = false }: {
  changes: UpdateChange[]; ariaLabel?: string; updating?: boolean;
}) {
  const scalar: UpdateChange[] = [];
  const groups = new Map<string, { rowHeading: string; columns: string[]; rows: Map<string, Map<string, UpdateChange>> }>();
  for (const change of changes) {
    if (updating && change.before === change.after) continue;
    const cell = tableCell(change);
    if (!cell) { scalar.push(change); continue; }
    let group = groups.get(cell.source);
    if (!group) { group = { rowHeading: cell.rowHeading ?? "条目", columns: [], rows: new Map() }; groups.set(cell.source, group); }
    if (!group.columns.includes(cell.column)) group.columns.push(cell.column);
    let row = group.rows.get(cell.row);
    if (!row) { row = new Map(); group.rows.set(cell.row, row); }
    row.set(cell.column, change);
  }
  return <>
    {scalar.length > 0 && <div className="console-confirm-table-wrap">
      <table className={`console-admin-table console-confirm-table${updating ? " live-update-diff-table" : ""}`} aria-label={ariaLabel}>
        {updating && <thead><tr><th scope="col">字段</th><th scope="col">原值</th><th scope="col">新值</th></tr></thead>}
        <tbody>{scalar.map(change => <tr key={change.field}>
          <th scope="row">{change.field}</th>
          {updating && <td>{change.before}</td>}<td>{change.after}</td>
        </tr>)}</tbody>
      </table>
    </div>}
    {[...groups].map(([source, { rowHeading, columns, rows }]) => <div className="console-confirm-table-wrap" key={source}>
      <table className="console-admin-table console-confirm-table console-confirm-records-table" aria-label={ariaLabel ? `${ariaLabel} · ${source}` : source}>
        <caption>{source}</caption>
        <thead>
          {updating && columns.length === 1 && columns[0] === "值" ? (
            <tr><th scope="col">{rowHeading}</th><th scope="col">原值</th><th scope="col">新值</th></tr>
          ) : <><tr><th scope="col" rowSpan={updating ? 2 : 1}>{rowHeading}</th>{columns.map(column =>
            <th key={column} scope={updating ? "colgroup" : "col"} colSpan={updating ? 2 : 1}>{column}</th>)}</tr>
          {updating && <tr>{columns.map(column => <Fragment key={column}><th scope="col">原值</th><th scope="col">新值</th></Fragment>)}</tr>}</>}
        </thead>
        <tbody>{[...rows].map(([id, cells]) => <tr key={id}><th scope="row">{id}</th>{columns.map(column => {
          const change = cells.get(column);
          return updating ? <Fragment key={column}><td>{change?.before || "—"}</td><td>{change?.after || "—"}</td></Fragment>
            : <td key={column}>{change?.after || "—"}</td>;
        })}</tr>)}</tbody>
      </table>
    </div>)}
  </>;
}
