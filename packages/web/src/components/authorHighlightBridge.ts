/**
 * SONE web — the one thing the side panel may ask the editor to do.
 *
 * The panel and the editor are siblings, and the panel has no view to dispatch
 * on. Rather than passing an editor view up and across — which would let any
 * panel dispatch anything, and make the editor's own update path reachable from
 * places that should not know it exists — the surface registers exactly one
 * command here and the panel calls it.
 *
 * Deliberately one function and not a general bridge. A general one is how a
 * codebase ends up with two ways to change the same state, and the first thing
 * to go wrong is that they disagree about which is authoritative.
 *
 * The registration is replaced when a page opens and cleared when it closes, so
 * a call after the editor has gone does nothing rather than reaching into a
 * destroyed view.
 */

type Highlighter = (clients: number[] | null) => void;

let current: Highlighter | null = null;

/** Called by the editor surface while it has a view. */
export function registerHighlighter(fn: Highlighter | null): void {
  current = fn;
}

/** Called by the panel. Does nothing when no editor is open. */
export function highlightAuthor(clients: number[] | null): void {
  current?.(clients);
}
