import { useEffect, useState } from "react";

import { getVenueMaps, type PublicVenueMapLink } from "../api";
import { logError } from "../logger";
import { DropdownMenu } from "./ui/DropdownMenu";

const PROVIDER_LABELS: Record<PublicVenueMapLink["provider"], string> = {
  google: "Google Maps",
  apple: "Apple Maps",
  amap: "高德地图",
};

type VenueMapMenuProps = {
  venueId: number;
  venueName: string;
  links?: PublicVenueMapLink[];
  triggerLabel?: string;
  triggerClassName?: string;
};

export function VenueMapMenu({
  venueId,
  venueName,
  links: initialLinks,
  triggerLabel = "地图",
  triggerClassName = "stage-map-trigger",
}: VenueMapMenuProps) {
  const [links, setLinks] = useState<PublicVenueMapLink[] | null>(initialLinks ?? null);

  useEffect(() => {
    setLinks(initialLinks ?? null);
    if (initialLinks !== undefined) return undefined;
    let canceled = false;
    getVenueMaps(venueId)
      .then((response) => { if (!canceled) setLinks(response.map_links); })
      .catch((caught) => {
        if (canceled) return;
        setLinks([]);
        logError("load_venue_maps_failed", {
          venueId,
          message: caught instanceof Error ? caught.message : String(caught),
        });
      });
    return () => { canceled = true; };
  }, [initialLinks, venueId]);

  if (!links?.length) return triggerLabel === "地图" ? null : <span>{triggerLabel}</span>;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button type="button" className={triggerClassName} aria-label={`选择${venueName}的地图`}>
          {triggerLabel}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="stage-map-menu" align="start" sideOffset={6} collisionPadding={12}>
          {links.map((link) => (
            <DropdownMenu.Item key={link.provider} asChild>
              <a className="stage-map-menu-item" href={link.url} target="_blank" rel="noreferrer">
                <span>{PROVIDER_LABELS[link.provider]}</span>
              </a>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
