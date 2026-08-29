/**
 * SONE web — drawing an entry's icon.
 *
 * A name from the curated list resolves to a Lucide component. Anything else
 * falls back to the tree's own default, which is what an entry has always had:
 * a name that no longer resolves must cost an entry its icon and never its
 * place in the tree.
 */

import { colorValue } from '@sone/core';
import * as lucide from 'lucide-react';
import type { ReactElement } from 'react';

import { FolderIcon, PageIcon } from './icons.tsx';

/**
 * Every icon the set exports, as the kebab-case names stored in a document.
 *
 * Derived rather than listed. A hand-kept list was fifty names somebody chose
 * once, and with a filter in the picker there is no reason to choose for
 * anybody: they can search the whole set.
 *
 * Aliases and the `*Icon` duplicates lucide ships are dropped, or the same
 * drawing appears three times under three names.
 */
export const ICON_NAMES: string[] = [
  ...new Set(
    Object.keys(lucide)
      .filter((key) => /^[A-Z]/.test(key) && !key.endsWith('Icon') && !key.startsWith('Lucide'))
      .map(kebab)
      .filter((name) => /^[a-z][a-z0-9-]*$/.test(name)),
  ),
]
  // Kept only if the name maps *back* to something drawable.
  //
  // The conversion is lossy in both directions: `AArrowDown` and `ArrowDownAZ`
  // have capitals that a single split rule cannot restore, and two exports can
  // normalise to one name. Rather than write ever cleverer rules, the round
  // trip decides — a square in the grid that renders as the default icon is
  // indistinguishable from a real choice, which is the failure to avoid.
  .filter((name) => componentFor(name) !== null)
  .sort();

/** Split on both `aB` and `ABc`, so an acronym does not swallow the next word. */
function kebab(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

/** 'folder-open' is exported as FolderOpen. */
function componentFor(name: string): lucide.LucideIcon | null {
  const exported = name
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');

  // A Lucide icon is a forwardRef component, which is an *object* and not a
  // function. Checking for a function rejected every one of them, so every
  // entry fell back to the default page icon — fifty different icons in the
  // picker all drawn as the same sheet of paper, and choosing one changed
  // nothing visible.
  const found = (lucide as unknown as Record<string, unknown>)[exported];
  const usable = typeof found === 'function' || (typeof found === 'object' && found !== null);
  return usable ? (found as lucide.LucideIcon) : null;
}

interface EntryIconProps {
  icon: { kind: string; value: string; color?: string } | null;
  /** Drawn when there is no icon of its own. */
  kind: 'page' | 'folder' | 'row';
}

export function EntryIconView({ icon, kind }: EntryIconProps): ReactElement {
  const Chosen = icon && icon.kind === 'icon' ? componentFor(icon.value) : null;

  if (!Chosen) {
    return kind === 'folder' ? <FolderIcon /> : <PageIcon />;
  }

  return (
    <Chosen
      // Matching the icons it sits beside rather than Lucide's own default, so
      // a chosen icon does not look heavier than the one it replaced.
      size={16}
      strokeWidth={1.75}
      aria-hidden="true"
      // A colour only when one was chosen; otherwise it inherits, which is what
      // lets the tree's own states — selected, muted, dragged — keep working.
      // Through core, so a palette name and a colour of one's own are read the
      // same way here as everywhere else (ADR-0023).
      style={colorValue(icon?.color) ? { color: colorValue(icon?.color) } : undefined}
    />
  );
}

/** The colour an entry's name should be, or undefined to leave it alone. */
export function titleColorStyle(
  icon: { titleColor?: string } | null,
): { color: string } | undefined {
  const color = colorValue(icon?.titleColor);
  return color ? { color } : undefined;
}
