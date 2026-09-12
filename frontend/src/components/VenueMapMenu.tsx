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
};

export function VenueMapMenu({ venueId, venueName, links: initialLinks }: VenueMapMenuProps) {
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

  if (!links?.length) return null;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button type="button" className="stage-map-trigger" aria-label={`选择${venueName}的地图`}>
          地图
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="stage-map-menu" align="start" sideOffset={6} collisionPadding={12}>
          {links.map((link) => (
            <DropdownMenu.Item key={link.provider} asChild>
              <a className="stage-map-menu-item" href={link.url} target="_blank" rel="noreferrer">
                <span>{PROVIDER_LABELS[link.provider]}</span>
                <small>{link.source === "place" ? "场馆地点" : "坐标定位"}</small>
              </a>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
