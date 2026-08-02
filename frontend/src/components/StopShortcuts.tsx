export type StopShortcutItem = {
  liveId: number;
  title: string;
  fullTitle?: string;
  cancelled: boolean;
  canOpen: boolean;
  selected: boolean;
  onSelect: () => void;
};

type StopShortcutsProps = {
  label: string;
  items: StopShortcutItem[];
};

export function StopShortcuts({ label, items }: StopShortcutsProps) {
  return (
    <nav className="tour-stop-shortcuts" aria-label={label}>
      {items.map((item) => (
        <span
          key={item.liveId}
          className={`tour-stop-shortcut-item${item.cancelled ? " is-cancelled" : ""}`}
        >
          {item.canOpen ? (
            <button
              type="button"
              className="tour-stop-shortcut"
              title={item.fullTitle}
              aria-pressed={item.selected}
              onClick={item.onSelect}
            >
              {item.title}
            </button>
          ) : (
            <span className="tour-stop-shortcut cancelled-static-title" title={item.fullTitle}>
              {item.title}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}
