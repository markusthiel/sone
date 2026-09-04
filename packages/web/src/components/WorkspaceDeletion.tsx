/**
 * SONE web — deleting a workspace (ADR-0027, ADR-0067).
 *
 * Lifted out of `WorkspaceDetail` so the one workspace screen can hold it. It
 * was reachable only from the administration, which meant an owner looking
 * after their own workspace could not delete it — one half of the drift
 * ADR-0067 is fixing.
 *
 * **Present and disabled rather than absent when somebody may not use it.**
 * That is ADR-0067's rule and this is its one exception, in the other
 * direction: a destructive control that appears the moment somebody is promoted
 * is a control they meet by accident. Somebody who may not delete sees that
 * deleting exists, is not theirs, and what it would do.
 */

import { useState, type ReactElement } from 'react';

import { ApiError, api } from '../api/client.ts';
import { useT } from '../i18n/useT.tsx';
import { messageFor } from './Auth.tsx';

export function WorkspaceDeletion({
  workspaceId,
  name,
  canDelete,
  onDeleted,
}: {
  workspaceId: string;
  name: string;
  canDelete: boolean;
  onDeleted: () => void;
}): ReactElement {
  const { t } = useT();
  const [confirmName, setConfirmName] = useState('');
  const [error, setError] = useState<string | null>(null);

  return (
    <section className="settings-section">
      {/* Asking for the name rather than confirming in a dialog.
        *
        * Those are dismissed by the same reflex that opened them, and this takes
        * everybody's pages with it. Typing the name is a moment of reading what
        * you are about to do (ADR-0027).
        *
        * Nothing is removed when it is marked — it disappears for its members
        * and can be put back — and the note says so, because "delete" that means
        * "delete later" is worse than either if nobody says which. */}
      <h2>{t('workspaces.delete')}</h2>
      <p className="settings-note">{t('workspaces.delete.note')}</p>

      {!canDelete && <p className="settings-note">{t('workspace.delete.notYours')}</p>}

      <div className="field">
        <label htmlFor="confirm-name">{t('workspaces.confirmName')}</label>
        <input
          id="confirm-name"
          value={confirmName}
          placeholder={name}
          disabled={!canDelete}
          onChange={(event) => setConfirmName(event.target.value)}
        />
      </div>

      <div className="settings-actions">
        <button
          type="button"
          className="btn danger"
          // The typed name has to match whatever the rights say: a button that
          // is enabled by a right alone would be one click from gone.
          disabled={!canDelete || confirmName.trim() !== name}
          onClick={() => {
            void api
              .setWorkspaceDeletion(workspaceId, { confirmName: confirmName.trim() })
              .then(onDeleted)
              .catch((err: unknown) => {
                setError(err instanceof ApiError ? err.code : 'network_error');
              });
          }}
        >
          {t('workspaces.delete')}
        </button>
      </div>

      {error && <p className="error">{messageFor(error)}</p>}
    </section>
  );
}
