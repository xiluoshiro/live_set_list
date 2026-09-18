import { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap, Marker } from "leaflet";
import type { GeographyCapabilities, LocationPoint } from "../../api";

export function VenueLocationMap(props: { point: LocationPoint | null; disabled: boolean; config: GeographyCapabilities; onPoint: (point: LocationPoint) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const current = useRef(props); current.current = props;
  const instance = useRef<{ map: LeafletMap; marker: Marker | null; library: typeof import("leaflet") } | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let disposed = false;
    let resize: ResizeObserver | undefined;
    setReady(false); setError("");
    if (!props.config.tile_url) { setError("底图未配置，可继续输入经纬度。"); return; }
    void Promise.all([import("leaflet"), import("leaflet/dist/leaflet.css")]).then(([L]) => {
      if (disposed || !container.current) return;
      const point = current.current.point;
      const map = L.map(container.current, { scrollWheelZoom: false, worldCopyJump: true });
      const showPoint = point && Math.abs(point.latitude) <= 85;
      map.setView(showPoint ? [point.latitude, point.longitude] : [25, 110], showPoint ? 16 : 3);
      L.tileLayer(props.config.tile_url, { maxZoom: 19 }).on("tileerror", () => {
        if (!disposed) setError("部分底图未能加载，可重试或继续输入经纬度。");
      }).addTo(map);
      instance.current = { map, marker: null, library: L };
      map.on("click", (event: import("leaflet").LeafletMouseEvent) => {
        if (!current.current.disabled) current.current.onPoint({ latitude: Number(event.latlng.lat.toFixed(6)), longitude: Number(event.latlng.wrap().lng.toFixed(6)) });
      });
      if (typeof ResizeObserver !== "undefined") {
        resize = new ResizeObserver(() => map.invalidateSize()); resize.observe(container.current);
      }
      setReady(true);
    }).catch(() => { if (!disposed) setError("地图加载失败，可继续输入经纬度。"); });
    return () => { disposed = true; resize?.disconnect(); instance.current?.map.remove(); instance.current = null; };
  }, [props.config.tile_url]);
  useEffect(() => {
    const value = instance.current;
    if (!value || !ready) return;
    const { point } = props;
    if (!point || Math.abs(point.latitude) > 85) { value.marker?.remove(); value.marker = null; return; }
    const coordinate: [number, number] = [point.latitude, point.longitude];
    if (!value.marker) {
      value.marker = value.library.marker(coordinate, { draggable: !props.disabled, title: "草稿位置（可拖动）", alt: "草稿位置",
        icon: value.library.divIcon({ className: "venue-location-marker", iconSize: [22, 22], iconAnchor: [11, 11] }) }).addTo(value.map);
      value.marker.on("dragend", () => {
        const point = instance.current?.marker?.getLatLng().wrap();
        if (point && !current.current.disabled) current.current.onPoint({ latitude: Number(point.lat.toFixed(6)), longitude: Number(point.lng.toFixed(6)) });
      });
    } else value.marker.setLatLng(coordinate);
    if (props.disabled) value.marker.dragging?.disable(); else value.marker.dragging?.enable();
    if (!value.map.getBounds().contains(coordinate) || value.map.getZoom() < 12) value.map.setView(coordinate, 16);
  }, [ready, props.point?.latitude, props.point?.longitude, props.disabled]);
  return <>
    <div ref={container} className="venue-location-map" role="region" aria-label="场馆位置地图" />
    <p className="console-admin-hint"><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">{props.config.attribution}</a></p>
    {(!props.point || Math.abs(props.point.latitude) > 85) && <p className="console-admin-hint">{props.point ? "该纬度超出底图显示范围，已保留输入坐标。" : "尚未选点；点击地图、搜索名称或输入经纬度。"}</p>}
    {error && <p role="status">{error}</p>}
  </>;
}
