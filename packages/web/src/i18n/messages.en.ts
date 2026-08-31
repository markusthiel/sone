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

  // --- the administration area -------------------------------------------
  'admin.instance': 'This instance',
  'admin.instance.hint': 'Name, sign-up and defaults',
  'admin.accounts': 'Accounts',
  'admin.accounts.hint': 'Everybody with an account here',
  'admin.workspaces': 'All workspaces',
  'admin.workspaces.hint': 'Every workspace here, and who is in them',
  'admin.invitations': 'Invitations',
  'admin.invitations.hint': 'An account and a workspace of their own — no team',
  'admin.sso': 'Single sign-on',
  'admin.sso.hint': 'Sign in through an identity provider',
  'admin.maintenance': 'Maintenance',
  'admin.maintenance.hint': 'Storage, jobs and health',

  'admin.settings': 'Settings',
  'admin.instanceName': 'Instance name',
  'admin.signup': 'Who may create an account',
  'admin.signup.open': 'Anyone with the address',
  'admin.signup.invite': 'Only with an invitation',
  'admin.signup.closed': 'Nobody — no new accounts',
  'admin.mayCreateWorkspaces': 'Members may create workspaces',
  'admin.addressForm': 'How the interface addresses people',
  'admin.addressForm.hint':
    'In German and other languages that distinguish it. English has one form and ' +
    'is unaffected.',
  'admin.addressForm.informal': 'Informally — “du”',
  'admin.addressForm.formal': 'Formally — “Sie”',
  'admin.version': 'Version',
  'admin.content': 'Content',
  'admin.files': 'Files',
  'admin.waitingToProject': 'Waiting to project',
  'admin.recentFailures': 'Recent failures',
  'admin.nothingToReport': 'Nothing to report.',
  'admin.uploadsUnwritable': 'Uploads cannot be written to disk',
  'admin.loading': 'Loading…',
  'admin.signup.note': 'Closing it does not affect anybody who already has one.',
  'admin.instanceName.hint': 'On the sign-in page and in the title of every tab.',
  'admin.settingSource.database': 'Set here, overriding the environment',
  'admin.reloadNote': 'Then reload this page — no restart is needed.',
  'action.retry': 'Retry',

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

  // --- this workspace's settings -----------------------------------------
  'workspace.nameAndMark': 'Name and mark',
  'workspace.nameAndMark.hint': 'What this workspace is called and how it is recognised',
  'workspace.typography': 'Typography',
  'workspace.typography.hint': 'How this workspace reads',
  'workspace.people': 'People',
  'workspace.people.hint': 'Who is in this workspace, their roles, and inviting more',
  'workspace.groups': 'Groups',
  'workspace.groups.hint': 'Named sets of people, for page permissions',
  'workspace.name': 'Name',
  'workspace.name.hint': 'What this workspace is called, everywhere it appears.',
  'workspace.nameLabel': 'Workspace name',
  'workspace.role': 'Your role',
  'workspace.role.hint': 'What you may do here. Roles are set from the people section.',
  'workspace.mark': 'Mark',
  'workspace.saveFailed': 'Could not save that. Try again.',

  // --- the trash ---------------------------------------------------------
  'trash.title': 'Trash',
  'trash.note':
    'Deleted entries stay here until they are destroyed. Nothing is removed on a ' +
    'schedule — an instance that quietly empties its own trash is one that loses ' +
    'somebody’s work while they are on holiday.',
  'trash.empty': 'Nothing has been deleted.',
  'trash.restore': 'Restore',
  'trash.destroy': 'Destroy',
  'trash.keep': 'Keep',
  'trash.confirm': 'Destroy permanently? This cannot be undone.',
  'trash.loading': 'Loading…',

  // --- search ------------------------------------------------------------
  'search.title': 'Search',
  'search.field': 'Search pages',
  'search.placeholder': 'Search pages…',
  'search.folders': 'Folders',
  'search.pages': 'Pages',
  'search.nothing': 'Nothing matched.',
  'search.didYouMean': 'Did you mean',
  'search.similar': 'Similar names',
  // Why a result matched: the name rather than something in the text.
  'search.matchedTitle': 'title',

  // --- the / menu (ADR-0041) ---------------------------------------------
  //
  // The keys are the item ids, so the catalogue and the editor's list line up
  // without a second mapping to keep in step. `keywords` is a comma-separated
  // list of extra terms a *reader of this language* would type — the English
  // ones stay in the editor package and are always matched as well, because
  // "h1" and "ul" are typed by people in every language.
  'slash.paragraph': 'Text',
  'slash.paragraph.hint': 'Plain paragraph',
  'slash.paragraph.keywords': '',
  'slash.heading-1': 'Heading 1',
  'slash.heading-1.hint': 'Section title',
  'slash.heading-1.keywords': '',
  'slash.heading-2': 'Heading 2',
  'slash.heading-2.hint': 'Section title',
  'slash.heading-2.keywords': '',
  'slash.heading-3': 'Heading 3',
  'slash.heading-3.hint': 'Section title',
  'slash.heading-3.keywords': '',
  'slash.bulletList': 'Bulleted list',
  'slash.bulletList.hint': 'An unordered list',
  'slash.bulletList.keywords': '',
  'slash.numberedList': 'Numbered list',
  'slash.numberedList.hint': 'An ordered list',
  'slash.numberedList.keywords': '',
  'slash.todo': 'To-do',
  'slash.todo.hint': 'A checkable task',
  'slash.todo.keywords': '',
  'slash.toggle': 'Toggle',
  'slash.toggle.hint': 'Collapsible section',
  'slash.toggle.keywords': '',
  'slash.quote': 'Quote',
  'slash.quote.hint': 'Quoted passage',
  'slash.quote.keywords': '',
  'slash.callout': 'Callout',
  'slash.callout.hint': 'Highlighted note',
  'slash.callout.keywords': '',
  'slash.code': 'Code',
  'slash.code.hint': 'Preformatted code block',
  'slash.code.keywords': '',
  'slash.image': 'Image',
  'slash.image.hint': 'Upload a picture',
  'slash.image.keywords': '',
  'slash.table': 'Table',
  'slash.table.hint': 'Rows and columns',
  'slash.table.keywords': '',
  'slash.file': 'File',
  'slash.file.hint': 'A PDF, a document, a spreadsheet — shown here or offered to open',
  'slash.file.keywords': '',
  'slash.video': 'Video',
  'slash.video.hint': 'Upload one, paste a link, or point at a live stream',
  'slash.video.keywords': '',
  'slash.protected': 'Protected section',
  'slash.protected.hint': 'A part of this page only the people you add can open',
  'slash.protected.keywords': '',
  'slash.collection': 'Table of entries',
  'slash.collection.hint': 'A collection: rows with columns, each row a page of its own',
  'slash.collection.keywords': '',
  'slash.divider': 'Divider',
  'slash.divider.hint': 'Horizontal rule',
  'slash.divider.keywords': '',

  // --- the panel beside a page -------------------------------------------
  'panel.label': 'Page panel',
  'panel.close': 'Close panel',
  'panel.outline': 'Outline',
  'panel.untitledHeading': 'Untitled heading',
  'panel.untitledTask': 'Untitled task',
  'panel.goToTask': 'Go to this task',
  'panel.showInPage': 'Show where it sits in the page',
  'panel.showLinkInPage': 'Show this link in the page',
  'panel.done': 'Done',
  'panel.created': 'Created',
  'panel.edited': 'Edited',
  'panel.sync': 'Sync',
  'panel.yourAccess': 'Your access',
  'panel.loading': 'Loading…',
  'panel.uploading': 'uploading…',
  'panel.noImages': 'No images yet. Drop one into the page.',
  'panel.noLinks': 'No links yet.',
  // The empty states name the shortcut that fills them, so the code stays out of
  // the message: a translator must not have to preserve `/file` inside a
  // sentence, and a language that puts it elsewhere can.
  'panel.noFiles': 'No files yet. Drop one into the page, or type {shortcut}.',
  'panel.noHeadings': 'No headings yet. Type {shortcut} at the start of a line to make one.',
  'panel.noTasks': 'No tasks yet. Type {shortcut} at the start of a line to make one.',
  'panel.kind': 'Kind',
  'panel.tags': 'Tags',
  'panel.openForFiles': 'Open a page to see its files.',
  'panel.openForImages': 'Open a page to see its images.',
  'panel.openForLinks': 'Open a page to see its links.',
  'panel.openForOutline': 'Open a page to see its outline.',
  'panel.openForProperties': 'Open a page to see its properties.',
  'panel.openForTasks': 'Open a page to see its tasks.',

  // --- a view's rules ----------------------------------------------------
  'view.rules': 'View rules',
  'view.rowHeight': 'Row height',
  'view.rowHeight.compact': 'Compact',
  'view.rowHeight.normal': 'Normal',
  'view.rowHeight.tall': 'Tall',
  'view.sort': 'Sort',
  'view.sort.none': 'Not sorted',
  'view.sort.by': 'Sort by',
  'view.sort.direction': 'Sort direction',
  'view.sort.ascending': 'Ascending',
  'view.sort.descending': 'Descending',
  'view.filters': 'Filters',
  'view.filters.none': 'Every entry is shown.',
  'view.filter.column': 'Column',
  'view.filter.condition': 'Condition',
  'view.filter.value': 'Value',
  'view.filter.remove': 'Remove this filter',
  'view.filter.add': 'Add a filter',
  'view.noColumns': 'Add a column first — there is nothing to filter or sort by yet.',
  'action.close': 'Close',
  'action.apply': 'Apply',

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
