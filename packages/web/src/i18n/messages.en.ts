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

  // --- the sidebar and the tree ------------------------------------------
  'sidebar.label': 'Pages',
  'sidebar.close': 'Close navigation',
  'sidebar.hide': 'Hide the sidebar',
  'sidebar.search': 'Search',
  'sidebar.favourites': 'Favourites',
  'sidebar.newFolder': 'New folder',
  'sidebar.empty': 'No pages yet.',
  'sidebar.rename': 'Rename',
  'sidebar.newPageIn': 'New page inside {title}',
  'sidebar.removeFavourite': 'Remove {title}',

  // --- an entry's own menu -----------------------------------------------
  'entry.menu': 'More for {title}',
  'entry.rename': 'Rename',
  'entry.icon': 'Icon and colour',
  'entry.favourite': 'Add to favourites',
  'entry.unfavourite': 'Remove from favourites',
  'entry.share': 'Share…',
  'entry.move': 'Move to…',
  'entry.moveToWorkspace': 'Move to a workspace…',
  'entry.newPage': 'New page',
  'entry.newFolder': 'New folder',
  'entry.moveUp': 'Move up',
  'entry.moveDown': 'Move down',
  'entry.delete': 'Move to the trash',
  'entry.deleteWithChildren':
    'Move to the trash, with {count, plural, one {# entry} other {# entries}} inside',

  // --- the settings areas and their shell --------------------------------
  'area.you': 'Your settings',
  'area.workspace': 'This workspace',
  'area.instance': 'Administration',
  'settings.navLabel': '{area} settings',
  'settings.back': '‹ Back to your notes',
  'settings.sections': 'Sections',

  // --- your own settings -------------------------------------------------
  'you.profile': 'Profile',
  'you.profile.hint': 'Your name, address and picture',
  'you.signIn': 'Signing in',
  'you.signIn.hint': 'Your password',
  'you.appearance': 'Appearance',
  'you.appearance.hint': 'How SONE looks to you',
  'you.landing': 'Where you land',
  'you.landing.hint': 'The page each workspace opens on',
  'you.about': 'About',
  'you.about.hint': 'Version and licence',

  'you.picture': 'Picture',
  'you.picture.hint': 'Any size — it is shrunk here before it is sent, and shown small.',
  'you.name': 'Name',
  'you.name.hint': 'What other people see beside anything you write here.',
  'you.email': 'Email',
  'you.workspace': 'Workspace',
  'you.workspace.hint': 'Where you are right now.',
  'you.saved': 'Saved.',

  'you.currentPassword': 'Current password',
  'you.newPassword': 'New password',

  'you.theme': 'Theme',
  'you.theme.system': 'Match the system',
  'you.theme.light': 'Light',
  'you.theme.dark': 'Dark',
  'you.interfaceSize': 'Interface text size',
  'you.interfaceSize.hint': 'The sidebar, menus and settings — everything but your writing.',
  'you.editorSize': 'Editor text size',
  'you.editorSize.hint': 'Your writing, and nothing else.',
  'you.thisBrowser': 'This browser',

  'about.server': 'Server',
  'about.documentFormat': 'Document format',
  'about.syncProtocol': 'Sync protocol',
  'about.checking': 'checking…',

  // --- choosing an icon and a colour -------------------------------------
  'icon.heading': 'Icon',
  'icon.search': 'Search icons',
  'icon.default': 'Default icon',
  'icon.colour': 'Icon colour',
  'icon.nameColour': 'Name colour',
  'icon.ownColour': 'A colour of your own',

  // --- what went wrong ---------------------------------------------------
  //
  // The server sends a code and the client owns the wording (ADR-0011). This is
  // the table that used to live in Auth.tsx; it belongs here, which is what
  // ADR-0041 said when it decided error codes stay codes.
  'error.invalid_credentials': 'That email and password combination did not work.',
  'error.rate_limited': 'Too many attempts. Please wait a few minutes and try again.',
  'error.weak_password': 'Passwords need to be at least 12 characters.',
  'error.missing_fields': 'Please fill in every field.',
  'error.invitation_invalid': 'This invitation has expired or has already been used.',
  'error.no_workspace': 'Your account is not a member of any workspace yet.',
  'error.network_error': 'Could not reach the server.',
  'error.invalid_role': 'A share link cannot grant that role.',
  'error.too_many_rows': 'That is more than fifty entries. Paste them in smaller pieces.',
  'error.not_archived': 'That entry is not in the trash.',
  'error.parent_missing':
    'The folder this was in is gone. Restore that folder first, or move this ' +
    'somewhere else.',
  'error.clipboard_unavailable':
    'Could not copy automatically. Select the link and copy it by hand.',
  'error.file_too_large': 'That file is too large.',
  'error.clipboard_refused':
    'This browser would not let the page write to the clipboard. Selecting the ' +
    'rows and pressing copy does the same thing.',
  'error.proxy_rejected_size':
    'The web server in front of SONE refused the file for being too large. ' +
    'Its upload limit is separate from SONE’s — with nginx it is ' +
    'client_max_body_size, which allows only 1 MB unless it is raised.',
  'error.proxy_error':
    'Something between the browser and SONE rejected the request. Check the ' +
    'reverse proxy’s log rather than SONE’s.',
  'error.unsupported_file_type': 'That file type is not supported.',
  'error.empty_file': 'That file is empty.',
  'error.storage_unavailable':
    'SONE could not write the file to disk. The server log names the directory; ' +
    'the usual cause is a volume whose ownership does not match the user in ' +
    'the container.',
  'error.file_missing_from_storage':
    'The file is recorded but missing from storage. The instance may have been ' +
    'restored without its files.',
  'error.rows_required': 'Nothing was selected.',
  'error.unknown_error': 'Something went wrong.',

  // --- what a dialog's buttons say ---------------------------------------
  'action.cancel': 'Cancel',
  'action.move': 'Move',
  'action.moving': 'Moving…',
} as const;

export type MessageKey = keyof typeof en;
