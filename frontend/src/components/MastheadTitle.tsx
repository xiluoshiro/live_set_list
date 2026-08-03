import { useEffect, useRef, useState } from "react";

import { buildTitleLines, titleTokens } from "../titleSplit";

const MAX_WIDTH_FRACTION = 0.75;

type MastheadTitleProps = {
  as: "h1" | "h2";
  id?: string;
  title: string;
};

export function MastheadTitle({ as, id, title }: MastheadTitleProps) {
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const measureRef = useRef<HTMLSpanElement | null>(null);
  const [lines, setLines] = useState<string[] | null>(null);

  useEffect(() => {
    setLines(null);
    const headingEl = titleRef.current;
    const measureEl = measureRef.current;
    if (!headingEl || !measureEl) return;
    const availableWidth = headingEl.clientWidth;
    measureEl.textContent = title;
    const natural = measureEl.scrollWidth;
    if (natural <= availableWidth * MAX_WIDTH_FRACTION) {
      measureEl.textContent = "";
      return;
    }
    const tokens = titleTokens(title);
    if (tokens.length < 2) {
      measureEl.textContent = "";
      return;
    }
    const isLineTooLong = (line: string): boolean => {
      measureEl.textContent = line;
      return measureEl.scrollWidth > availableWidth * MAX_WIDTH_FRACTION;
    };
    const result = buildTitleLines(tokens, isLineTooLong);
    measureEl.textContent = "";
    setLines(result);
  }, [title]);

  const Heading = as;
  return (
    <Heading ref={titleRef} id={id}>
      <span ref={measureRef} className="stage-title-measure" aria-hidden="true" />
      {lines ? (
        lines.map((line) => (
          <span key={line} className="stage-title-line">
            {line}
          </span>
        ))
      ) : (
        title
      )}
    </Heading>
  );
}
