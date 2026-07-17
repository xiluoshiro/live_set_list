type BandIconInput = number | string;

const BAND_ICON_COUNT = 12;
const BAND_REPRESENTATIVE_COLORS: Record<number, string> = {
  1: "#ff3377",
  2: "#e83848",
  3: "#33ddaa",
  4: "#3344aa",
  5: "#f4b600",
  6: "#22cccc",
  7: "#2dc1f7",
  8: "#3388bb",
  9: "#881144",
  10: "#ec7384",
  11: "#aa22ee",
  12: "#ffaa33",
};

const BAND_VISUALS: Record<number, { src: string; color: string }> = Object.fromEntries(
  Array.from({ length: BAND_ICON_COUNT }, (_, i) => {
    const code = i + 1;
    return [code, { src: `/icons/Band_${code}.svg`, color: BAND_REPRESENTATIVE_COLORS[code] }];
  }),
) as Record<number, { src: string; color: string }>;

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

function toBandIcon(value: BandIconInput): { code: number; src: string; color: string } | null {
  const code = normalizeBandCode(value);
  if (!code) return null;
  return { code, ...BAND_VISUALS[code] };
}

export function getBandIconSrc(value: BandIconInput): string | null {
  return toBandIcon(value)?.src ?? null;
}

export function getBandRepresentativeColor(value: BandIconInput): string | null {
  return toBandIcon(value)?.color ?? null;
}

export function BandIconsCell({ icons, rowId }: { icons: BandIconInput[]; rowId: number }) {
  const bandIcons = icons
    .map((icon) => toBandIcon(icon))
    .filter((icon): icon is { code: number; src: string; color: string } => icon !== null);
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
