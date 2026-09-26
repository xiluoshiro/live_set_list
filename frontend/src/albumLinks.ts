export function isExternalHttpsUrl(value: string): boolean {
  if (/[\u0000-\u001f\u007f]/.test(value)) return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 2048 || /[\s\\]/.test(trimmed)) return false;
  try {
    const url = new URL(trimmed);
    return /^https:\/\//i.test(trimmed) && url.protocol === "https:"
      && !!url.hostname && !url.username && !url.password
      && !trimmed.split("/")[2].includes("@");
  } catch { return false; }
}

export function albumLinksError(albumUrl: string | null, covers: string[]): string {
  if (albumUrl && (/[\u0000-\u001f\u007f]/.test(albumUrl) || (albumUrl.trim() && !isExternalHttpsUrl(albumUrl)))) return "专辑页面须为有效的 HTTPS URL";
  if (covers.length > 20) return "封面最多 20 张";
  const seen = new Set<string>();
  for (const [index, url] of covers.entries()) {
    if (!isExternalHttpsUrl(url)) return `第 ${index + 1} 张封面须为有效的 HTTPS URL`;
    if (seen.has(url.trim())) return `第 ${index + 1} 张封面 URL 重复`;
    seen.add(url.trim());
  }
  return "";
}
