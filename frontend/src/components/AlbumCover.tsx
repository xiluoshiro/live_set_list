import { useState } from "react";
import { isExternalHttpsUrl } from "../albumLinks";
import "./album-cover.css";

export function AlbumCover({ url, alt = "" }: { url: string; alt?: string }) {
  // A changed URL remounts the image so a failed preview can be corrected.
  return <CoverImage key={url} url={url} alt={alt} />;
}

function CoverImage({ url, alt }: { url: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  return failed || !isExternalHttpsUrl(url)
    ? <span className="album-cover-error" role="status">封面无法显示</span>
    : <img className="album-cover-image" src={url.trim()} alt={alt} loading="lazy" onError={() => setFailed(true)} />;
}

export function AlbumCoverGallery({ urls, title }: { urls: string[]; title: string }) {
  return <CoverGallery key={JSON.stringify(urls)} urls={urls} title={title} />;
}

function CoverGallery({ urls, title }: { urls: string[]; title: string }) {
  const [index, setIndex] = useState(0);
  if (!urls.length) return null;
  return <div className="album-cover-gallery" role="group" aria-label="专辑封面">
    <AlbumCover url={urls[index]} alt={`${title} 封面 ${index + 1}`} />
    {urls.length > 1 && <div className="album-cover-controls">
      <button className="console-ghost-btn" disabled={index === 0} onClick={() => setIndex(index - 1)}>上一张</button>
      <span aria-live="polite">{index + 1} / {urls.length}</span>
      <button className="console-ghost-btn" disabled={index === urls.length - 1} onClick={() => setIndex(index + 1)}>下一张</button>
    </div>}
  </div>;
}
