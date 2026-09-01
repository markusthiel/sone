/**
 * SONE web — the selection toolbar.
 *
 * Appears over a text selection with bold, italic, strikethrough, code and
 * link. It exists mainly for the last of those: there was no way to make a link
 * at all, and a URL cannot be typed into a keyboard shortcut.
 *
 * Positioned from the selection's own rectangle rather than from the caret, so
 * it sits over the middle of what is selected instead of at one end. Flipped
 * below when there is no room above, which on a phone with the keyboard up is
 * most of the time.
 *
 * Deliberately not shown for an empty selection. A toolbar that follows the
 * caret while typing is in the way of the thing it is meant to help with.
 */

import {
  canLink,
  codeTextAt,
  linkAt,
  normaliseHref,
  removeLink,
  schema,
  setLink,
} from '@sone/editor';
import { useT } from '../i18n/useT.tsx';
import { toggleMark } from 'prosemirror-commands';
import type { EditorView } from 'prosemirror-view';
import { useEffect, useRef, useState, type ReactElement } from 'react';

import { useViewportChanges } from '../hooks/useViewportChanges.ts';
import { keepsEditorSelection } from './popup.ts';

interface SelectionToolbarProps {
  view: EditorView;
  /** Bumped on every transaction, so the toolbar follows the selection. */
  revision: number;
}

const GAP = 8;
const MARGIN = 8;

export function SelectionToolbar({ view, revision }: SelectionToolbarProps): ReactElement | null {
  const { t } = useT();
  const [box, setBox] = useState<{ top: number; left: number; above: boolean } | null>(null);
  const [editingLink, setEditingLink] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const [copied, setCopied] = useState(false);
  const [href, setHref] = useState('');
  const barRef = useRef<HTMLDivElement | null>(null);

  const { state } = view;
  const empty = state.selection.empty;
  const existingLink = linkAt(state);

  // Kept open across the transaction that selects the link, so Mod-K can leave
  // a selection behind and have the editor appear over it.
  const visible = !empty || editingLink;
  const codeText = codeTextAt(state);

  // A scroll moves the selection under the toolbar without producing a
  // transaction, so nothing else would prompt a re-measure.
  const viewportToken = useViewportChanges(visible);

  const copyCode = async (): Promise<void> => {
    if (codeText === null) return;
    try {
      await navigator.clipboard.writeText(codeText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard access can be refused, and over plain http it does not exist.
      // The selection is still there to copy by hand.
    }
  };

  useEffect(() => {
    if (!visible) {
      setBox(null);
      return;
    }
    try {
      const start = view.coordsAtPos(state.selection.from);
      const end = view.coordsAtPos(state.selection.to);
      const height = barRef.current?.offsetHeight ?? 40;

      const centre = (start.left + end.right) / 2;
      const spaceAbove = start.top;
      const above = spaceAbove > height + GAP + MARGIN;

      const width = barRef.current?.offsetWidth ?? 260;
      setBox({
        top: above ? start.top - height - GAP : end.bottom + GAP,
        left: Math.min(
          Math.max(MARGIN, centre - width / 2),
          Math.max(MARGIN, window.innerWidth - width - MARGIN),
        ),
        above,
      });
    } catch {
      // A position can be stale for a frame after a document change. Retried,
      // because the toolbar renders hidden while `box` is null and a single
      // failure would hide it until the selection changed again.
      const retry = requestAnimationFrame(() => setRetryToken((n) => n + 1));
      return () => cancelAnimationFrame(retry);
    }
    return undefined;
  }, [view, state, revision, visible, editingLink, retryToken, viewportToken]);

  // Escape closes the link editor without applying, and returns focus to the
  // document — otherwise the caret is lost and the next keystroke goes nowhere.
  useEffect(() => {
    if (!editingLink) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setEditingLink(false);
        view.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [editingLink, view]);

  if (!visible) return null;

  const run = (command: (s: typeof state, d: typeof view.dispatch) => boolean): void => {
    command(view.state, view.dispatch);
    view.focus();
  };

  const marks = [
    { name: 'strong', label: 'B', title: 'Bold (Mod-B)', style: { fontWeight: 700 } },
    { name: 'em', label: 'I', title: 'Italic (Mod-I)', style: { fontStyle: 'italic' } },
    {
      name: 'strikethrough',
      label: 'S',
      title: 'Strikethrough',
      style: { textDecoration: 'line-through' },
    },
    {
      name: 'inlineCode',
      label: '‹›',
      title: 'Code (Mod-E)',
      style: { fontFamily: 'ui-monospace, Menlo, monospace' },
    },
  ] as const;

  return (
    <div
      className="selection-toolbar"
      ref={barRef}
      style={box ? { top: box.top, left: box.left } : { visibility: 'hidden' }}
      role="toolbar"
      aria-label={t('format.label')}
      // The editor loses focus on mousedown, which would collapse the selection
      // before any command could act on it.
      // mousedown, not pointerdown: preventing pointerdown on a touch
      // screen cancels the gesture before the tap can become a click.
      {...keepsEditorSelection}
    >
      {editingLink ? (
        <div className="link-editor">
          <input
            value={href}
            autoFocus
            placeholder={t('format.linkPlaceholder')}
            aria-label={t('format.linkAddress')}
            onChange={(event) => setHref(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              // Refused rather than stored broken, and said so rather than
              // silently doing nothing.
              if (normaliseHref(href) === null) return;
              run(setLink(href));
              setEditingLink(false);
            }}
          />
          <button
            type="button"
            className="primary"
            disabled={normaliseHref(href) === null}
            onClick={() => {
              run(setLink(href));
              setEditingLink(false);
            }}
          >
            {t('action.apply')}
          </button>
          {existingLink && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                run(removeLink);
                setEditingLink(false);
              }}
            >
              {t('format.removeLink')}
            </button>
          )}
        </div>
      ) : (
        <>
          {marks.map((mark) => {
            const type = schema.marks[mark.name];
            if (!type) return null;
            const active = isMarkActive(state, mark.name);
            return (
              <button
                key={mark.name}
                type="button"
                title={mark.title}
                aria-pressed={active}
                className="toolbar-button"
                style={mark.style}
                onClick={() => run(toggleMark(type))}
              >
                {mark.label}
              </button>
            );
          })}

          <span className="toolbar-divider" aria-hidden="true" />

          <button
            type="button"
            title={t('format.link')}
            className="toolbar-button"
            disabled={!canLink(state)}
            aria-pressed={existingLink !== null}
            onClick={() => {
              setHref(existingLink?.href ?? '');
              setEditingLink(true);
            }}
          >
            {t('format.linkWord')}
          </button>

          {/* Only when the selection is in code, block or inline.
           *
           * Somebody who marked three words as code and wants them on the
           * clipboard should not have to select them exactly — the button
           * copies the whole run. A code block gets its own button in the
           * corner; this is the inline case. */}
          {codeText !== null && (
            <button
              type="button"
              title={t('format.copyCode')}
              className="toolbar-button"
              onClick={() => void copyCode()}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Is a mark active over the selection?
 *
 * Checks the stored marks at a collapsed cursor and the range otherwise, which
 * are different questions: at a cursor the answer is "would typing be bold",
 * over a range it is "is all of this bold".
 */
function isMarkActive(state: EditorView['state'], name: string): boolean {
  const type = state.schema.marks[name];
  if (!type) return false;
  const { from, to, empty } = state.selection;
  if (empty) {
    return type.isInSet(state.storedMarks ?? state.selection.$from.marks()) !== undefined;
  }
  return state.doc.rangeHasMark(from, to, type);
}
