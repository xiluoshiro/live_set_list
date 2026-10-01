import { useLayoutEffect, useRef, type RefObject } from "react";

/** Keep server-paged records within the available space without losing the reading anchor. */
export function useSongDetailLayout(
  layoutRef: RefObject<HTMLElement>, viewportRef: RefObject<HTMLElement>, rowsRef: RefObject<HTMLElement>,
  releasesRef: RefObject<HTMLElement>, pageSize: number, onCapacity: (size: number) => void,
) {
  const measured = useRef({ width: 0, rowHeight: 0 });
  useLayoutEffect(() => {
    const layout = layoutRef.current;
    const viewport = viewportRef.current;
    if (!layout || !viewport) return;
    let frame = 0;
    const measure = () => {
      const fits = getComputedStyle(layout).getPropertyValue("--song-fit").trim() === "1";
      const releases = releasesRef.current;
      const cover = releases?.querySelector<HTMLElement>(".song-release-first .song-release-art");
      if (cover && releases) {
        cover.style.removeProperty("--song-feature-cover-size");
        if (fits) {
          const excess = releases.scrollHeight - releases.clientHeight;
          if (excess > 0) cover.style.setProperty("--song-feature-cover-size", `${Math.max(48, cover.getBoundingClientRect().height - excess - 2)}px`);
        }
      }
      if (!fits) {
        measured.current = { width: 0, rowHeight: 0 };
        if (pageSize !== 8) onCapacity(8);
        return;
      }
      const body = rowsRef.current;
      if (!body) return;
      // An overflowing provisional page can add a scrollbar to the table. Track
      // the outer viewport width so that scrollbar changes cannot reset row history.
      const width = viewport.getBoundingClientRect().width;
      if (!width) return; // SSR and jsdom have no measurable layout.
      if (measured.current.width !== width) measured.current = { width, rowHeight: 0 };
      measured.current.rowHeight = Math.max(measured.current.rowHeight,
        ...Array.from(body.children, row => row.getBoundingClientRect().height));
      if (!measured.current.rowHeight) return;
      const headHeight = body.closest("table")?.tHead?.getBoundingClientRect().height ?? 0;
      const capacity = Math.max(1, Math.min(100, Math.floor((viewport.clientHeight - headHeight - 2) / measured.current.rowHeight)));
      if (capacity !== pageSize) onCapacity(capacity);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    observer?.observe(layout);
    observer?.observe(viewport);
    if (releasesRef.current) observer?.observe(releasesRef.current);
    if (rowsRef.current) observer?.observe(rowsRef.current);
    layout.addEventListener("load", schedule, true);
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame); observer?.disconnect();
      layout.removeEventListener("load", schedule, true); window.removeEventListener("resize", schedule);
    };
  });
}
