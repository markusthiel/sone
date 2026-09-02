/**
 * SONE web — how much a commented passage is marked (ADR-0046).
 *
 * Three states, and the reason it is a setting rather than a decision: somebody
 * reading a page they did not write wants the marks, and somebody proofreading
 * their own prose does not.
 *
 * Kept in the browser rather than on the account. How much marking somebody
 * wants depends on the screen they are reading on — a phone is not a desk — and
 * a preference that followed the account would make one of the two wrong. This
 * is also why it is not in the document: a switch stored there would let one
 * person hide the marks for everybody, and a page's comments are not one
 * reader's business to hide.
 */

import { useCallback, useEffect, useState } from 'react';

export const COMMENT_MARK_STYLES = ['highlight', 'underline', 'off'] as const;
export type CommentMarkStyle = (typeof COMMENT_MARK_STYLES)[number];

const KEY = 'sone.commentMarks';

function read(): CommentMarkStyle {
  try {
    const stored = localStorage.getItem(KEY);
    return (COMMENT_MARK_STYLES as readonly string[]).includes(stored ?? '')
      ? (stored as CommentMarkStyle)
      : 'highlight';
  } catch {
    // A browser refusing storage is not a browser that should refuse to draw a
    // page. The default is the answer.
    return 'highlight';
  }
}

export function useCommentMarkStyle(): {
  style: CommentMarkStyle;
  setStyle: (style: CommentMarkStyle) => void;
  /** Hidden for this page only, for as long as somebody is reading it. */
  hidden: boolean;
  setHidden: (hidden: boolean) => void;
  /** What the editor should actually draw. */
  effective: CommentMarkStyle;
} {
  const [style, setStyleState] = useState<CommentMarkStyle>(read);
  const [hidden, setHidden] = useState(false);

  const setStyle = useCallback((next: CommentMarkStyle) => {
    setStyleState(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Set for this session and not remembered. Better than refusing the
      // change because it cannot be written down.
    }
  }, []);

  // Another tab of the same person's browser. Cheap to honour and confusing not
  // to: two windows of one page disagreeing about whether comments are marked
  // reads as a fault.
  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key === KEY) setStyleState(read());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return {
    style,
    setStyle,
    hidden,
    setHidden,
    effective: hidden ? 'off' : style,
  };
}
