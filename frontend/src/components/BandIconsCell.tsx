type BandIconInput = number | string;

const BAND_ICON_COUNT = 12;
const BAND_ICON_SRC: Record<number, string> = Object.fromEntries(
  Array.from({ length: BAND_ICON_COUNT }, (_, i) => [i + 1, `/icons/Band_${i + 1}.svg`]),
) as Record<number, string>;

function normalizeBandCode(value: BandIconInput): number | null {
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= 1 && value <= BAND_ICON_COUNT ? value : null;
  }

  const text = value.trim();
  if (!text) return null;

  const pureNumber = Number(text);
  if (Number.isInteger(pureNumber) && pureNumber >= 1 && pureNumber <= BAND_ICON_COUNT) {
    return pureNumber;
  }

  const match = text.match(/band[_-]?(\d+)(?:\.svg)?$/i);
  if (!match) return null;

  const code = Number(match[1]);
  return Number.isInteger(code) && code >= 1 && code <= BAND_ICON_COUNT ? code : null;
}

function toBandIcon(value: BandIconInput): { code: number; src: string } | null {
  const code = normalizeBandCode(value);
  if (!code) return null;
  return { code, src: BAND_ICON_SRC[code] };
}

export function BandIconsCell({ icons, rowId }: { icons: BandIconInput[]; rowId: number }) {
  const bandIcons = icons
    .map((icon) => toBandIcon(icon))
    .filter((icon): icon is { code: number; src: string } => icon !== null);
  const hasOverflowHint = bandIcons.length > 5;

  return (
    <div className={`icons-cell-wrap ${hasOverflowHint ? "has-overflow" : "no-overflow"}`}>
      <div className="icons-cell">
        {bandIcons.map((icon, index) => (
          <img
            key={`${rowId}-${icon.code}-${index}`}
            src={icon.src}
            alt={`Band ${icon.code}`}
            className="icon-img"
            loading="lazy"
          />
        ))}
      </div>
      {hasOverflowHint && <span className="icons-overflow-hint">…</span>}
    </div>
  );
}

export { BAND_ICON_COUNT };
export type { BandIconInput };
