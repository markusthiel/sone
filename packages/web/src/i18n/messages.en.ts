/**
 * SONE web — the message catalogue, in English (ADR-0041).
 *
 * English is the source: every other locale is typed against this object, so a
 * missing key is a compile error rather than a blank on a screen. Keys name a
 * place rather than quoting the sentence, because the wording changes far more
 * often than the meaning does.
 *
 * The migration is a file at a time (see i18n.test.ts, which holds the list of
 * files that must stay clean), so this catalogue grows rather than arriving
 * complete.
 */

export const en = {
  // --- the account menu at the foot of a column ---------------------------
  'account.label': '{name} — account and settings',
  'account.yourSettings': 'Your settings',
  'account.thisWorkspace': 'This workspace',
  'account.administration': 'Administration',
  'account.trash': 'Trash',
  'account.signOut': 'Sign out',
  'account.version': 'Version and licence',

  // --- moving an entry to another workspace (ADR-0038) --------------------
  'move.workspace.title': 'Move to another workspace',
  'move.workspace.label': 'Move {title} to another workspace',
  'move.workspace.nowhere':
    'There is nowhere to move this. An entry can only go to a workspace you own or administer.',
  'move.workspace.working': 'Working out what this moves…',
  'move.workspace.intro': 'Moving {title} to {workspace}:',
  'move.workspace.again':
    'Moving it back later is another move, with the same kinds of consequence.',
  'move.workspace.entries': '{count, plural, one {# entry} other {# entries}} will move.',
  'move.workspace.files':
    '{count, plural, one {# file} other {# files}} will move with them.',
  'move.workspace.restrictions':
    '{count, plural, one {# entry} other {# entries}} will arrive without the restriction ' +
    'held now — everyone in the new workspace will be able to read {count, plural, one {it} other {them}}.',
  'move.workspace.shareLinks':
    '{count, plural, one {# share link} other {# share links}} will stop working.',
  'move.workspace.references':
    '{count, plural, one {# link} other {# links}} between these entries and ones staying ' +
    'behind will be severed.',
  'move.workspace.favourites':
    '{count, plural, one {# favourite} other {# favourites}} held by people who are not in ' +
    'the new workspace will be dropped.',

  // --- what a dialog's buttons say ---------------------------------------
  'action.cancel': 'Cancel',
  'action.move': 'Move',
  'action.moving': 'Moving…',
} as const;

export type MessageKey = keyof typeof en;
