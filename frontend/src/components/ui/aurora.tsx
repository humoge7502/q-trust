/**
 * Aurora backdrop (B7) — a slow field of pre-soft radial gradients
 * (quantum-dim, qtrust-700, qtrust-500 at low alpha) drifting behind a
 * section. Server-safe, pure CSS: fixed-size blurred blobs animated with a
 * very slow transform-only keyframe (aurora-drift in globals.css). Decorative
 * only: aria-hidden, pointer-events-none, rendered behind content (place
 * content in a relative z-10 sibling). Reduced motion: static field via the
 * explicit override in globals.css.
 */
export function Aurora({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`.trim()}
    >
      <span className="aurora-blob aurora-blob-a" />
      <span className="aurora-blob aurora-blob-b" />
      <span className="aurora-blob aurora-blob-c" />
    </div>
  );
}
