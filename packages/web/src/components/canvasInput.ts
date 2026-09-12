/**
 * SONE web — what a contact on the board means (ADR-0179).
 *
 * Asked as *„Handballenerkennung"*, and the browser makes it something simpler
 * than recognition: Pointer Events already say **what** touched. An Apple Pencil
 * arrives as `pointerType: 'pen'`; a finger and a palm both arrive as `'touch'`
 * and are indistinguishable from each other.
 *
 * So there is nothing to recognise and one rule to state: **once a pen has been
 * seen on this device, only the pen works the tools.** A palm is a touch, so a
 * palm moves the view by nothing and draws nothing.
 *
 * That is also the whole of what a browser can do here. The rejection at the
 * digitizer that PencilKit gets is not on offer — a palm and a deliberate
 * finger are the same event — and asking about contact size would be a guess
 * where `pointerType` is an answer.
 *
 * ## Why the rule waits for a pen
 *
 * Making touch pan-only everywhere takes drawing away from every tablet without
 * a pencil, and from every phone. The rule earns its way in by a pen actually
 * appearing, and then stays: the device somebody draws on with a pencil is the
 * device where a resting hand is the problem.
 *
 * ## Two contacts are never a tool
 *
 * Pinch and two-finger pan are what a tablet expects of any canvas, pen or no
 * pen. A board that cannot be zoomed with two fingers is a board somebody stops
 * using on a tablet.
 */

export interface Contact {
  /** What the browser says touched: `pen`, `touch`, `mouse`. */
  pointerType: string;
  /** Whether a pen has ever been put down on this device. */
  penSeen: boolean;
  /** How many contacts are down, this one included. */
  touches: number;
}

/** May this contact use the tools — draw, erase, select, drag an item? */
export function acts(contact: Contact): boolean {
  if (contact.pointerType === 'pen') return true;
  // A desktop has no palm, and everything a mouse did it goes on doing.
  if (contact.pointerType !== 'touch') return true;
  if (contact.touches > 1) return false;
  return !contact.penSeen;
}

/** Is this contact part of moving or zooming the view instead? */
export function gestures(contact: Contact): boolean {
  if (contact.pointerType !== 'touch') return false;
  if (contact.touches > 1) return true;
  return contact.penSeen;
}

/** Where the answer to "has a pen been used here" is kept. */
const PEN_KEY = 'sone.canvasPenSeen';

/**
 * Remembered across reloads, because the first stroke after one is the one that
 * goes wrong.
 *
 * Held in the browser rather than in the document or the account: it is a fact
 * about *this device*, not about a person or a board. Which is also why signing
 * out does not clear it (ADR-0178) — the next person at the same iPad has the
 * same pencil.
 */
export function readPenSeen(): boolean {
  try {
    return localStorage.getItem(PEN_KEY) === 'true';
  } catch {
    return false;
  }
}

export function rememberPenSeen(): void {
  try {
    localStorage.setItem(PEN_KEY, 'true');
  } catch {
    // Storage disabled. The rule then holds for this session only, which is
    // still better than not at all.
  }
}
