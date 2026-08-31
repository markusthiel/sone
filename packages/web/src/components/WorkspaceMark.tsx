/**
 * SONE web — how a workspace is recognised in a list (ADR-0030).
 *
 * A chosen icon, or the initial on a tinted square. The fallback is the point:
 * a workspace nobody has decorated should look deliberate rather than
 * unfinished, so the feature adds something instead of making everything before
 * it look incomplete.
 */

import type { ReactElement } from 'react';

import type { WorkspaceIcon } from '../api/client.ts';
import { colorValue } from '@sone/core';
import { EntryIconView } from './EntryIconView.tsx';

export function WorkspaceMark({
  name,
  icon,
}: {
  name: string;
  icon: WorkspaceIcon | null;
}): ReactElement {
  const chosen = icon?.icon ? { kind: 'icon', value: icon.icon } : null;

  return (
    <span
      className="workspace-mark"
      aria-hidden="true"
      // Through `colorValue`, not raw.
      //
      // A stored colour is either a palette name or a hex value, and a palette
      // name is not a CSS colour — it resolves to a custom property. Setting it
      // raw worked for the custom colours and silently did nothing for the
      // eight in the palette, which is the worse half to get wrong: those are
      // the ones people pick.
      style={colorValue(icon?.iconColor) ? { color: colorValue(icon?.iconColor) } : undefined}
    >
      {chosen ? (
        <EntryIconView icon={chosen} kind="folder" />
      ) : (
        (name.trim().charAt(0).toUpperCase() || '?')
      )}
    </span>
  );
}
