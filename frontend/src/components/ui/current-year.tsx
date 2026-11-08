"use client";

/**
 * Renders the build-time year on the server and corrects it to the visitor's
 * current year after mount. The footer bakes `getFullYear()` into static HTML,
 * so a site built in one year would ship a stale © notice until the next
 * deploy. The server/client year mismatch on the year boundary is a
 * legitimate hydration difference, absorbed by suppressHydrationWarning; the
 * effect then patches the text via ref (no state, no re-render).
 *
 * Decorative text correction only: no animation, nothing to reduce.
 */
import { useEffect, useRef } from "react";

export function CurrentYear() {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.textContent = String(new Date().getFullYear());
  }, []);

  return (
    <span ref={ref} suppressHydrationWarning>
      {new Date().getFullYear()}
    </span>
  );
}
