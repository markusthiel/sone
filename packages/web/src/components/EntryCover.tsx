/**
 * SONE web — a cover above the heading (ADR-0117).
 *
 * A picture, a colour or a gradient, on a page or a folder. Asked for as
 * *„über der Seitenüberschrift, beim Drüberfahren"*, with own uploads only and
 * a colour as the alternative to a picture.
 *
 * ## One component, two callers, and why
 *
 * A page has its document open and writes its own cover into it, the way the
 * title beside it does: instant, and it reaches everybody else through sync
 * like any other edit. A folder has no document open at all — the folder view
 * renders a tree node and renames through a route — so it writes through
 * `api.setEntryCover`.
 *
 * That difference stops at `onChange`. Everything above it — what a cover may
 * be, what it looks like, how it is chosen — is here once, because a folder
 * whose covers looked or behaved differently from a page's would be the same
 * feature built twice.
 *
 * ## The controls appear on hover, and are still reachable without one
 *
 * They are in the document at all times and revealed by opacity, so Tab lands
 * on them and `:focus-within` shows them. A control that only exists while a
 * pointer is over it is a control a keyboard cannot reach — and this is the
 * only way to remove a cover.
 */

import {
  THEME_COLORS,
  colorValue,
  coverBackground,
  type ChosenColor,
  type CoverHeight,
  type CoverWidth,
  type EntryCover,
} from '@sone/core';
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';

import { ApiError, api } from '../api/client.ts';
import { useT } from '../i18n/useT.tsx';
import { webVariant } from '../lib/imageVariant.ts';
import { messageFor } from './Auth.tsx';

/**
 * The gradients offered, as pairs from the workspace's own palette.
 *
 * Named colours rather than literals, so a workspace that has changed its blue
 * gets its blue here too — the argument the canvas ink palette makes
 * (ADR-0030). Six pairs rather than all fifty-six: this is a row somebody
 * glances at, and a grid of every combination is a colour-picking task rather
 * than a choice.
 */
const GRADIENTS: ReadonlyArray<{ from: ChosenColor; to: ChosenColor }> = [
  { from: 'blue', to: 'purple' },
  { from: 'purple', to: 'pink' },
  { from: 'pink', to: 'orange' },
  { from: 'orange', to: 'yellow' },
  { from: 'green', to: 'blue' },
  { from: 'grey', to: 'blue' },
];

interface EntryCoverProps {
  /** What is set now, or null. */
  cover: EntryCover | null;
  /**
   * Which entry this is, for the upload.
   *
   * A cover picture is a file on the entry it covers, so it is served under the
   * same access check as any other attachment — a cover on a page nobody may
   * see is a picture nobody may fetch.
   */
  pageId: string;
  /** Absent when this person may not change it: no controls at all, then. */
  onChange?: (cover: EntryCover | null) => void;
  /** The heading, which the hover region has to include. */
  children: ReactNode;
}

