import { useLayoutEffect, useRef, type AnchorHTMLAttributes, type ReactNode, type RefObject } from "react";
import type { CatalogPage } from "../api";
import { AlbumCover } from "./AlbumCover";

export const catalogDate = (date: string | null) => date ? date.replace(/-/g, ".") : "—";

export function CatalogLink({ onNavigate, children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { onNavigate: () => void; children: ReactNode }) {
  return <a {...props} onClick={event => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); onNavigate();
  }}>{children}</a>;
}

export function CatalogArt({ url, title }: { url?: string; title: string }) {
  return url ? <AlbumCover url={url} alt={title} /> : <span className="song-art-empty" role="img" aria-label={`${title}，暂无封面`}>♪</span>;
}

export function CatalogPagination({ data, onPage, label, footerRef, expanded = false }: {
  data: Omit<CatalogPage<unknown>, "items">; onPage: (page: number) => void; label: string;
  footerRef?: RefObject<HTMLDivElement>;
  expanded?: boolean;
}) {
  const choices = expanded && data.total_pages <= 7
    ? Array.from({ length: data.total_pages }, (_, index) => index + 1)
    : [...new Set([1, data.page - 1, data.page, data.page + 1, data.total_pages,
      ...(expanded && data.page <= 3 ? [2, 3, 4] : []),
      ...(expanded && data.page >= data.total_pages - 2 ? [data.total_pages - 3, data.total_pages - 2, data.total_pages - 1] : [])])]
    .filter(page => page > 0 && page <= data.total_pages).sort((a, b) => a - b);
  return <div className="song-catalog-pagination" ref={footerRef}>
    <span>{data.total ? (data.page - 1) * data.page_size + 1 : 0}–{Math.min(data.page * data.page_size, data.total)} / {data.total}</span>
    <nav aria-label={label}>
      <button type="button" className="console-ghost-btn" aria-label="上一页" disabled={data.page <= 1} onClick={() => onPage(data.page - 1)}>←</button>
      {choices.map((page, index) => <span key={page}>
        {index > 0 && page > choices[index - 1] + 1 && <span className="song-page-gap">…</span>}
        <button type="button" className="console-ghost-btn" aria-label={`第 ${page} 页`} aria-current={page === data.page ? "page" : undefined}
          onClick={() => onPage(page)}>{page}</button>
      </span>)}
      <button type="button" className="console-ghost-btn" aria-label="下一页" disabled={data.page >= data.total_pages} onClick={() => onPage(data.page + 1)}>→</button>
    </nav>
  </div>;
}

// Measure actual rendered rows. Remember the tallest row so changing page size cannot oscillate.
export function useFittedCatalogPage(rowsRef: RefObject<HTMLElement>, viewportRef: RefObject<HTMLElement>,
  size: number, onSize: (size: number) => void, layoutRef?: RefObject<HTMLElement>) {
  const measured = useRef({ width: 0, rowHeight: 0 });
  useLayoutEffect(() => {
    let frame = 0;
    const measure = () => {
      const body = rowsRef.current;
      const viewport = viewportRef.current;
      // Loading temporarily removes the rows and pagination; wait for the
      // completed page rather than fitting against that transient extra space.
      if (!body?.children.length || !viewport) return;
      // A provisional oversized page may add a scrollbar; its width must not
      // reset the tallest-row history and cause alternating page capacities.
      const width = viewport.getBoundingClientRect().width;
      if (!width || !viewport.clientHeight) return; // Layout is unavailable in SSR/jsdom.
      if (measured.current.width !== width) measured.current = { width, rowHeight: 0 };
      const heights = Array.from(body.children, child => child.getBoundingClientRect().height);
      measured.current.rowHeight = Math.max(measured.current.rowHeight, ...heights);
      if (!measured.current.rowHeight) return;
      const headHeight = body.closest("table")?.tHead?.getBoundingClientRect().height ?? 0;
      const available = viewport.clientHeight - headHeight - 2;
      const capacity = Math.max(1, Math.min(100, Math.floor(available / measured.current.rowHeight)));
      if (capacity !== size) onSize(capacity);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    measure();
    window.addEventListener("resize", schedule);
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
    if (rowsRef.current) observer?.observe(rowsRef.current);
    if (viewportRef.current) observer?.observe(viewportRef.current);
    // Covers and wrapped metadata can move the table without resizing the table itself.
    if (layoutRef?.current) observer?.observe(layoutRef.current);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("resize", schedule); observer?.disconnect(); };
  });
}

export function useCatalogScroll(ready: boolean, scrollY: number) {
  useLayoutEffect(() => {
    if (!ready) return;
    const frame = window.requestAnimationFrame(() => window.scrollTo({ top: scrollY, behavior: "instant" }));
    return () => window.cancelAnimationFrame(frame);
  }, [ready, scrollY]);
}
