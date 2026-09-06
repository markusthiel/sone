/**
 * SONE server — the mark, for a mail (ADR-0132).
 *
 * `brand/logo/png/sone-logo-horizontal-light-400.png`, base64 in a module.
 *
 * Not read from disk, and that is the point: `tsc` emits JavaScript and copies
 * nothing, so a PNG beside this file would exist in the repository and not in
 * the image. A path that resolves in development and not in the container is
 * the kind of failure that reaches production, and a mail is exactly where it
 * would be noticed last.
 *
 * Generated, never edited. It comes out of `tools/brand/`, which draws it from
 * `Logo.tsx` and `styles.css`, so it cannot drift from the interface; changing
 * the mark means regenerating the package and re-encoding this one file.
 *
 * The light build — dark bars, the accent green — because it is placed on a
 * pale chip in the letter rather than straight on the paper. A mail client in
 * dark mode darkens the paper and cannot recolour an image, so the chip is what
 * keeps it legible in both.
 */

/** The bytes, as a mail attachment carries them. */
export const SONE_MARK_PNG =
  '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';

export const SONE_MARK_MIME = 'image/png';
