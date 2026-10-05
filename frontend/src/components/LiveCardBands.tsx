import { getBandIconSrc, type BandIconInput } from "./BandIconsCell";

type NamedBand = { band_id: number; band_name: string };

export function LiveCardBands({ icons, bands = [], names }: {
  icons: BandIconInput[]; bands?: NamedBand[]; names?: Record<number, string>;
}) {
  const ids = [...new Set(icons)];
  const iconsOnly = ids.length > 2;
  return (
    <div className="live-card-performers" aria-label="出演">
      {ids.map(id => {
        const name = names?.[Number(id)] ?? bands.find(band => band.band_id === Number(id))?.band_name ?? `乐队 ${id}`;
        const src = getBandIconSrc(id);
        return <span key={id} className={`live-card-band${iconsOnly ? " is-icon-only" : ""}`} title={name}>
          {src ? <img src={src} alt={iconsOnly ? name : ""} width={20} height={20} loading="lazy" />
            : iconsOnly ? <span role="img" aria-label={name}>{name.slice(0, 2)}</span> : null}
          {!iconsOnly && <span>{name}</span>}
        </span>;
      })}
    </div>
  );
}
