/**
 * SONE web — the one thing the side panel may ask the editor to do, and the one
 * place that remembers it was asked.
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
 * ## Why the chosen person lives here and not in the panel (ADR-0203)
 *
 * It used to live in `Contributors`, in a `useState`. The panel is one tab of
 * nine and React unmounts the ones that are not showing, so switching to the
 * outline threw the selection away — while the decorations, which live in the
 * editor, stayed on the page. What was left was a document highlighted from top
 * to bottom, a panel that said nobody was chosen, and no way to disagree with
 * either: the first click after coming back *re-selected* the same person and
 * changed nothing on screen, which reads as a switch that does not work.
 *
 * So the selection sits beside the command that carries it out, outlives the
 * tab, and is cleared in the two cases where its switch leaves the screen: the
 * panel closes (`clearChosenAuthor`, from the sidebar) and the editor goes
 * (`registerHighlighter`, from the surface — a new page draws nothing, so a
 * selection carried into it would claim a highlight that is not there).
 */

type Highlighter = (clients: number[] | null) => void;

let current: Highlighter | null = null;

/** The person whose writing is marked, by user key, or null for nobody. */
let chosen: string | null = null;

const listeners = new Set<() => void>();

function announce(): void {
  for (const listener of listeners) listener();
}

/**
 * Called by the editor surface while it has a view, and with null on teardown.
 *
 * Either way the selection goes: a new editor starts with no decorations, and a
 * selection that survived into it would be a claim about a page nobody has
 * marked.
 */
export function registerHighlighter(fn: Highlighter | null): void {
  current = fn;
  if (chosen !== null) {
    chosen = null;
    announce();
  }
}

/** Mark this person's writing, or pass null to mark nobody. */
export function chooseAuthor(userId: string | null, clients: number[] = []): void {
  chosen = userId;
  current?.(userId ? clients : null);
  announce();
}

/** Nobody. Used where the switch leaves the screen rather than being pressed. */
export function clearChosenAuthor(): void {
  if (chosen === null) return;
  chooseAuthor(null);
}

/** Who is chosen, for the panel to draw. */
export function chosenAuthor(): string | null {
  return chosen;
}

/** Tell me when that changes. Returns the unsubscribe. */
export function subscribeChosenAuthor(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
