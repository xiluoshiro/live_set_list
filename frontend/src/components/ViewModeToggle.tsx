type ViewMode = "cards" | "table";

type ViewModeToggleProps = {
  value: ViewMode;
  onChange: (value: ViewMode) => void;
};

export function ViewModeToggle({ value, onChange }: ViewModeToggleProps) {
  return (
    <div className="view-toggle" role="group" aria-label="视图模式">
      <button
        type="button"
        className={value === "cards" ? "active" : ""}
        aria-pressed={value === "cards"}
        onClick={() => onChange("cards")}
      >
        卡片
      </button>
      <button
        type="button"
        className={value === "table" ? "active" : ""}
        aria-pressed={value === "table"}
        onClick={() => onChange("table")}
      >
        表格
      </button>
    </div>
  );
}
