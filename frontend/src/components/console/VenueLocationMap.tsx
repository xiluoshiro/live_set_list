import { useEffect, useRef, useState } from "react";
import type { GeographyCapabilities, LocationPoint } from "../../api";
import { attachGoogleMap, detachGoogleMap, updateGoogleMap } from "./googleMapsSession";

export function VenueLocationMap(props: {
  point: LocationPoint | null;
  disabled: boolean;
  config: GeographyCapabilities;
  onPoint: (point: LocationPoint) => void;
  onPlaceId: (placeId: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const current = useRef(props);
  current.current = props;
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    setReady(false);
    setError("");
    if (!props.config.google_maps_browser_api_key) {
      setError("Google Maps 浏览器 Key 未配置，可继续输入经纬度。");
      return;
    }
    let disposed = false;
    void attachGoogleMap(element, props.config.google_maps_browser_api_key, {
      disabled: props.disabled,
      onPoint: point => current.current.onPoint(point),
      onPlaceId: placeId => current.current.onPlaceId(placeId),
    }).then(() => {
      if (!disposed) {
        setReady(true);
        updateGoogleMap(current.current.point, current.current.disabled);
      }
    }).catch(() => {
      if (!disposed) setError("Google Maps 加载失败，可继续输入经纬度。");
    });
    return () => {
      disposed = true;
      detachGoogleMap(element);
    };
  }, [props.config.google_maps_browser_api_key]);

  useEffect(() => {
    if (ready) updateGoogleMap(props.point, props.disabled);
  }, [ready, props.point?.latitude, props.point?.longitude, props.disabled]);

  return <>
    <div ref={container} className="venue-location-map" role="region" aria-label="场馆位置地图" />
    {!props.point && <p className="console-admin-hint">尚未选点；点击地图、Google 地点或输入经纬度。</p>}
    {error && <p role="status">{error}</p>}
  </>;
}
