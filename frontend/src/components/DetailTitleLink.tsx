import type { ReactNode } from "react";
import { ExternalLinkIcon } from "./ActionIcons";

type DetailTitleLinkProps = {
  href: string;
  children: ReactNode;
};

export function DetailTitleLink({ href, children }: DetailTitleLinkProps) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="detail-title-link">
      <span>{children}</span>
      <span className="detail-title-link-icon" aria-hidden="true">
        <ExternalLinkIcon />
      </span>
    </a>
  );
}
