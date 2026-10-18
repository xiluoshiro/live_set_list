import { ConfirmationTables, type UpdateChange } from "./ConfirmationTables";
export type { UpdateChange } from "./ConfirmationTables";

type UpdateDiffTableProps = {
  changes: UpdateChange[];
  ariaLabel?: string;
};

export function UpdateDiffTable({
  changes,
  ariaLabel = "修改内容",
}: UpdateDiffTableProps) {
  return <ConfirmationTables changes={changes} ariaLabel={ariaLabel} updating />;
}
