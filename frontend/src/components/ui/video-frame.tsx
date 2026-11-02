import type { ReactNode } from "react";

/**
 * Consistent, accessible video shell used across the demo surfaces.
 *
 * Native `controls` keep the media operable by keyboard and assistive tech
 * without bespoke UI. `preload="metadata"` loads only the first frame + length,
 * so a page full of clips does not pull megabytes until the visitor hits play.
 * Same-origin `/media/*.mp4` is permitted by the site CSP (default-src 'self').
 */
export function VideoFrame({
  src,
  title,
  poster,
  className = "",
  children,
}: {
  src: string;
  title: string;
  className?: string;
  poster?: string;
  children?: ReactNode;
}) {
  return (
    <figure
      className={`group relative overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-lg shadow-black/30 ${className}`}
    >
      <video
        className="h-full w-full bg-slate-900"
        src={src}
        poster={poster}
        title={title}
        controls
        preload="metadata"
        playsInline
      />
      {children ? (
        <figcaption className="border-t border-white/10 bg-slate-950/80 px-4 py-2.5 text-xs text-slate-300">
          {children}
        </figcaption>
      ) : null}
    </figure>
  );
}
