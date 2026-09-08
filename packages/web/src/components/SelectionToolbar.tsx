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
  isFollowable,
  isSameOrigin,
  linkAt,
  normaliseHref,
  removeLink,
  schema,
  setLink,
} from '@sone/editor';
import { useT } from '../i18n/useT.tsx';
import { anchorFromSelection, type CommentAnchor } from '@sone/editor';
import { toggleMark } from 'prosemirror-commands';
import type { EditorView } from 'prosemirror-view';
import { useEffect, useRef, useState, type ReactElement } from 'react';

import { useViewportChanges } from '../hooks/useViewportChanges.ts';
import { keepsEditorSelection } from './popup.ts';

interface SelectionToolbarProps {
  view: EditorView;
  /**
   * Called with an anchor for the current selection (ADR-0046).
   *
   * Absent for somebody who may only read, which is how the button disappears
   * rather than appearing and refusing.
   */
  onComment?: (anchor: CommentAnchor) => void;
  /**
   * Whether the buttons that change the text belong here (ADR-0049).
   *
   * False on a locked page, where the toolbar itself stays: a locked page under
   * review is the case comments exist for, and a comment is about the page
   * rather than part of it. Bold, italic and link are not.
   *
   * The buttons are removed rather than disabled because the plugin below them
   * would refuse the change anyway (editGuard), and a row of greyed-out letters
   * over a selection says less than an empty space does. Defaults to true so a
   * caller that has no lock to consider says nothing.
   */
  canFormat?: boolean;
  /** Bumped on every transaction, so the toolbar follows the selection. */
  revision: number;
}

const GAP = 8;
const MARGIN = 8;

