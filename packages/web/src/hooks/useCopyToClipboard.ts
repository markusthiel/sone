/**
 * SONE web — putting something on the clipboard, and saying so (ADR-0158).
 *
 * Copying is three lines and all three are easy to get wrong in the same way:
 * the write can be refused, it does not exist at all over plain http, and the
 * "copied" that follows has to end again or it becomes a label.
 *
 * ## Why the flash is keyed
 *
 * A list has one of these per row. A boolean would light every row in the list,
 * or — worse — light the wrong one, and the panel this was written for has a
 * copy button on each of a page's links. So the caller names what it copied and
 * the hook says which name is currently lit.
 *
 * ## What it does not do
 *
 * It does not tell anybody the copy failed. Clipboard access being refused is
 * not a fault to report; the address is on screen, and "copy" quietly not
 * lighting up is a truthful enough answer for an act that costs nothing to
 * repeat by hand.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

/** How long the confirmation stays. Long enough to read, short enough to end. */
const LIT_MS = 1400;

export function useCopyToClipboard(): {
  copy: (text: string, key?: string) => Promise<void>;
  /** Which key is lit, or null. An unnamed copy lights the empty string. */
  copied: string | null;
} {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A component can be unmounted between the copy and the end of the flash —
  // a panel switching tabs, a dialog closing — and a timer that outlives it
  // sets state on something that is gone.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback(async (text: string, key = ''): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Refused, or absent over plain http. See the note above.
      return;
    }
    setCopied(key);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(null), LIT_MS);
  }, []);

  return { copy, copied };
}
