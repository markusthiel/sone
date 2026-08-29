/**
 * SONE web — drawing an entry's icon.
 *
 * A name from the curated list resolves to a Lucide component. Anything else
 * falls back to the tree's own default, which is what an entry has always had:
 * a name that no longer resolves must cost an entry its icon and never its
 * place in the tree.
 */

import { ENTRY_ICONS } from '@sone/core';
import * as lucide from 'lucide-react';
import type { ReactElement } from 'react';

import { FolderIcon, PageIcon } from './icons.tsx';

/** 'folder-open' is exported as FolderOpen. */
function componentFor(name: string): lucide.LucideIcon | null {
  if (!(ENTRY_ICONS as readonly string[]).includes(name)) return null;

  const exported = name
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');

  const found = (lucide as unknown as Record<string, unknown>)[exported];
  return typeof found === 'function' ? (found as lucide.LucideIcon) : null;
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
      style={icon?.color ? { color: `var(--sone-palette-${icon.color})` } : undefined}
    />
  );
}

/** The colour an entry's name should be, or undefined to leave it alone. */
export function titleColorStyle(
  icon: { titleColor?: string } | null,
): { color: string } | undefined {
  return icon?.titleColor ? { color: `var(--sone-palette-${icon.titleColor})` } : undefined;
}
