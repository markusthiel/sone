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
  'sidebar.folders': 'Folders',
  'sidebar.emptyFolders': 'No folders yet. Press + to make one.',
  'sidebar.newFolder': 'New folder',
  'sidebar.empty': 'No pages yet.',
  'sidebar.rename': 'Rename',
  'sidebar.newPageIn': 'New page inside {title}',
  'sidebar.addIn': 'Add something inside {title}',
  'sidebar.removeFavourite': 'Remove {title}',

  // --- an entry's own menu -----------------------------------------------
  'entry.menu': 'More for {title}',
  'entry.rename': 'Rename',
  'entry.icon': 'Icon and colour',
  'entry.favourite': 'Add to favourites',
  'entry.unfavourite': 'Remove from favourites',
  'entry.share': 'Share…',
  'entry.move': 'Move to…',
  'entry.lockedShort': 'Locked',
  'entry.lock': 'Lock',
  'entry.lock.hint': 'Lock against accidental changes. Anybody who may edit can unlock it.',
  'entry.unlock': 'Unlock',
  'entry.unlock.hint': 'Allow changes again.',
  'entry.export': 'Export\u2026',
  'share.heading': 'Share “{title}”',
  'file.pdfAllPages': 'Open the original',
  'file.pdfDocument': 'Document, scrollable',
  'file.pdfPrevious': 'Previous page',
  'file.pdfNext': 'Next page',
  'file.pdfPageOf': 'Page {page} of {total}',
  'file.pdfLoading': 'Opening the document\u2026',
  'file.pdfFailed': 'This document could not be shown here.',
  'workspace.export': 'Export this workspace',
  'workspace.export.hint':
    'Every page you can read, as Markdown files with their attachments, in one ' +
    'archive. It is packed in the background \u2014 you can leave this page.',
  'workspace.export.start': 'Prepare an archive',
  'workspace.export.rights':
    'An archive holds what you can read at the moment it is packed. If your ' +
    'access changes in between, it holds less \u2014 never more.',
  'workspace.export.waiting': 'Waiting to start\u2026',
  'workspace.export.ready': '{pages} pages, {size}',
  'workspace.export.until': 'available until {when}',
  'workspace.export.failed': 'It did not finish.',
  'import.title': 'Import',
  'import.where': 'Into {title}.',
  'import.reading': 'Reading the archive\u2026',
  'import.summary': '{pages} pages and {folders} folders would be created.',
  'import.exists': 'already there',
  'import.duplicate': 'Create the {count} that already exist a second time',
  'import.noOverwrite':
    'Nothing existing is replaced. Without this, a page whose name is already ' +
    'there is left alone and the archive\u2019s copy is not imported.',
  'import.skipped': '{count} files will not be imported',
  'import.attachments':
    '{count} files come with it. A file whose kind cannot be recognised is left ' +
    'out, and the picture that used it shows as missing.',
  'import.attachmentsNotYet':
    'The {count} files in this archive are not imported yet, and the links to ' +
    'them will point nowhere.',
  'import.confirm': 'Import',
  'import.working': 'Importing\u2026',
  'import.done': '{count} pages created.',
  'import.wereSkipped': 'Left alone, because something of that name was there: {paths}',
  'entry.import': 'Import\u2026',
  'export.title': 'Export',
  'export.what': '{title} and everything inside it, as Markdown files in one archive.',
  'export.withAttachments': 'Include the files and pictures',
  'export.attachmentsNote':
    'Without them the archive is small enough to email, and the links in it ' +
    'point at files that are not there.',
  'export.download': 'Download',
  'entry.moveToWorkspace': 'To a workspace…',
  'template.heading': 'From a template',
  'template.use': 'Use as a template',
  'template.stop': 'Stop offering as a template',
  'entry.untitled': 'Untitled',
  'entry.actions': 'What to do with this entry',
  'entry.new': 'New',
  'entry.newPage': 'New page',
  'entry.newFolder': 'New folder',
  'entry.moveUp': 'Move up',
  'entry.moveDown': 'Move down',
  'groups.confirmDelete':
    '{name} has been given access to pages. Delete it anyway?',
  'entry.confirmTrash': 'Move this to the trash?',
  'entry.confirmTrashWithChildren':
    'Move this to the trash, with {count, plural, one {# entry} other {# entries}} inside?',
  'entry.delete': 'Trash',
  // The count stays: it is what decides whether somebody opens the confirmation
  // at all. The verb goes — the mark beside it already says it.
  'entry.deleteWithChildren': 'Trash, {count, plural, one {# entry} other {# entries}}',

  // --- the administration area -------------------------------------------
  'admin.instance': 'This instance',
  'admin.instance.hint': 'Name, sign-up and defaults',
  'admin.accounts': 'Accounts',
  'admin.accounts.hint': 'Everybody with an account here',
  'admin.accounts.note':
    'Deactivating keeps the account and its work, and signs it out immediately. ' +
    'Accounts are never deleted from here: removing one would take every page it ' +
    'created with it, and “this person has left” is not “their work never happened”.',
  'admin.workspaces': 'All workspaces',
  'admin.workspaces.hint': 'Every workspace here, and who is in them',
  'admin.invitations': 'Invitations',
  'admin.invitations.hint': 'An account and a workspace of their own — no team',
  'admin.sso': 'Single sign-on',
  'admin.sso.hint': 'Sign in through an identity provider',
  'admin.maintenance': 'Maintenance',
  'admin.maintenance.hint': 'Storage, jobs and health',

  'admin.settings': 'Settings',
  'admin.settings.note':
    'These are stored in the database and take effect immediately. Anything needed ' +
    'before the database opens — the database URL, the secret key, the port — stays in ' +
    'the environment, because a server that cannot start cannot be configured from a ' +
    'screen it never shows.',
  'admin.mayCreateWorkspaces.hint':
    'Off means only administrators make them. Everybody keeps their own personal one ' +
    'either way — it is not a team.',
  'admin.sizesOnly':
    'Sizes only. Administering the instance does not include reading what is in a ' +
    'workspace — that needs membership, which is a decision somebody takes rather than ' +
    'a button here.',
  'admin.maintenance.run': 'Run maintenance now',
  'admin.maintenance.running': 'Running…',
  'admin.maintenance.note':
    'This pass runs on its own every few minutes. Pressing it is for when waiting is ' +
    'not acceptable — after fixing whatever made a projection fail, typically.',
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
  'admin.anomaly.orphaned': 'Orphaned entries',
  'admin.anomaly.orphaned.explain':
    'A parent that has not arrived yet. Transient during sync; a persistent count means ' +
    'a page whose folder was never created.',
  'admin.anomaly.nested': 'Entries inside pages',
  'admin.anomaly.nested.explain':
    'Only folders may hold children. The API refuses to create these, so a count here ' +
    'means a client wrote one directly.',
  'admin.anomaly.staleSearch': 'Stale search rows',
  'admin.anomaly.staleSearch.explain':
    'Indexed with an older text configuration. Re-materialise the affected workspaces.',
  'admin.anomaly.failed': 'Failed projections',
  'admin.anomaly.failed.explain':
    'A document the projection could not read. The page still exists and syncs; it is ' +
    'missing from search and from the tree.',
  'admin.uploadsUnwritable': 'Uploads cannot be written to disk',
  'admin.storage.fix':
    'The container runs as uid 10001 and cannot change this itself. From the host, as ' +
    'root inside the running container:',
  'admin.storage.volumeWarning':
    'Address the container rather than the volume. A volume name guessed wrongly is ' +
    'created empty rather than reported missing, so the command appears to succeed and ' +
    'nothing changes.',
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
  'you.email.hint':
    'Identifies your account when you sign in. Changing it needs a way to prove the ' +
    'new address is yours, which this instance cannot do yet.',
  'you.workspace': 'Workspace',
  'you.workspace.hint': 'Where you are right now.',
  'you.saved': 'Saved.',
  'you.save': 'Save',
  'you.passwordChanged': 'Changed. Your other sessions stay signed in.',
  'action.reload': 'Reload',

  'you.currentPassword': 'Current password',
  'you.currentPassword.hint':
    'Asked for because a session left open on a shared machine is the ordinary way an ' +
    'account is taken.',
  'you.newPassword': 'New password',

  'you.language': 'Language',
  'you.language.hint':
    'Unlike the sizes below, this follows your account rather than this browser — ' +
    'it is your language wherever you sign in.',
  'you.language.system': 'Match the browser',
  'you.appearance.note':
    'Stored in this browser. A text size that suits a phone is wrong on a large ' +
    'monitor, so these do not follow your account between devices.',
  'you.theme': 'Theme',
  'you.theme.hint':
    'Following the system is the default. Choose one to override it — somebody outside ' +
    'in the sun wants light whatever their laptop thinks.',
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

  // --- the last of the interface -----------------------------------------
  'invitation.title': 'Invitation',
  'action.continue': 'Continue',
  'action.notNow': 'Not now',
  'invitation.alreadyMember': 'You already have an account here, so this invitation has nothing to add.',
  'page.title': 'Page title',
  'page.untitled': 'Untitled',
  'page.readOnly': 'You have read-only access to this page.',
  'page.noAccess': 'You no longer have access to this page.',
  'error.technicalDetail': 'Technical detail',
  'option.name': 'Option name',
  'option.options': 'Options',
  'option.none': 'No options yet. Add one, then pick it in a cell.',
  'option.add': 'Add option',
  'format.label': 'Formatting',
  'format.link': 'Link (Mod-K)',
  'format.linkAddress': 'Link address',
  'format.linkPlaceholder': 'example.org',
  'format.copyCode': 'Copy the code',
  'format.linkWord': 'Link',
  // The letter on each button is not translated — B, I, S are the shapes people
  // know — but the tooltip that says what it does is.
  'format.bold': 'Bold (Mod-B)',
  'format.italic': 'Italic (Mod-I)',
  'format.strikethrough': 'Strikethrough',
  'format.code': 'Code (Mod-E)',
  'format.removeLink': 'Remove',
  'slash.insert': 'Insert block',
  'tableBlock.label': 'Table',
  'tableBlock.addRow': '+ Row',
  'tableBlock.addRow.title': 'Insert a row below',
  'tableBlock.addColumn': '+ Column',
  'tableBlock.addColumn.title': 'Insert a column to the right',
  'tableBlock.header': 'Header',
  'tableBlock.header.title': 'Toggle the header row',
  'tableBlock.removeRow': '− Row',
  'tableBlock.removeRow.title': 'Delete this row',
  'tableBlock.removeColumn': '− Column',
  'tableBlock.removeColumn.title': 'Delete this column',
  'video.add': 'Add a video',
  'video.address': 'Video address',
  'video.addressPlaceholder': 'https://…',
  'video.orPaste': 'or paste an address',
  'video.upload': 'Upload a video',
  'gallery.empty': 'Nothing here yet.',
  'workspaces.shared': 'Shared workspaces',
  'workspaces.personal': 'Personal workspaces',
  'workspaces.nonePersonal': 'None yet — every workspace here belongs to one person.',
  'workspaces.name': 'Name',
  'workspaces.people': 'People',
  'workspaces.pages': 'Pages',
  'workspaces.lastEdited': 'Last edited',
  'workspaces.appearance': 'Appearance',
  'workspaces.delete': 'Delete this workspace',
  'workspaces.confirmName': 'Type the name to confirm',
  'workspaces.nameField': 'Workspace name',
  'workspaces.new': 'New workspace',
  'workspaces.settings': 'Workspace settings',
  'workspaces.all': 'All workspaces',

  // --- the longer explanations ------------------------------------------
  'landing.note':
    'When you sign in, switch to this workspace, or open SONE without a particular ' +
    'page in mind.',
  'landing.gone':
    'If it is ever deleted or closed to you, SONE opens the first one instead rather ' +
    'than refusing.',
  'folder.empty':
    'This folder is empty. Add a page to start writing, or a folder to keep organising.',
  'invite.instance.note':
    'Invite somebody to this instance. They get an account and a workspace of their ' +
    'own — nothing else. Adding them to a team is a separate step, made by whoever runs ' +
    'that team.',
  'invite.address.note':
    'Optional. With one, the invitation is for that person and can be used once. ' +
    'Without one it is a link anybody holding it may use — which is how you invite a ' +
    'group without typing every address.',
  'invite.workspace.note':
    'Works whether or not they already have an account. With one, the link asks them to ' +
    'join and their own workspace is untouched. Without one, they register first and end ' +
    'up in both.',
  'invite.workspace.address':
    'With an address the invitation is for that person and can be used once — and only ' +
    'they can accept it, even if somebody else opens the link.',
  'group.note':
    'A group is a list of people. Give a group access to a page once, and everybody in ' +
    'it has it — including whoever joins later, which is what makes this worth keeping ' +
    'up to date.',
  'group.name.note':
    'A name for a set of people. Whoever joins it later gets whatever the group has been ' +
    'given, without anybody revisiting the pages.',
  'oidc.note':
    'Sign in through an identity provider. Any provider that speaks OpenID Connect ' +
    'works — Keycloak, Authentik, Zitadel, Entra, Google and others — so this is a ' +
    'configuration rather than a choice of integration.',
  'oidc.buttonLabel.hint':
    'What the sign-in page says. People recognise their own login by name, not by the ' +
    'protocol behind it.',
  'oidc.allowSignup.hint':
    'Off by default. Trusting a provider to say who somebody is does not oblige you to ' +
    'let everybody there in.',
  'invitation.used':
    'This invitation has already been used. If that was you just now, your account is ' +
    'ready.',
  'invitation.keepsYours': 'Your own workspace stays where it is. Joining adds this one beside it.',
  'option.rename.note':
    'Rename an option freely — entries keep it. Removing one hides it from the entries ' +
    'that use it, and adding a new option with the same name does not bring them back.',
  'video.providers':
    'This instance embeds YouTube, Vimeo and PeerTube, and plays HLS or DASH streams. ' +
    'Other addresses can go in the page as an ordinary link.',
  'workspaces.delete.note':
    'It stops appearing to everybody in it. Nothing is removed yet, and somebody who ' +
    'manages workspaces can put it back.',

  // --- invitations -------------------------------------------------------
  'invite.email': 'Email address',
  'invite.emailPlaceholder': 'someone@example.org',
  'invite.link': 'Invitation link',
  'invite.here': 'Invite somebody here',
  'invite.joinAs': 'They join as',
  'invite.outstanding': 'Outstanding invitations',
  'invite.anybodyWithLink': 'Anybody with the link',
  'invite.role': 'Role',
  'invite.expires': 'Expires',
  'invite.used': 'Used',
  'invite.withdraw': 'Withdraw',

  // --- groups and page permissions ---------------------------------------
  'group.new': 'New group',
  'group.namePlaceholder': 'Editors',
  'group.addSomebody': 'Add somebody',
  'group.choosePerson': 'Choose a person…',
  'group.nobody': 'Nobody yet.',
  'group.create': 'Create',
  'group.delete': 'Delete',
  'group.remove': 'Remove',
  'perm.people': 'People',
  'perm.peopleHere': 'People in this workspace',
  'perm.groups': 'Groups',
  'perm.addGroup': 'Add a group',
  'perm.chooseGroup': 'Choose a group…',
  'perm.checking': 'Checking…',
  'perm.onlyAdded': 'Only people added below',
  'perm.remove': 'Remove',

  // --- single sign-on ----------------------------------------------------
  'oidc.issuer': 'Issuer',
  'oidc.issuerPlaceholder': 'https://login.example.org/realms/main',
  'oidc.clientId': 'Client ID',
  'oidc.buttonLabel': 'Button label',
  'oidc.asRegistered': 'As registered with the provider.',
  'oidc.showButton': 'Show the button on the sign-in page',
  'oidc.allowSignup': 'Let people without an account here sign up through the provider',

  // --- who is in a workspace ---------------------------------------------
  'member.name': 'Name',
  'member.role': 'Role',
  'member.since': 'Since',
  'member.remove': 'Remove',

  // --- tags --------------------------------------------------------------
  'tag.add': 'Add a tag',
  'tag.none': 'None',

  // --- sharing a page ----------------------------------------------------
  'share.label': 'Share',
  'share.anyoneWithLink': 'Anyone with a link',
  'share.notShared': 'This page is not shared.',
  'share.existing': 'Existing links',
  'share.new': 'New link',
  'share.allows': 'What it allows',
  'share.expires': 'Expires',
  'share.never': 'Never',
  'share.inADay': 'In a day',
  'share.inAWeek': 'In a week',
  'share.inAMonth': 'In a month',
  'share.inAYear': 'In a year',
  'share.created': 'Your new link. You can copy it again below at any time.',
  'share.create': 'Create link',
  'share.revoke': 'Revoke',
  'share.subpages.hint':
    'On by default, because a link that stops working the moment somebody adds a ' +
    'subpage is worse than one that covers slightly more than expected.',
  'share.tooOld':
    'That link was created before links could be shown again, so it cannot be copied. ' +
    'Revoke it and make a new one.',
  'share.revoke.hint':
    'Revoking takes effect at once, including for anyone reading through the link at ' +
    'that moment. A link can be copied again by anyone who administers this page — ' +
    'which is the same right needed to create one, so nothing new is exposed. It is ' +
    'stored encrypted, and the key is not in the database.',
  'action.done': 'Done',

  // --- a workspace's typography ------------------------------------------
  'type.note':
    'Defaults for this workspace. A block that carries its own size or colour keeps ' +
    'it — these apply where nobody has chosen.',
  'type.palette.note':
    'What each colour name looks like here. Everything that uses a name — tags, ' +
    'columns, blocks, folder icons — follows.',
  'type.element': 'Element',
  'type.elements': 'Elements',
  'type.base': 'The interface',
  'type.base.note':
    'The tint is mixed into the sidebar, the panels and the menus. One colour ' +
    'rather than one per surface, so they keep belonging to each other.',
  'type.tint': 'Tint',
  'type.accent': 'Accent',
  'type.accent.note':
    'The accent is used for links, defined text and filled buttons. The text ' +
    'colour on a filled button is worked out from it, so a pale accent gets ' +
    'dark text.',
  'type.clear': 'Reset',
  'type.palette': 'Palette',
  'type.size': 'Size',
  'type.colour': 'Colour',
  'type.spaceAbove': 'Space above',
  'type.spaceBelow': 'Space below',
  'type.asDesigned': 'As designed',

  // --- where a workspace opens -------------------------------------------
  'landing.title': 'Where you land',
  'landing.lastPage': 'The page you were on last',
  'landing.lastPage.hint': 'Follows you: whatever you had open in this workspace.',
  'landing.fixedPage': 'A particular page',
  'landing.fixedPage.hint': 'Always the same one, whatever you were doing.',
  'landing.page': 'Page',
  'landing.choose': 'Choose a page…',

  // --- a workspace's own mark --------------------------------------------
  'mark.icon': 'Icon',
  'mark.none': 'No icon',
  'mark.iconColour': 'Icon colour',
  'mark.nameColour': 'Name colour',

  // --- a folder ----------------------------------------------------------
  'folder.name': 'Folder name',
  'folder.untitled': 'Untitled folder',
  'folder.location': 'Location',
  'folder.folders': 'Folders',
  'folder.pages': 'Pages',

  // --- moving inside a workspace -----------------------------------------
  'move.title': 'Move to',
  'move.root': 'Workspace root',
  'move.find': 'Find a folder',
  'move.noMatch': 'No folder matches.',

  'action.saved': 'Saved.',

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
  'search.chip.tag': 'Tagged {value}',
  'search.chip.author': 'Written by {value}',
  'search.chip.after': 'Edited on or after {value}',
  'search.chip.before': 'Edited on or before {value}',
  'search.chip.notADate': 'Not a date. Use YYYY-MM-DD.',
  'search.syntax':
    'Narrow it by typing tag:name, author:name, after:2026-08-01 or ' +
    'before:2026-09-01. A filter on its own works too.',
  'search.nothing': 'Nothing matched.',
  'search.didYouMean': 'Did you mean',
  'search.similar': 'Similar names',
  // Why a result matched: the name rather than something in the text.
  'search.matchedTitle': 'title',

  // --- a table of entries ------------------------------------------------
  'table.views': 'Views',
  'table.search': 'Search this collection',
  'table.searchPlaceholder': 'Search these entries',
  'table.filterAndSort': 'Filter and sort',
  'table.filterAndSort.title': 'Filter and sort this view',
  'table.rules': '{filters, plural, =0 {} one {# filter} other {# filters}}{sorted, select, yes {{filters, plural, =0 {sorted} other {, sorted}}} other {}}',
  'table.empty': 'Empty',
  'table.addBoard': 'Board',
  'table.addGallery': 'Gallery',
  'table.addGallery.title': 'Show these entries as covers',
  'table.newEntry': 'New entry',
  'table.noEntries': 'No entries yet.',
  'table.loading': 'Loading…',
  'table.addColumn': 'Add a column',
  // A column's type. Keyed by the type the server stores, so a translation
  // cannot change what a column is.
  'field.text': 'Text',
  'field.select': 'Select',
  'field.multiSelect': 'Multi-select',
  'field.number': 'Number',
  'field.date': 'Date',
  'field.checkbox': 'Checkbox',
  'field.url': 'Link',
  'field.email': 'Email',
  'field.phone': 'Phone',
  'field.files': 'Files',
  'table.titleColumn': 'Every entry has a title',
  'table.name': 'Name',
  'table.untitled': 'Untitled',
  'table.removedOption': 'This option was removed',
  'table.selected': '{count, plural, one {# selected} other {# selected}}',
  'table.selectedLabel': 'Selected entries',
  'table.copy': 'Copy',
  'table.exportCsv': 'Export CSV',
  'table.toTrash': 'To the trash',
  'table.clearSelection': 'Clear',
  // What can be undone. Shown as the undo button's tooltip, which is the one
  // place a person reads these.
  'table.undo': 'Undo: {action}',
  'table.redo': 'Redo: {action}',
  'table.nothingToUndo': 'Nothing to undo',
  'table.nothingToRedo': 'Nothing to redo',
  'undo.rename': 'rename an entry',
  'undo.paste': '{count, plural, one {paste an entry} other {paste # entries}}',
  'undo.empty': '{count, plural, one {empty the table (# entry)} other {empty the table (# entries)}}',
  'undo.archive': '{count, plural, one {move an entry to the trash} other {move # entries to the trash}}',
  'table.boardNeedsSelect':
    'A board needs a select column with options. Add one, then try again.',
  'table.always': 'always',
  'table.emptyConfirm': 'Empty the table',
  'table.emptyKeep': 'Keep them',
  'table.noOptions': 'No options — add some in the column heading',

  // --- a table's own actions, in the gutter menu -------------------------
  //
  // Keyed by the action's id, which is prosemirror-tables' command. The editor
  // package holds the list and the ids; the words are ours (ADR-0041).
  'tableAction.row-before': 'Insert row above',
  'tableAction.row-after': 'Insert row below',
  'tableAction.column-before': 'Insert column left',
  'tableAction.column-after': 'Insert column right',
  'tableAction.toggle-header-row': 'Toggle header row',
  'tableAction.toggle-header-column': 'Toggle header column',
  'tableAction.merge': 'Merge cells',
  'tableAction.split': 'Split cell',
  'tableAction.delete-row': 'Delete row',
  'tableAction.delete-column': 'Delete column',
  'tableAction.delete-table': 'Delete table',

  // --- what a role may do ------------------------------------------------
  'role.member': 'Member',
  'role.member.hint': 'Can read and write everything not restricted',
  'role.admin': 'Admin',
  'role.admin.hint': 'Can also manage people and permissions',
  'role.guest': 'Guest',
  'role.guest.hint': 'Sees only what they are given access to',
  'role.owner': 'Owner',
  'access.viewer': 'Can view',
  'access.commenter': 'Can read and comment',
  'access.editor': 'Can edit',
  'access.admin': 'Can manage',
  // "Can edit · from a group called Editors" — one message, because word order
  // and the case of "from" differ by language.
  'access.from': '{level} · from {source}',

  // --- the block menu ----------------------------------------------------
  'block.insert': 'Insert a block',
  'block.nesting': 'Nesting',
  'block.appearance': 'Appearance',
  'block.width': 'Width',
  'block.alignment': 'Alignment',
  'block.colour': 'Colour',
  'block.defaultColour': 'Default colour',
  'block.showAs': 'Show as',
  'block.turnInto': 'Turn into',
  'block.file': 'File',
  'block.table': 'Table',
  'block.video': 'Video',
  'block.align.auto': 'Auto',
  'block.align.left': 'Left',
  'block.align.centre': 'Centre',
  'block.align.right': 'Right',
  'block.width.column': 'Column',
  'block.width.wide': 'Wide',
  'block.width.full': 'Full page',
  'block.display.card': 'Card',
  'block.display.line': 'One line',
  'block.display.viewer': 'Viewer',
  'block.display.player': 'Player',
  'block.display.image': 'Image',
  'block.display.link': 'Link',
  'block.actions': 'What to do with this block',
  'block.moveUp': 'Move up',
  'block.moveDown': 'Move down',
  'block.outdent': 'Outdent',
  'block.indent': 'Indent',
  'block.duplicate': 'Duplicate',
  'block.lock': 'Lock this block',
  'block.unlock': 'Unlock this block',
  'block.delete': 'Delete',
  // Any level, so it is not one of the / menu's three.
  'block.heading': 'Heading',
  'block.openInNewTab': 'Open in a new tab',
  'block.download': 'Download',
  'block.downloadOriginal': 'Download the original',
  'block.openWhereItLives': 'Open where it lives',

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
  'panel.hide': 'Hide the page panel',
  'panel.show': 'Show the page panel',
  'panel.outline': 'Outline',
  'panel.tasks': 'Tasks',
  'panel.files': 'Files',
  'panel.images': 'Images',
  'panel.links': 'Links',
  'panel.people': 'People',
  'panel.properties': 'Properties',
  'panel.tasksOpen': '{open} of {total} open',
  'panel.comments': 'Comments',
  'panel.history': 'History',
  'history.none': 'No earlier versions of this page have been kept yet.',
  'history.viewing': 'This is how the page read on {when}.',
  'history.backToNow': 'Back to now',
  'history.restore': 'Make the page read like this',
  'history.restoreMeans':
    'This is an edit, not a rewind: the page will read as it did, everything ' +
    'that happened since stays in the list, and this restore becomes a version ' +
    'of its own. Comments are not touched.',
  'history.wasRestore': 'a restore',
  'history.wasEmpty': 'The page was empty.',
  'history.retention':
    'Versions are kept for {days} days: every one from the last day, one an ' +
    'hour for a week, one a day after that.',
  'history.incomplete':
    'This list begins when the page started keeping versions. Anything older ' +
    'than that was not recorded and cannot be recovered.',
  'comment.none': 'Nothing has been commented on yet. Select some words and press Comment.',
  'comment.open': 'Open',
  'comment.detachedHeading': 'Text is gone',
  'comment.resolvedHeading': 'Resolved',
  'comment.detached': 'The text this was about has been deleted.',
  'comment.reveal': 'Show this in the page',
  'comment.replyPlaceholder': 'Reply\u2026',
  'comment.resolve': 'Resolve',
  'comment.reopen': 'Open again',
  'comment.reply': 'Reply',
  'comment.removeThread': 'Delete the whole thread',
  'comment.removeMessage': 'Delete this message',
  'comment.unknownAuthor': 'Somebody who has left',
  'comment.collapse': 'Fold this thread',
  'comment.expand': 'Open this thread',
  'comment.collapseAll': 'Fold all',
  'comment.expandAll': 'Open all',
  'comment.markStyle': 'How to mark them',
  'comment.mark.highlight': 'Highlighted',
  'comment.mark.underline': 'Underlined',
  'comment.mark.off': 'Not at all',
  'comment.start': 'Comment',
  'comment.startPlaceholder': 'What about this?',
  'panel.guest': 'guest',
  'panel.guestWriting':
    'Some of this was written before the page began keeping track, or by ' +
    'somebody who gave no name at all.',
  'panel.noPeople':
    'Nobody is recorded yet. Writing is attributed from the moment it is written, so ' +
    'anything typed before this page started keeping track is not listed here.',
  // --- a canvas (ADR-0043) ------------------------------------------------
  'canvas.tools': 'Canvas tools',
  'canvas.tool.select': 'Select',
  'canvas.tool.hand': 'Move the board',
  'canvas.tool.pen': 'Pen',
  'canvas.tool.text': 'Text',
  'canvas.remove': 'Remove this',
  'canvas.handle': 'What to do with this',
  'canvas.duplicate': 'Duplicate',
  'canvas.lock': 'Lock in place',
  'canvas.unlock': 'Unlock',
  'canvas.toFront': 'Bring to front',
  'canvas.textItem': 'Text on the canvas',
  'canvas.resize': 'Resize this',
  'canvas.colour': 'Ink colour',
  'canvas.colour.default': 'The theme\u2019s own',
  'canvas.colour.own': 'A colour of your own',
  'canvas.thickness': 'Thickness',
  'canvas.tool.erase': 'Eraser',
  'canvas.tool.rect': 'Rectangle',
  'canvas.tool.ellipse': 'Ellipse',
  'canvas.tool.line': 'Line',
  'canvas.image': 'Picture',
  'canvas.background': 'Ruling',
  'canvas.background.dots': 'Dotted',
  'canvas.background.squares': 'Squared',
  'canvas.background.lines': 'Lined',
  'canvas.background.plain': 'Plain',
  'canvas.undo': 'Undo',
  'canvas.redo': 'Redo',
  'canvas.zoomIn': 'Closer',
  'canvas.zoomOut': 'Further away',
  'canvas.zoomReset': 'Back to actual size',
  'canvas.new': 'New canvas',
  'panel.kind.canvas': 'Canvas',

  'panel.width': 'Width',
  'panel.width.column': 'Column',
  'panel.width.full': 'Full page',
  'panel.kind.page': 'Page',
  'panel.kind.folder': 'Folder',
  'panel.sync.upToDate': 'up to date',
  'panel.sync.syncing': 'syncing',
  'panel.sync.offline': 'offline — edits are kept locally',
  'panel.sync.denied': 'no access',
  'panel.sync.notOpen': 'not open',
  'panel.untitledHeading': 'Untitled heading',
  'panel.untitledTask': 'Untitled task',
  'panel.goToTask': 'Go to this task',
  'panel.openImage': 'Open this picture',
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
  // What can be asked of a column. The key is the operator the server honours,
  // so a translator changes the words and nothing about the query.
  'op.is': 'is',
  'op.isNot': 'is not',
  'op.isEmpty': 'is empty',
  'op.isNotEmpty': 'is not empty',
  'op.gt': 'greater than',
  'op.gte': 'at least',
  'op.lt': 'less than',
  'op.lte': 'at most',
  'op.before': 'before',
  'op.after': 'after',
  'op.contains': 'contains',
  'op.notContains': 'does not contain',
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

  // --- signing in, signing up, first-run setup ---------------------------
  'auth.setup': 'Set up SONE',
  'auth.setup.note': 'This creates the first workspace and its owner. It can only be done once.',
  'auth.workspaceName': 'Workspace name',
  'auth.yourName': 'Your name',
  'auth.email': 'Email',
  'auth.password': 'Password',
  'auth.passwordHint': 'At least 12 characters. Length beats complexity.',
  'auth.createWorkspace': 'Create workspace',
  'auth.creatingWorkspace': 'Setting up…',
  'auth.signIn': 'Sign in',
  'auth.signingIn': 'Signing in…',
  'auth.createAccount': 'Create an account',
  'auth.createAccountAction': 'Create account',
  'auth.creatingAccount': 'Creating…',
  'auth.or': 'or',
  'auth.noAccount': 'No account?',
  'auth.createOne': 'Create one',
  'auth.haveAccount': 'Already have an account?',
  'auth.cannotStart': 'Cannot start',
  'auth.tryAgain': 'Try again',
  'auth.loading': 'Loading…',

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
