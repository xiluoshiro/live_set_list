type SectionTabOption<T extends string> = { value: T; label: string };

type SectionTabsProps<T extends string> = {
  label: string;
  value: T;
  options: readonly SectionTabOption<T>[];
  onChange: (value: T) => void;
};

export function SectionTabs<T extends string>({ label, value, options, onChange }: SectionTabsProps<T>) {
  return (
    <div className="section-tabs" role="tablist" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          className={`section-tab-btn ${value === option.value ? "active" : ""}`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
