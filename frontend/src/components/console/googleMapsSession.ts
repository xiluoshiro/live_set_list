import type { LocationPoint } from "../../api";

type LatLng = { lat: () => number; lng: () => number };
type MapsEvent = { latLng?: LatLng; placeId?: string; stop?: () => void };
type Listener = { remove: () => void };
type GoogleMap = {
  addListener: (name: string, callback: (event: MapsEvent) => void) => Listener;
  getBounds: () => { contains: (point: { lat: number; lng: number }) => boolean } | undefined;
  getZoom: () => number | undefined;
  setCenter: (point: { lat: number; lng: number }) => void;
  setZoom: (zoom: number) => void;
};
type GoogleMarker = {
  addListener: (name: string, callback: () => void) => Listener;
  getPosition: () => LatLng | null;
  setDraggable: (value: boolean) => void;
  setMap: (map: GoogleMap | null) => void;
  setPosition: (point: { lat: number; lng: number }) => void;
};
type MapsApi = {
  Map: new (element: HTMLElement, options: Record<string, unknown>) => GoogleMap;
  Marker: new (options: Record<string, unknown>) => GoogleMarker;
  event: { trigger: (target: GoogleMap, name: string) => void };
};

declare global {
  interface Window {
    google?: { maps: MapsApi };
    __liveSetListGoogleMapsReady?: () => void;
  }
}

let loader: Promise<MapsApi> | null = null;
let loadedKey = "";
let surface: HTMLDivElement | null = null;
let parking: HTMLDivElement | null = null;
let map: GoogleMap | null = null;
let marker: GoogleMarker | null = null;
let listeners: Listener[] = [];
let onPoint: ((point: LocationPoint) => void) | null = null;
let onPlaceId: ((placeId: string) => void) | null = null;
let disabled = false;

function loadGoogleMaps(apiKey: string): Promise<MapsApi> {
  if (window.google?.maps) return Promise.resolve(window.google.maps);
  if (loader) {
    if (loadedKey !== apiKey) return Promise.reject(new Error("Google Maps 浏览器 Key 已在本次页面会话中固定"));
    return loader;
  }
  loadedKey = apiKey;
  loader = new Promise<MapsApi>((resolve, reject) => {
    const callbackName = "__liveSetListGoogleMapsReady";
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly&loading=async&callback=${callbackName}`;
    script.async = true;
    script.dataset.liveSetListGoogleMaps = "true";
    window[callbackName] = () => {
      delete window[callbackName];
      if (window.google?.maps) resolve(window.google.maps);
      else reject(new Error("Google Maps SDK 未初始化"));
    };
    script.onerror = () => {
      delete window[callbackName];
      script.remove();
      reject(new Error("Google Maps SDK 加载失败"));
    };
    document.head.appendChild(script);
  }).catch(error => {
    loader = null;
    loadedKey = "";
    throw error;
  });
  return loader;
}

function pointFrom(value: LatLng | null | undefined): LocationPoint | null {
  if (!value) return null;
  return { latitude: Number(value.lat().toFixed(6)), longitude: Number(value.lng().toFixed(6)) };
}

const toGooglePoint = (point: LocationPoint) => ({ lat: point.latitude, lng: point.longitude });

export async function attachGoogleMap(container: HTMLDivElement, apiKey: string, callbacks: {
  disabled: boolean;
  onPoint: (point: LocationPoint) => void;
  onPlaceId: (placeId: string) => void;
}): Promise<void> {
  disabled = callbacks.disabled;
  onPoint = callbacks.onPoint;
  onPlaceId = callbacks.onPlaceId;
  if (!surface) {
    surface = document.createElement("div");
    surface.className = "venue-location-map-surface";
  }
  container.appendChild(surface);
  const maps = await loadGoogleMaps(apiKey);
  if (!map) {
    map = new maps.Map(surface, { center: { lat: 25, lng: 110 }, zoom: 3, scrollwheel: false,
      clickableIcons: true, mapTypeControl: false, streetViewControl: false });
    listeners.push(map.addListener("click", event => {
      if (disabled) return;
      if (event.placeId) {
        event.stop?.();
        onPlaceId?.(event.placeId);
        return;
      }
      const point = pointFrom(event.latLng);
      if (point) onPoint?.(point);
    }));
  } else {
    maps.event.trigger(map, "resize");
  }
}

export function updateGoogleMap(point: LocationPoint | null, isDisabled: boolean): void {
  disabled = isDisabled;
  if (!map || !window.google?.maps) return;
  if (!point) {
    marker?.setMap(null);
    marker = null;
    return;
  }
  if (!marker) {
    marker = new window.google.maps.Marker({ map, position: toGooglePoint(point), draggable: !isDisabled, title: "草稿位置（可拖动）" });
    listeners.push(marker.addListener("dragend", () => {
      if (!disabled) {
        const next = pointFrom(marker?.getPosition());
        if (next) onPoint?.(next);
      }
    }));
  } else {
    marker.setMap(map);
    marker.setPosition(toGooglePoint(point));
    marker.setDraggable(!isDisabled);
  }
  const bounds = map.getBounds();
  if (!bounds?.contains(toGooglePoint(point)) || (map.getZoom() ?? 0) < 12) {
    map.setCenter(toGooglePoint(point));
    map.setZoom(16);
  }
}

export function detachGoogleMap(container: HTMLDivElement): void {
  if (!surface || surface.parentElement !== container) return;
  if (!parking) {
    parking = document.createElement("div");
    parking.hidden = true;
    parking.dataset.liveSetListGoogleMapsParking = "true";
    document.body.appendChild(parking);
  }
  parking.appendChild(surface);
}

export function resetGoogleMapSession(): void {
  listeners.forEach(listener => listener.remove());
  listeners = [];
  marker?.setMap(null);
  marker = null;
  map = null;
  surface?.remove();
  surface = null;
  parking?.remove();
  parking = null;
  onPoint = null;
  onPlaceId = null;
}
