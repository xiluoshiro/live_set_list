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

export function CatalogPagination({ data, onPage, label, footerRef }: {
  data: Omit<CatalogPage<unknown>, "items">; onPage: (page: number) => void; label: string;
  footerRef?: RefObject<HTMLDivElement>;
}) {
  const choices = [...new Set([1, data.page - 1, data.page, data.page + 1, data.total_pages])]
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
export function useFittedCatalogPage(rowsRef: RefObject<HTMLElement>, footerRef: RefObject<HTMLElement>,
  size: number, onSize: (size: number) => void) {
  const measured = useRef({ width: 0, rowHeight: 0 });
  useLayoutEffect(() => {
    const measure = () => {
      const body = rowsRef.current;
      if (!body || window.innerWidth < 1000) return;
      const bounds = body.getBoundingClientRect();
      if (!bounds.width) return; // Layout is unavailable in SSR/jsdom.
      if (measured.current.width !== bounds.width) measured.current = { width: bounds.width, rowHeight: 0 };
      const heights = Array.from(body.children, child => child.getBoundingClientRect().height);
      measured.current.rowHeight = Math.max(measured.current.rowHeight, ...heights);
      if (!measured.current.rowHeight) return;
      const footerHeight = footerRef.current?.getBoundingClientRect().height ?? 48;
      const available = window.innerHeight - bounds.top - footerHeight - 28;
      const capacity = Math.max(1, Math.min(100, Math.floor(available / measured.current.rowHeight)));
      if (capacity !== size) onSize(capacity);
    };
    measure();
    window.addEventListener("resize", measure);
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (rowsRef.current?.parentElement) observer?.observe(rowsRef.current.parentElement);
    return () => { window.removeEventListener("resize", measure); observer?.disconnect(); };
  });
}

export function useCatalogScroll(ready: boolean, scrollY: number) {
  useLayoutEffect(() => {
    if (!ready) return;
    const frame = window.requestAnimationFrame(() => window.scrollTo({ top: scrollY, behavior: "instant" }));
    return () => window.cancelAnimationFrame(frame);
  }, [ready, scrollY]);
}
