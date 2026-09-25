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
 * under public/ — four bars there too, on a paper-coloured tile (ADR-0201).
 * They carried a three-bar build for legibility at 16px, which meant the one
 * place somebody sees nothing but the small picture showed something that was
 * not the mark. They cannot reference a custom property either, so they carry
 * the default accent rather than the workspace's.
 */

import { type ReactElement } from 'react';

import { useGroundTone } from '../hooks/useGroundTone.ts';
import { useInstance } from './Instance.tsx';

/**
 * The instance's own mark, when it has one (ADR-0123).
 *
 * A context rather than a prop, because the mark is drawn in the rail, in the
 * mode bar, on the sign-in screen and beside every workspace in the switcher —
 * threading a URL through all of them is four chances to draw two different
 * logos on one screen.
 *
 * Null is the ordinary state and means the drawing below, which is why nothing
 * here waits for an answer: an instance with no logo and an instance whose
 * `/api/instance` has not arrived yet look the same, and both are correct.
 */
/*
 * The logo comes from the instance context now (ADR-0139).
 *
 * It was a context of its own, for the reason `App` states where it provides
 * it: four routes to the mark are four chances to show two different logos on
 * one screen. The same argument turned out to apply to whether this instance
 * can send mail — and there it had already gone wrong — so the two facts share
 * one context rather than growing one each.
 */

/**
 * The mark with the wordmark beside it — the horizontal lockup (ADR-0132).
 *
 * Set in Archivo at 600 with the brand package's tracking, rather than drawn as
 * paths. The delivered files convert the wordmark to outlines because *a file
 * cannot assume a font*; inside the application the font is one of the two this
 * instance serves itself (ADR-0068), so setting it is the same wordmark and not
 * a second drawing of it.
 *
 * An instance with a logo of its own gets that logo and its own name: putting
 * "SONE" beside somebody else's mark would be this software signing their
 * letterhead.
 */
export function SoneLockup({
  size = 28,
  name,
}: {
  size?: number;
  /** What this instance calls itself, shown where it has a mark of its own. */
  name?: string;
}): ReactElement {
  const { logo } = useInstance();
  return (
    <span className="sone-lockup">
      <SoneMark size={size} />
      <span className="sone-wordmark" style={{ fontSize: `${Math.round(size * 0.72)}px` }}>
        {logo ? (name ?? '') : 'SONE'}
      </span>
    </span>
  );
}

export function SoneMark({
  size = 26,
  title,
}: {
  size?: number;
  /** Given only where the mark is the sole content of a link or button. */
  title?: string;
}): ReactElement {
  const { logo, logoOnDark } = useInstance();

  /*
   * Which of two marks this surface gets (ADR-0149).
   *
   * Measured where it is drawn rather than read off the theme: the rail may be
   * painted with a workspace's accent (ADR-0122), so the same instance in the
   * same light theme has a light rail in one workspace and a navy one in the
   * next — *„bei einigen macht das Helle Logo mehr Sinn bei anderen das
   * dunkle"*.
   *
   * With one mark uploaded, that mark is used on every ground. Losing a logo
   * because a workspace changed a colour would be a worse answer than an
   * imperfect contrast, and it is the state every instance is in today.
   */
  const { tone, ref } = useGroundTone();
  const chosen = tone === 'dark' ? (logoOnDark ?? logo) : (logo ?? logoOnDark);

  /*
   * An instance's own mark replaces the drawing rather than sitting beside it.
   *
   * `object-fit: contain` and a square box: a logo is asked for square, and a
   * near-square one is letterboxed rather than stretched. Refusing a 1000×980
   * file would be refusing somebody's logo over twenty pixels.
   *
   * No `width`/`height` attributes beyond the box, and `alt` carries whatever
   * the drawing would have said — the mark is often the only content of a link.
   */
  if (chosen) {
    return (
      <img
        ref={ref}
        className="brand-logo"
        src={chosen}
        width={size}
        height={size}
        alt={title ?? ''}
        aria-hidden={title ? undefined : true}
      />
    );
  }

  return (
    <svg
      ref={ref}
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
