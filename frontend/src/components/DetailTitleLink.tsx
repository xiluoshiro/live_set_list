import type { ReactNode } from "react";

type DetailTitleLinkProps = {
  href: string;
  children: ReactNode;
};

export function DetailTitleLink({ href, children }: DetailTitleLinkProps) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="detail-title-link">
      <span>{children}</span>
      <span className="detail-title-link-icon" aria-hidden="true">
        <svg viewBox="0 0 16 16" focusable="false">
          <path
            d="M6 3.5H3.5v9h9V10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M8 3.5h4.5V8"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M7.5 8.5 12.5 3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </a>
  );
}
