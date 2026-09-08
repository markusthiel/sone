/**
 * SONE web — saying *this is the one you asked for* (ADR-0156, ADR-0166, ADR-0167).
 *
 * Two places take somebody to a thing and then have to point at it: a PDF mark
 * revealed from the comments panel, and a block revealed from the right
 * sidebar. They light it differently — the mark is redrawn from state the
 * viewer holds, the block is a ProseMirror decoration — but **how long a moment
 * lasts** is one decision, and it was written down twice the moment the second
 * one arrived.
 *
 * ## Why this announces rather than writes
 *
 * The first version set `data-found` on the block's own element. ProseMirror
 * owns that element: its DOM observer sees the attribute appear and reconciles
 * it away within a tick (ADR-0167). So the flash is a decoration inside the
 * editor now, and this side only says *which block, and for how long* — down
 * the same named channel `sone:reveal-comment` and `sone:pdf-comment` use,
 * because only the editor can turn an id into something drawn.
 */

/**
 * How long the found state holds.
 *
 * Long enough to find with your eyes, short enough to be over before the next
 * ask: a thing that stayed lit would make the *second* jump look like nothing
 * happened, which is the fault this whole mechanism exists to avoid.
 */
export const FOUND_MS = 1600;

/** The event the editor listens for. Null means "put it out". */
export const FOUND_EVENT = 'sone:found-block';

let letGo: ReturnType<typeof setTimeout> | null = null;

const announce = (blockId: string | null): void => {
  window.dispatchEvent(new CustomEvent(FOUND_EVENT, { detail: blockId }));
};

/**
 * Light a block for a moment.
 *
 * The timer lives here rather than in the editor's plugin so that *how long*
 * stays beside the other duration this file owns. The plugin draws what it is
 * told and holds no policy about time.
 */
export function showAsFound(blockId: string): void {
  if (letGo) clearTimeout(letGo);
  announce(blockId);
  letGo = setTimeout(() => {
    announce(null);
    letGo = null;
  }, FOUND_MS);
}

/**
 * Somebody clicked a comment mark in the writing (ADR-0168).
 *
 * A named event for the reason every other one here is: the editor knows which
 * thread was clicked, and the three things that have to answer — the panel
 * opening, the tab changing, the thread lighting up — are three components with
 * no path between them. Each listens for what concerns it.
 */
export const OPEN_THREAD_EVENT = 'sone:open-thread';

export function askForThread(threadId: string): void {
  window.dispatchEvent(new CustomEvent(OPEN_THREAD_EVENT, { detail: threadId }));
}
