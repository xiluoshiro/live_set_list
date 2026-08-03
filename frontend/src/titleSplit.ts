const QUOTED_SEGMENT_RE = /([「『“].*?[」』”])/;
const SEPARATOR_RE = /( - )/;

export function titleTokens(title: string): string[] {
  const tokens: string[] = [];
  for (const part of title.split(QUOTED_SEGMENT_RE)) {
    if (part === "") continue;
    if (QUOTED_SEGMENT_RE.test(part)) {
      tokens.push(part);
    } else {
      for (const sub of part.split(SEPARATOR_RE)) {
        if (sub !== "") tokens.push(sub);
      }
    }
  }
  return tokens.length > 0 ? tokens : [title];
}

export function buildTitleLines(
  tokens: string[],
  isLineTooLong: (line: string) => boolean,
): string[] {
  const lines: string[] = [];
  let current = "";
  const startLine = (token: string): string => {
    const stripped = token.replace(/^\s+/, "");
    const moved = token.slice(0, token.length - stripped.length);
    if (moved && lines.length > 0) lines[lines.length - 1] += moved;
    return stripped;
  };
  for (const token of tokens) {
    if (current === "") {
      current = startLine(token);
      continue;
    }
    const candidate = current + token;
    if (!isLineTooLong(candidate)) {
      current = candidate;
    } else {
      lines.push(current);
      current = startLine(token);
    }
  }
  if (current !== "") lines.push(current);
  while (lines.length > 3) {
    const last = lines.pop() ?? "";
    lines[lines.length - 1] += last;
  }
  return lines.length > 0 ? lines : [tokens.join("")];
}
