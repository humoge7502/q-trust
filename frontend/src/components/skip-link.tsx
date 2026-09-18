/**
 * Keyboard escape hatch, rendered once in the root layout.
 *
 * Must be the first focusable element in the document and must target an
 * element that exists on *every* route — the shell owns `#main-content`
 * precisely so this link cannot become a dead end as pages are added.
 *
 * Styling lives in `globals.css` (`.skip-link:focus`) rather than in a
 * `sr-only`/`focus:not-sr-only` pair: Tailwind's `sr-only` clips to a 1px box
 * and reversing it on focus is easy to get subtly wrong, while a single
 * explicit `:focus` rule is verifiable by inspection.
 */
export function SkipLink() {
  return (
    <a href="#main-content" className="skip-link sr-only">
      Skip to content
    </a>
  );
}
