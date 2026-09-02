/**
 * SONE web — what the `+` on a folder offers.
 *
 * It used to make a page and nothing else, which was right while a page was the
 * only thing you could put in a folder. A canvas is a third kind of entry
 * (ADR-0043), and hiding it in the ⋮ menu while the `+` silently means "page"
 * teaches people that `+` is the way and then withholds two thirds of it.
 *
 * The order is how often each is wanted: a page, a canvas, a folder. Not
 * alphabetical, and not the order they were built in.
 */

import { useEffect, useRef, useState, type ReactElement } from 'react';

import { api } from '../api/client.ts';

import { useT } from '../i18n/useT.tsx';
import { BrushIcon, FolderIcon, PageIcon, PlusIcon } from './icons.tsx';

export function AddEntryMenu({
  title,
  workspaceId,
  onCreate,
}: {
  /** The folder this adds to, for the label. */
  title: string;
  workspaceId: string;
  onCreate: (kind: 'page' | 'canvas' | 'folder', templateId?: string) => void;
}): ReactElement {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);

  /**
   * The shapes this workspace offers (ADR-0045).
   *
   * Fetched when the menu opens rather than held with the tree: it is a short
   * list read at the moment of a decision, and a workspace with none should not
   * pay for asking on every load.
   */
  const [templates, setTemplates] = useState<
    Array<{ id: string; title: string; kind: 'page' | 'canvas' }>
  >([]);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void api
      .templates(workspaceId)
      .then((result) => {
        if (!cancelled) setTemplates(result.templates);
      })
      .catch(() => {
        // Silent: the menu's own three entries still work, and a failed list of
        // templates is not worth an error over a menu.
        if (!cancelled) setTemplates([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, workspaceId]);

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent): void => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  return (
    <div className="tree-add-wrap" ref={box}>
      <button
        className="tree-add"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        title={t('sidebar.addIn', { title })}
        aria-label={t('sidebar.addIn', { title })}
        onClick={(event) => {
          // The row underneath opens the folder; this button does not.
          event.stopPropagation();
          setOpen((previous) => !previous);
        }}
      >
        <PlusIcon />
      </button>

      {/* The panel is the ⋮ menu's, in every respect.
        *
        * Mine opened rightward, out of the sidebar and under the content area —
        * which is a stacking context, so it painted over the menu. The ⋮ menu
        * never had that problem because it opens leftward and stays over the
        * sidebar. Two popups a row apart should not differ in width, alignment
        * or which way they open, and the fix for the clipping is the same thing
        * as the fix for the inconsistency. */}
      {open && (
        <div className="entry-menu tree-add-menu" role="menu">
          {(
            [
              // The marks the tree draws these with, so the menu says what each
              // one *is* rather than saying "add" three times.
              ['page', 'entry.newPage', PageIcon],
              ['canvas', 'canvas.new', BrushIcon],
              ['folder', 'entry.newFolder', FolderIcon],
            ] as const
          ).map(([kind, key, Mark]) => (
            <button
              key={kind}
              className="entry-menu-item"
              type="button"
              role="menuitem"
              onClick={(event) => {
                event.stopPropagation();
                setOpen(false);
                onCreate(kind);
              }}
            >
              <Mark /> {t(key)}
            </button>
          ))}

          {/* And the shapes somebody has already built.
            *
            * Under their own heading and after the blank ones, because a blank
            * page is what most presses of this button want. A workspace with no
            * templates shows no heading — a feature that advertises its own
            * emptiness teaches people to ignore that part of the menu. */}
          {templates.length > 0 && (
            <>
              <hr className="entry-menu-rule" />
              <span className="entry-menu-label">{t('template.heading')}</span>
              {templates.map((template) => (
                <button
                  key={template.id}
                  className="entry-menu-item"
                  type="button"
                  role="menuitem"
                  onClick={(event) => {
                    event.stopPropagation();
                    setOpen(false);
                    onCreate(template.kind, template.id);
                  }}
                >
                  {template.kind === 'canvas' ? <BrushIcon /> : <PageIcon />}
                  <span>{template.title || t('entry.untitled')}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
