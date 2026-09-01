/**
 * SONE web — putting a video in a page (ADR-0037).
 *
 * Three sources need one moment of asking, because they arrive differently: a
 * file is chosen from a disk, and a link is typed or pasted. The file block gets
 * away with opening a picker directly; a video cannot, or two of its three
 * sources would be unreachable.
 *
 * Deliberately not a tabbed dialog. One field and one button, and the field
 * decides for itself what it was given: a provider on the allowlist becomes an
 * embed, a manifest becomes a stream, and anything else says so rather than being
 * quietly accepted. Asking somebody to first say *which kind* of address they are
 * about to paste is asking them to know something we can read.
 */

import { useT } from '../i18n/useT.tsx';
import { readStreamLink, readVideoLink } from '@sone/core';
import { useEffect, useRef, useState, type ReactElement } from 'react';

export function VideoDialog({
  onUpload,
  onLink,
  onClose,
}: {
  /** Open a file picker. Closes the dialog: the picker is the next step. */
  onUpload: () => void;
  /** Insert from an address. Returns false if the allowlist refused it. */
  onLink: (url: string) => boolean;
  onClose: () => void;
}): ReactElement {
  const { t } = useT();
  const [url, setUrl] = useState('');
  const [refused, setRefused] = useState(false);
  const field = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    field.current?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const trimmed = url.trim();
  // Read as it is typed, so the dialog can say what it will do with what is in
  // the field before anybody commits to it.
  const embed = trimmed === '' ? null : readVideoLink(trimmed);
  const stream = trimmed === '' || embed ? null : readStreamLink(trimmed);
  const usable = embed !== null || stream !== null;

  const submit = (): void => {
    if (!usable) {
      setRefused(true);
      return;
    }
    if (onLink(trimmed)) onClose();
    else setRefused(true);
  };

  return (
    <div className="video-dialog" role="dialog" aria-label={t('video.add')} aria-modal="true">
      <button type="button" className="btn" onClick={onUpload}>
        {t('video.upload')}
      </button>

      <p className="video-dialog-or">{t('video.orPaste')}</p>

      <input
        ref={field}
        type="url"
        className="video-dialog-url"
        placeholder={t('video.addressPlaceholder')}
        aria-label={t('video.address')}
        value={url}
        onChange={(event) => {
          setRefused(false);
          setUrl(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            submit();
          }
        }}
      />

      {/* What this address is, decided by the same allowlist that will draw it.
        * Said before the block exists, because a refusal at this moment is a
        * correction and a refusal afterwards is a broken block. */}
      {embed && (
        <p className="muted video-dialog-verdict">
          A {embed.provider === 'youtube' ? 'YouTube' : embed.provider === 'vimeo' ? 'Vimeo' : 'PeerTube'} video.
          Nothing is loaded from them until somebody presses play.
        </p>
      )}
      {stream && (
        <p className="muted video-dialog-verdict">
          A live {stream.kind === 'hls' ? 'HLS' : 'DASH'} stream, played in the page.
        </p>
      )}
      {refused && !usable && (
        <p className="error video-dialog-verdict">
          {t('video.providers')}
        </p>
      )}

      <div className="video-dialog-actions">
        <button type="button" className="btn" onClick={onClose}>
          {t('action.cancel')}
        </button>
        <button type="button" className="btn primary" disabled={!usable} onClick={submit}>
          Add
        </button>
      </div>
    </div>
  );
}
