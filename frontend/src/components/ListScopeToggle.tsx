type ListScope = "all" | "favorites";

export function ListScopeToggle({ value, label, onChange }: {
  value: ListScope;
  label: string;
  onChange: (value: ListScope) => void;
}) {
  return (
    <div className="list-scope-toggle" role="group" aria-label={label}>
      <button type="button" className={value === "all" ? "active" : ""}
        aria-pressed={value === "all"} onClick={() => onChange("all")}>全部</button>
      <button type="button" className={value === "favorites" ? "active" : ""}
        aria-pressed={value === "favorites"} onClick={() => onChange("favorites")}>仅收藏</button>
    </div>
  );
}