export function EntryCoverHead({
  cover,
  pageId,
  onChange,
  children,
}: EntryCoverProps): ReactElement {
  const { t } = useT();
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const region = useRef<HTMLDivElement | null>(null);

  // Close the picker on a click elsewhere and on Escape.
  //
  // Both, because they are different exits: a click means "I am doing
  // something else now", and Escape means "not this" without moving the
  // pointer. A panel that only closes by choosing something is a panel
  // somebody has to choose out of.
  useEffect(() => {
    if (!picking) return undefined;
    const away = (event: MouseEvent): void => {
      if (!region.current?.contains(event.target as Node)) setPicking(false);
    };
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setPicking(false);
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', key);
    };
  }, [picking]);

  const choose = (next: EntryCover | null): void => {
    setPicking(false);
    setError(null);
    onChange?.(next);
  };

  async function upload(file: File): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      // The original first, because it is the one the cover refers to and the
      // one that must exist even if everything after this fails. The smaller
      // copy follows in the background and `/api/files/:id` serves it once it
      // is there — the arrangement the image block already uses (ADR-0029), so
      // "verkleinert, damit sie schnell lädt" needs no machinery of its own.
      const uploaded = await api.uploadFile(pageId, file);
      void webVariant(file)
        .then((smaller) => (smaller ? api.uploadFile(pageId, smaller, uploaded.id) : null))
        .catch(() => null);
      choose({ kind: 'image', url: uploaded.url });
    } catch (caught) {
      setError(messageFor(caught instanceof ApiError ? caught.code : 'network_error'));
    } finally {
      setBusy(false);
    }
  }

  const background = coverBackground(cover);

  /*
   * Change one part of the shape, keeping the cover it is the shape of
   * (ADR-0162).
   *
   * The default is written as **absence** — `undefined` deletes the key — the
   * way `template` and `locked` say the same thing. A cover that spelled out
   * `width: 'column'` would claim a decision nobody made, and would differ from
   * every cover written before this round while looking identical.
   *
   * And it does not close the picker. Choosing a picture is one act and then
   * you are done; trying a height is three clicks in a row, and a panel that
   * shut after each one would have to be reopened twice to answer one question.
   */
  const adjust = (part: {
    width?: CoverWidth | undefined;
    height?: CoverHeight | undefined;
  }): void => {
    if (!cover) return;
    // Deleted rather than spread: `exactOptionalPropertyTypes` is on, and it is
    // right to be — `{ width: undefined }` and no width at all are the same
    // cover to a reader and two different documents to a CRDT.
    const next: EntryCover = { ...cover };
    if ('width' in part) {
      if (part.width) next.width = part.width;
      else delete next.width;
    }
    if ('height' in part) {
      if (part.height) next.height = part.height;
      else delete next.height;
    }
    setError(null);
    onChange?.(next);
  };

  return (
    <div className="entry-head" ref={region}>
      {cover && (
        <div
          className="entry-cover"
          data-kind={cover.kind}
          // Absent rather than a default written into the markup: what the
          // stylesheet draws for a band that says nothing is what a cover has
          // always looked like, and that has to stay one rule rather than two
          // that agree.
          data-width={cover.width}
          data-height={cover.height}
          style={{ background }}
        >
          {cover.kind === 'image' && (
            // An `<img>` rather than a background image: the src is escaped by
            // React, it can carry alternative text, and it can be told to load
            // eagerly — which is right here, because this is the first thing on
            // the page rather than something below the fold.
            <img className="entry-cover-image" src={cover.url} alt="" />
          )}
        </div>
      )}

      {onChange && (
        <div className="entry-cover-actions" data-over={cover ? 'cover' : undefined}>
          <button
            type="button"
            className="entry-cover-button"
            aria-expanded={picking}
            onClick={() => setPicking((open) => !open)}
          >
            {cover ? t('cover.change') : t('cover.add')}
          </button>
          {cover && (
            <button type="button" className="entry-cover-button" onClick={() => choose(null)}>
              {t('cover.remove')}
            </button>
          )}
        </div>
      )}

      {picking && onChange && (
        <div className="entry-cover-picker">
          <label className="entry-cover-upload">
            {busy ? t('cover.uploading') : t('cover.upload')}
            <input
              type="file"
              // The three the browser can shrink, plus gif and avif which it
              // cannot — those upload whole rather than being refused, which is
              // what `webVariant` returning null already means.
              accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                // Cleared so choosing the same file twice fires again — a
                // second attempt after a failure is the common case.
                event.target.value = '';
                if (file) void upload(file);
              }}
            />
          </label>

          <p className="entry-cover-group">{t('cover.colors')}</p>
          <div className="entry-cover-swatches">
            {THEME_COLORS.map((name) => (
              <button
                key={name}
                type="button"
                className="entry-cover-swatch"
                style={{ background: colorValue(name) }}
                title={name}
                aria-label={name}
                onClick={() => choose({ kind: 'color', color: name })}
              />
            ))}
            {/* And any colour at all, for the one somebody has in mind that a
                palette of eight does not contain. */}
            <input
              type="color"
              className="entry-cover-own"
              aria-label={t('cover.own')}
              title={t('cover.own')}
              onChange={(event) =>
                choose({ kind: 'color', color: event.target.value as ChosenColor })
              }
            />
          </div>

          <p className="entry-cover-group">{t('cover.gradients')}</p>
          <div className="entry-cover-swatches">
            {GRADIENTS.map((pair) => (
              <button
                key={`${pair.from}-${pair.to}`}
                type="button"
                className="entry-cover-swatch"
                style={{ background: coverBackground({ kind: 'gradient', ...pair }) }}
                title={`${pair.from} · ${pair.to}`}
                aria-label={`${pair.from} · ${pair.to}`}
                onClick={() => choose({ kind: 'gradient', ...pair })}
              />
            ))}
          </div>

          {/* How wide it runs and how tall it is (ADR-0162) — offered only
              once there is a cover, because the width of nothing is nothing. */}
          {cover && (
            <>
              <p className="entry-cover-group">{t('cover.width')}</p>
              <div className="entry-cover-shape" role="group" aria-label={t('cover.width')}>
                {/* Two, not the three a block has. The block menu already
                    refuses the middle step for an image, in its own words:
                    all three read as the width of the text or a bit more, and
                    a picture is either in the column or across the page. */}
                {(
                  [
                    { id: undefined, label: 'block.width.column' },
                    { id: 'full', label: 'block.width.full' },
                  ] as const
                ).map((choice) => (
                  <button
                    key={choice.label}
                    type="button"
                    role="radio"
                    aria-checked={(cover.width ?? undefined) === choice.id}
                    className={
                      (cover.width ?? undefined) === choice.id
                        ? 'entry-cover-choice current'
                        : 'entry-cover-choice'
                    }
                    onClick={() => adjust({ width: choice.id })}
                  >
                    {t(choice.label)}
                  </button>
                ))}
              </div>

              <p className="entry-cover-group">{t('cover.height')}</p>
              <div className="entry-cover-shape" role="group" aria-label={t('cover.height')}>
                {(
                  [
                    { id: 'slim', label: 'cover.height.slim' },
                    { id: undefined, label: 'cover.height.medium' },
                    { id: 'tall', label: 'cover.height.tall' },
                  ] as const
                ).map((choice) => (
                  <button
                    key={choice.label}
                    type="button"
                    role="radio"
                    // The middle one is the default, so it is the current one
                    // both when it is chosen and when nothing has been.
                    aria-checked={(cover.height ?? undefined) === choice.id}
                    className={
                      (cover.height ?? undefined) === choice.id
                        ? 'entry-cover-choice current'
                        : 'entry-cover-choice'
                    }
                    onClick={() => adjust({ height: choice.id })}
                  >
                    {t(choice.label)}
                  </button>
                ))}
              </div>
            </>
          )}

          {error && <p className="error">{error}</p>}
        </div>
      )}

      {children}
    </div>
  );
}
