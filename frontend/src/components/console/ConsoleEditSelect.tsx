type EditOption = { id: number; label: string };

// Queries select the first match; paging/refreshing keep the editor; small lists may prefer a matching selection.
export function resolveConsoleEditSelection<T>(
  items: readonly T[], getId: (item: T) => number, selectedId: number | null,
  policy: "query" | "preserve" | "prefer-match" = "query",
): number | null {
  if (policy === "preserve") return selectedId;
  if (policy === "prefer-match" && items.some(item => getId(item) === selectedId)) return selectedId;
  return items[0] ? getId(items[0]) : policy === "prefer-match" ? null : selectedId;
}

export function ConsoleEditSelect({ id, className, label, placeholder, options, value, selectedOption, disabled, onSelect }: {
  id?: string; className?: string; label: string; placeholder: string;
  options: EditOption[]; value: number | null; selectedOption?: EditOption;
  disabled?: boolean; onSelect: (id: number) => void;
}) {
  const selectedMissing = selectedOption && !options.some(option => option.id === selectedOption.id);
  return <select id={id} className={className} aria-label={label} value={value ?? ""} disabled={disabled}
    onChange={event => { const next = Number(event.target.value); if (next > 0) onSelect(next); }}>
    {value === null && <option value="">{placeholder}</option>}
    {selectedMissing && <option value={selectedOption.id}>{selectedOption.label}</option>}
    {options.map(option => <option key={option.id} value={option.id}>
      {selectedOption?.id === option.id ? selectedOption.label : option.label}
    </option>)}
  </select>;
}
