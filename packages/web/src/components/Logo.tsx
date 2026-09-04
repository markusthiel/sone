/**
 * The mark.
 *
 * An indented stack of bars: the page tree, drawn as a glyph. Four levels, and
 * the third one carries the accent — the level you are on. Nothing about it is
 * a letter, which is deliberate: an S in a rounded gradient is the one logo
 * every tool built since 2020 already has.
 *
 * The accent bar is `var(--accent)` rather than a fixed colour, so the mark
 * takes the workspace's own accent (ADR-0023) and a blue workspace has a blue
 * mark. It also keeps the mark out of the way of `--danger`, which is the warm
 * red the interface already spends on destructive things.
 *
 * `currentColor` for the rest, so the mark inherits from whatever it sits in
 * and needs no dark-mode variant.
 *
 * Four bars and not three, at every size the interface draws it. A three-bar
 * build was tried for the rail and is a hamburger: three stacked lines is the
 * one thing a small mark in the top-left corner must not be. The fourth bar
 * steps back out, and that step is what makes it a tree rather than a menu.
 *
 * The favicon and the installed icons are the same drawing again, as files
 * under public/ — at 16px the four bars close up, so those carry a three-bar
 * build, and they cannot reference a custom property either, so they carry the
 * default accent rather than the workspace's.
 */

import type { ReactElement } from 'react';

export function SoneMark({
  size = 26,
  title,
}: {
  size?: number;
  /** Given only where the mark is the sole content of a link or button. */
  title?: string;
}): ReactElement {
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <rect x="12" y="16" width="76" height="9" fill="currentColor" />
      <rect x="28" y="37" width="60" height="9" fill="currentColor" />
      <rect x="44" y="58" width="44" height="9" fill="var(--accent)" />
      <rect x="28" y="79" width="60" height="9" fill="currentColor" />
    </svg>
  );
}
