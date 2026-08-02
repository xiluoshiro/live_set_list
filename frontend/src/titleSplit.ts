export type TitleSegments = {
  prefix: string;
  quoted: string;
  suffix: string;
};

const QUOTED_SEGMENT_RE = /([「『“].*?[」』”])/;

export function titleSegments(title: string): TitleSegments | null {
  const match = title.match(QUOTED_SEGMENT_RE);
  if (!match) return null;
  const index = match.index ?? 0;
  return {
    prefix: title.slice(0, index),
    quoted: match[0],
    suffix: title.slice(index + match[0].length),
  };
}

export function buildTitleLines(
  segments: TitleSegments,
  isLineTooLong: (line: string) => boolean,
): string[] {
  const { prefix, quoted, suffix } = segments;
  const twoLines = suffix
    ? [prefix + quoted, suffix]
    : prefix
      ? [prefix, quoted]
      : [quoted];
  if (twoLines.every((line) => !isLineTooLong(line))) return twoLines;
  const threeLines = [prefix, quoted, suffix].filter((part) => part !== "");
  return threeLines.length > 1 ? threeLines : [prefix + quoted + suffix];
}
