/**
 * SONE editor — the other half of the edit predicate (ADR-0049).
 *
 * ADR-0049 says a locked page goes through one predicate, `editable`, so that
 * nothing has to remember the lock. That was half true. `editable` is an
 * `EditorView` prop, and ProseMirror consults it for what the *user* does —
 * typing, pasting, dragging, dropping. It is not consulted for a transaction
 * some code dispatches directly, and the interface is full of code that
 * dispatches directly: the gutter menu's delete, every button in the selection
 * toolbar, the table toolbar.
 *
 * So a locked page refused typing and accepted "delete block" from the ⋮⋮ menu.
 * Markus found it by locking a page and deleting its contents anyway.
 *
 * This is the same predicate asked in the place ProseMirror actually asks about
 * every change: `filterTransaction`. Both halves are now fed one function, and
 * a new button that dispatches a command cannot reopen the hole, because it
 * never has to know the lock exists — which is what ADR-0049 claimed and this
 * makes true.
 *
 * It is still a guard and not a permission. What restricts access is a
 * permission (ADR-0026); a lock stops the interface from making a change, not a
 * determined person with the developer tools open, and the server cannot refuse
 * an edit to a CRDT without diverging from its clients (ADR-0002).
 */

import { Plugin, PluginKey, type Transaction } from 'prosemirror-state';
import { ySyncPluginKey } from 'y-prosemirror';

export const editGuardKey = new PluginKey('sone-edit-guard');

/**
 * Refuse a local change to the document while editing is not allowed.
 *
 * @param mayEdit The same function `EditorOptions.editable` is given — rights
 *   and the page lock together. Read on every transaction rather than captured,
 *   because both can change while the document is open.
 */
export function editGuard(mayEdit: () => boolean): Plugin {
  return new Plugin({
    key: editGuardKey,
    filterTransaction: (tr: Transaction) => {
      if (!tr.docChanged) return true;
      if (mayEdit()) return true;

      /*
       * Another client's change is never refused, and neither is the binding's
       * own population of the document at mount.
       *
       * The first for the reason the block lock gives one layer down: an edit
       * that arrives over sync has already happened elsewhere, and rejecting it
       * here would make this client's document differ from everybody else's,
       * which is the divergence ADR-0002 exists to prevent. The second because
       * ySyncPlugin fills an empty ProseMirror document from the Yjs fragment by
       * dispatching a transaction — refusing that would render every locked
       * page blank, which is how this exemption came to be tested rather than
       * assumed.
       */
      if (tr.getMeta(ySyncPluginKey) !== undefined) return true;

      /*
       * Housekeeping the editor does to itself.
       *
       * `blockIds` gives an arriving block an id and `fixTables` repairs a
       * table's shape; both mark themselves with `addToHistory: false`, and
       * both run in response to somebody else's edit. Refusing them would leave
       * a locked page holding blocks without ids — invisible until somebody
       * unlocked it and found the document broken.
       */
      if (tr.getMeta('addToHistory') === false) return true;

      return false;
    },
  });
}