export function SelectionToolbar({
  view,
  revision,
  onComment,
  canFormat = true,
}: SelectionToolbarProps): ReactElement | null {
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

  /**
   * With nothing selected, a caret inside a link is enough (ADR-0157).
   *
   * Reported as *„wenn man im Text einen Link setzt dann kann man den nicht
   * öffnen"*. In an editable view a plain click has to keep putting the caret
   * in the word — a link nobody can correct is worse than one nobody can follow
   * — so the click is answered here instead: the same overlay, over the link,
   * offering the four things somebody wants from one.
   *
   * The same component rather than a second card, because the hard half is the
   * positioning: measuring against a range that may wrap a line, retrying when
   * a coordinate is stale for a frame, and following the column when a panel
   * opens (ADR-0083). A second copy of that is a second copy to get wrong.
   */
  const onlyALink = empty && existingLink !== null && !editingLink;

  // Kept open across the transaction that selects the link, so Mod-K can leave
  // a selection behind and have the editor appear over it.
  const visible = !empty || editingLink || onlyALink;
  const codeText = codeTextAt(state);

  // A scroll moves the selection under the toolbar without producing a
  // transaction, so nothing else would prompt a re-measure.
  // The editor's element too, and not only the window: the reading column
  // re-centres when the sidebar opens or closes, without any window event and
  // without changing its own width (ADR-0083). Every overlay measured against
  // the text drifts the same way.
  const viewportToken = useViewportChanges(visible, view.dom as HTMLElement);

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
      // The link's own extent when there is no selection, so the card sits over
      // the words rather than over the one character the caret is in.
      const measureFrom = onlyALink && existingLink ? existingLink.from : state.selection.from;
      const measureTo = onlyALink && existingLink ? existingLink.to : state.selection.to;
      const start = view.coordsAtPos(measureFrom);
      const end = view.coordsAtPos(measureTo);
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
  }, [view, state, revision, visible, editingLink, onlyALink, existingLink?.from, existingLink?.to, retryToken, viewportToken]);

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
    // The letter stays as it is — B, I and S are shapes people recognise, not
    // words to translate. The tooltip that says what the button does is a key.
    { name: 'strong', label: 'B', title: 'format.bold', style: { fontWeight: 700 } },
    { name: 'em', label: 'I', title: 'format.italic', style: { fontStyle: 'italic' } },
    {
      name: 'strikethrough',
      label: 'S',
      title: 'format.strikethrough',
      style: { textDecoration: 'line-through' },
    },
    {
      name: 'inlineCode',
      label: '‹›',
      title: 'format.code',
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
      {onlyALink && existingLink ? (
        /*
         * What somebody wants from a link they are standing in (ADR-0157).
         *
         * The address is shown because a link's words rarely say where it goes,
         * and the four verbs are the ones a browser's own context menu offers —
         * open, copy, change, remove. Nothing here is new vocabulary.
         *
         * `Bearbeiten` hands over to the editor below rather than being a fifth
         * thing: it is the same box `Mod-K` opens, reached by the other door.
         */
        <div className="link-card">
          <span className="link-card-href" title={existingLink.href}>
            {existingLink.href}
          </span>
          <span className="toolbar-divider" aria-hidden="true" />
          {/* An anchor, not a button (ADR-0171).
            *
            * *Öffnen* called `openLink`, which is `window.open(…, '_blank')` —
            * so following a link **home** from the card opened a second copy of
            * the application, with its own sync connection and none of the
            * reading position. The same fault ADR-0170 fixed in the links
            * panel, in the other place that follows a link.
            *
            * As a real anchor, one address gets one treatment: the
            * application's interception answers a link home exactly as it
            * answers one in the text, and the browser opens an external one in
            * its own tab with the `noopener` pair `openLink` existed to give.
            * `rel` on the element rather than a call, because that is where a
            * browser looks for it.
            *
            * An address that executes is drawn as a disabled row instead, the
            * shape the links panel already uses for the same refusal — the
            * schema closed that door, and a CRDT keeps what reached it before
            * the door was there (ADR-0157). */}
          {isFollowable(existingLink.href) ? (
            <a
              className="toolbar-button"
              href={existingLink.href}
              {...(isSameOrigin(existingLink.href, window.location.origin)
                ? {}
                : { target: '_blank', rel: 'noopener noreferrer' })}
            >
              {t('format.linkOpen')}
            </a>
          ) : (
            <span className="toolbar-button" aria-disabled="true" title={t('panel.linkRefused')}>
              {t('format.linkOpen')}
            </span>
          )}
          <button
            type="button"
            className="toolbar-button"
            onClick={() => {
              void (async () => {
                try {
                  await navigator.clipboard.writeText(existingLink.href);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1400);
                } catch {
                  // Refused, or plain http where it does not exist at all. The
                  // address is on screen to copy by hand, which is why it is
                  // shown rather than summarised.
                }
              })();
            }}
          >
            {copied ? t('format.linkCopied') : t('format.linkCopy')}
          </button>
          {canFormat && (
            <>
              <button
                type="button"
                className="toolbar-button"
                onClick={() => {
                  setHref(existingLink.href);
                  setEditingLink(true);
                }}
              >
                {t('format.linkEdit')}
              </button>
              <button
                type="button"
                className="toolbar-button"
                onClick={() => run(removeLink)}
              >
                {t('format.removeLink')}
              </button>
            </>
          )}
        </div>
      ) : editingLink && canFormat ? (
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
          {canFormat &&
            marks.map((mark) => {
              const type = schema.marks[mark.name];
              if (!type) return null;
              const active = isMarkActive(state, mark.name);
              return (
                <button
                  key={mark.name}
                  type="button"
                  title={t(mark.title)}
                  aria-pressed={active}
                  className="toolbar-button"
                  style={mark.style}
                  onClick={() => run(toggleMark(type))}
                >
                  {mark.label}
                </button>
              );
            })}

          {onComment && (
            <>
              {/* No divider before the first thing in the bar: on a locked page
                  the formatting buttons are gone and a rule would hang there
                  against nothing. */}
              {canFormat && <span className="toolbar-divider" aria-hidden="true" />}
              <button
                type="button"
                className="toolbar-button"
                title={t('comment.start')}
                onClick={() => {
                  const anchor = anchorFromSelection(view.state);
                  // Null for an empty selection, which this toolbar does not
                  // appear for — but the state can change between the render and
                  // the press, and a comment on nothing is not worth guessing at.
                  if (anchor) onComment(anchor);
                }}
              >
                {t('comment.start')}
              </button>
            </>
          )}

          {canFormat && (
            <>
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
            </>
          )}

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
              {copied ? t('format.copied') : t('format.copy')}
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
