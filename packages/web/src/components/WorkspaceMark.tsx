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
      // The icon's colour, separately from the text's — the same split entries
      // have, because somebody who has decorated a folder already knows it.
      style={icon?.iconColor ? { color: icon.iconColor } : undefined}
    >
      {chosen ? (
        <EntryIconView icon={chosen} kind="folder" />
      ) : (
        (name.trim().charAt(0).toUpperCase() || '?')
      )}
    </span>
  );
}
