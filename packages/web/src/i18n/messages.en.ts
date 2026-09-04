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
  'account.workspaces': 'Workspaces',
  'account.administration': 'Administration',
  'account.inbox': 'Inbox',
  'account.label.waiting': '{name}, {count} notifications waiting',
  'inbox.title': 'Inbox',
  'settings.title': 'Settings',
  'settings.scope': 'Personal · Workspace · Instance',
  'inbox.group.state': 'Inbox',
  'inbox.group.kind': 'By kind',
  'inbox.group.workspace': 'By workspace',
  'inbox.view.unread': 'Unread',
  'inbox.view.all': 'Everything',
  'inbox.emptyView': 'Nothing here in this view.',
  'inbox.empty':
    'Nothing is waiting. This is where it appears when somebody names you in ' +
    'a comment, or replies in a thread you are part of.',
  'inbox.unreadOnly': 'Only what is unread',
  'inbox.markAll': 'Mark everything read',
  'inbox.mention': 'You were named',
  'inbox.reply': 'A reply in a thread',
  'inbox.assignment': 'Assigned to you',
  'inbox.noEmail': 'SONE does not send email. This is where notifications are.',
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
  'sidebar.resize': 'Drag to make the sidebar wider, double-click to reset',
  'sidebar.close': 'Close navigation',
  'sidebar.hide': 'Hide the sidebar',
  'sidebar.search': 'Search',
  'sidebar.places': 'Parts of SONE',
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
  'entry.watch': 'Watch for changes',
  'entry.unwatch': 'Stop watching',
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
  'share.commentsVisible':
    'Anybody with this link can read the {count} comment threads on this page. ' +
    'A discussion held in comments becomes visible the moment the link is given ' +
    'out.',
  'share.heading': 'Share “{title}”',
  'file.pdfAllPages': 'Open the original',
  'video.hlsFailed':
    'This stream could not be played here. ',
  'video.dashOnly': 'DASH streams play only in browsers with their own support. ',
  'video.openStream': 'Open the stream',
  'field.relation': 'Relation',
  'relation.chooseTarget': 'Which collection should this point at?',
  'relation.noCollections': 'There is no other collection to point at yet.',
  'field.rollup': 'Rollup',
  'rollup.choose': 'Which relation should this count?',
  'rollup.nothingPointsHere':
    'No relation column points at this collection yet. Add one on the other ' +
    'collection first.',
  'action.save': 'Save',
  'action.create': 'Create',
  'error.invalid_value': 'That value does not fit this column.',
  'error.too_many_files': 'That is more files than one cell holds.',
  'error.unknown_option': 'That option is not one of this column´s.',
  'error.field_is_derived': 'That column is computed, so it cannot be written to.',
  'error.unsupported_field_type': 'That column type cannot be added.',
  'error.unsupported_view_type': 'That kind of view cannot be added.',
  'error.options_not_set': 'This column has no options yet.',
  'error.invalid_definition': 'That view´s settings could not be read.',
  'error.pages_need_a_folder': 'A page has to live in a folder.',
  'error.parent_is_not_a_folder': 'That is not a folder, so nothing can go inside it.',
  'error.parent_not_found': 'That folder no longer exists.',
  'error.a_row_cannot_hold_a_collection': 'A row cannot hold a collection of its own.',
  'error.invalid_tag': 'That tag cannot be used.',
  'error.invalid_width': 'That page width is not one of the two.',
  'error.unsupported_color': 'That colour is not one of the eight.',
  'error.name_taken': 'That name is already used.',
  'error.last_owner': 'A workspace has to keep one owner.',
  'error.last_administrator': 'The instance has to keep one administrator.',
  'error.cannot_deactivate_yourself': 'You cannot deactivate your own account.',
  'error.personal_workspace': 'A personal workspace cannot be shared or removed.',
  'error.grants_exist': 'That group still has access to pages. Remove it there first.',
  'error.not_a_member': 'That person is not a member of this workspace.',
  'error.export_too_large': 'That export is too large to prepare.',
  'error.too_large': 'That file is too large.',
  'error.search_needs_a_name': 'Give the search a name first.',
  'error.no_mail_server': 'Set a mail server first.',
  'error.no_address_to_test_with': 'Your account has no email address to test with.',
  'error.unknown_link': 'That link is not valid. Ask for a new one.',
  'error.expired_link': 'That link has expired. Ask for a new one.',
  'error.weak_password': 'A password needs at least 12 characters.',
  'error.formula_missing': 'Write a formula first.',
  'error.formula_invalid': 'That formula cannot be read. Check the brackets and the operators.',
  'error.formula_unknown_field': 'That formula names a column this collection does not have.',
  'error.formula_reads_formula':
    'A formula cannot read another formula. Repeat the expression instead — ' +
    'that restriction is what keeps a column from depending on itself.',
  'error.relation_without_target': 'A relation column has to say which collection it points at.',
  'error.relation_points_elsewhere': 'That relation points at a different collection.',
  'error.not_a_relation': 'That column is not a relation.',
  'error.not_a_stored_field': 'A rollup can only aggregate a stored column, not a computed one.',
  'error.rollup_needs_a_field': 'Choose which column to aggregate.',
  'error.invalid_rollup': 'That rollup is not complete.',
  'error.too_many_relations': 'That is more linked rows than one cell holds.',
  'error.row_not_found': 'That row is not in the collection this column points at.',
  'error.collection_not_found': 'That collection no longer exists.',
  'field.formula': 'Formula',
  'formula.edit': 'Edit this formula',
  'formula.example': 'Quantity * Price',
  'formula.write': 'Write a formula',
  'formula.columns': 'Columns you can use: {names}',
  'formula.error.unknown_field': 'No such column',
  'formula.error.type_mismatch': 'Those types cannot be combined',
  'formula.error.unknown_function': 'No such function',
  'formula.error.wrong_arity': 'Wrong number of arguments',
  'formula.error.divide_by_zero': 'Divided by zero',
  'formula.error.not_a_date': 'Not a date',
  'rollup.aggregate': 'What this counts',
  'rollup.rows': 'The linked rows',
  'rollup.count': 'How many',
  'rollup.field': 'Which field',
  'rollup.pickField': 'Choose a field…',
  'rollup.lookup': 'Their values',
  'rollup.sum': 'Their total',
  'rollup.min': 'The smallest',
  'rollup.max': 'The largest',
  'rollup.partial':
    'Some linked rows are not shown because you cannot open them, so this ' +
    'number is lower than somebody else may see.',
  'relation.aRow': 'A row',
  'relation.add': 'Link a row',
  'relation.remove': 'Unlink',
  'relation.search': 'Search in the linked collection',
  'relation.nothing': 'Nothing found here.',
  'file.pdfDocument': 'Document, scrollable',
  'file.pdfPrevious': 'Previous page',
  'file.pdfNext': 'Next page',
  'file.pdfPageOf': 'Page {page} of {total}',
  'file.pdfLoading': 'Opening the document\u2026',
  'file.pdfFailed': 'This document could not be shown here.',
  'workspace.invitations': 'Invitations',
  'workspace.invitations.hint': 'Links that let somebody join this workspace.',
  'workspace.delete.hint': 'Remove this workspace, reversibly, for a while.',
  'workspace.delete.notYours':
    'Only an owner of this workspace, or somebody who manages workspaces, can ' +
    'delete it.',
  'workspace.area': 'Workspace',
  'workspace.untitled': 'Untitled',
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
  'admin.workspaces': 'Workspaces',
  'admin.accounts': 'Accounts',
  'admin.accounts.hint': 'Everybody with an account here',
  'admin.accounts.note':
    'Deactivating keeps the account and its work, and signs it out immediately. ' +
    'Accounts are never deleted from here: removing one would take every page it ' +
    'created with it, and “this person has left” is not “their work never happened”.',
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
  'admin.maintenance.run': 'Run maintenance now',
  'admin.maintenance.running': 'Running…',
  'admin.maintenance.note':
    'This pass runs on its own every few minutes. Pressing it is for when waiting is ' +
    'not acceptable — after fixing whatever made a projection fail, typically.',
  'admin.replies': 'Replying by email',
  'admin.replies.hint':
    'With a mailbox here, a notification can be answered by replying to it. ' +
    'Without one, no reply address is sent and nothing is polled.',
  'admin.imapHost': 'Mailbox server (IMAP)',
  'admin.imapHost.hint': 'Empty means replies are not read at all.',
  'admin.imapPort': 'Port',
  'admin.imapPort.hint': '993 for IMAP over TLS.',
  'admin.imapUser': 'Mailbox user',
  'admin.imapUser.hint':
    'The password stays in the environment, as SONE_IMAP_PASSWORD.',
  'admin.replyMailbox': 'Reply address',
  'admin.replyMailbox.hint':
    'What people reply to. SONE adds a token to it per notification ' +
    '(sone+token@…), so one mailbox serves them all — the mailbox has to ' +
    'deliver those to the same inbox.',
  'admin.mail.section.hint': 'Sending notifications, and reading replies to them.',
  'admin.mail': 'Mail server',
  'admin.mail.hint':
    'For notification emails. Without a host nothing is sent and nothing is ' +
    'offered — that is a normal instance.',
  'admin.mail.using': 'What the server used',
  'admin.mail.usingPassword': 'Password',
  'admin.mail.passwordLength': '{count} characters, from SONE_SMTP_PASSWORD',
  'admin.mail.passwordMissing':
    'none — SONE_SMTP_PASSWORD is empty or never reached the container. ' +
    'Compose has to name it in the service´s environment, not only in .env.',
  'admin.mail.passwordQuoted':
    'it begins and ends with a quote, which is probably part of the value',
  'admin.mail.passwordSpace': 'it has a space or newline at one end',
  'admin.mail.test': 'Send a test email to myself',
  'admin.mail.testing': 'Sending…',
  'admin.mail.testSent': 'Sent to {address}. If it arrives, mail works.',
  'admin.mail.testFailed': 'The mail server refused it: ',
  'admin.smtpHost': 'Mail server',
  'admin.smtpHost.hint':
    'Empty means no email: notifications stay in the inbox and nothing is sent. ' +
    'That is a normal instance.',
  'admin.smtpPort': 'Port',
  'admin.smtpPort.hint': '587 for STARTTLS, 465 for TLS.',
  'admin.smtpSecurity': 'Encryption',
  'admin.smtpSecurity.hint':
    'A password is refused over an unencrypted connection — a credential in the ' +
    'clear is worse than no mail.',
  'admin.smtpSecurity.none': 'None (no password possible)',
  'admin.smtpUser': 'Mail server user',
  'admin.smtpUser.hint':
    'The password stays in the environment, as SONE_SMTP_PASSWORD: a secret in a ' +
    'table is a secret in every backup.',
  'admin.smtpFrom': 'Sender address',
  'admin.smtpFrom.hint': 'What mail comes from. Most relays insist on owning it.',
  'admin.emailDetail': 'What a mail may name',
  'admin.emailDetail.hint':
    'A notification email never contains comment text. This is whether it may ' +
    'name the page as well as the workspace.',
  'admin.emailDetail.title': 'The page title',
  'admin.emailDetail.workspace': 'Only the workspace',
  'admin.instanceName': 'Instance name',
  'admin.signup': 'Who may create an account',
  'admin.signup.open': 'Anyone with the address',
  'admin.signup.invite': 'Only with an invitation',
  'admin.signup.closed': 'Nobody — no new accounts',
  'admin.requireSecondFactor': 'Require two-step sign-in',
  'admin.requireSecondFactor.hint':
    'Everybody gets fourteen days and two emails, then setup is the only screen ' +
    'that opens. Single sign-on accounts are exempt — their provider is where a ' +
    'second factor belongs. You need one yourself before you can require it.',
  'admin.mayCreateWorkspaces': 'Members may create workspaces',
  'admin.addressForm': 'How the interface addresses people',
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
  'admin.anomaly.passwordCost': 'Password hashing is set low',
  'admin.anomaly.passwordCost.explain':
    'SONE_PASSWORD_COST is 2^{cost}, below the recommended 2^16 — passwords ' +
    'hashed now are cheaper to attack. Remove the variable and existing ' +
    'passwords are upgraded on their next sign-in.',
  'admin.liftSecondFactor': 'Remove two-step sign-in',
  'admin.liftSecondFactor.confirm':
    'Remove two-step sign-in from {name}? They will be able to sign in with ' +
    'their password alone, and will be emailed that you did this.',
  'admin.anomaly.mail': 'Emails that could not be sent',
  'admin.anomaly.mail.explain':
    'The relay refused them, after retries. Usually a wrong password, port or ' +
    'sender address — check the mail server settings above. The people ' +
    'concerned still have their notifications in the app.',
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
  'area.instance': 'Administration',

  // --- your own settings -------------------------------------------------
  'you.profile': 'Profile',
  'you.profile.hint': 'Your name, address and picture',
  'you.signIn': 'Signing in',
  'you.signIn.hint': 'Your password',
  'you.appearance': 'Appearance',
  'you.appearance.hint': 'How SONE looks to you',
  'you.landing': 'Where you land',
  'you.landing.hint': 'The page each workspace opens on',
  'you.notifications': 'Notifications',
  'you.notifications.hint': 'When SONE should email you.',
  'you.notifications.contents':
    'A notification email says who did what and on which page, with a link. It ' +
    'never contains the comment itself — a mailbox is not a permission system.',
  'you.when.immediately': 'Email me at once',
  'you.when.daily': 'In the daily mail',
  'you.when.off': 'No email',
  'required.title': 'Two-step sign-in is now required here',
  'required.hint':
    'Whoever runs this instance has made two-step sign-in a requirement, and the ' +
    'time to set it up has passed. Add an authenticator to carry on — nothing ' +
    'else is reachable until you do.',
  'required.soon':
    '{days, plural, one {Two-step sign-in becomes required tomorrow.} ' +
    'other {Two-step sign-in becomes required in # days.}} Set up an ' +
    'authenticator in your settings.',
  'required.setUp': 'Set it up',
  'you.secondFactor': 'Two-step sign-in',
  'you.secondFactor.hint':
    'An app on your phone produces a six-digit code that is asked for after your ' +
    'password. It protects the case that matters: a password reused somewhere ' +
    'that was breached.',
  'you.secondFactor.isOn': 'Two-step sign-in is on for this account.',
  'you.secondFactor.start': 'Set up an authenticator',
  'you.secondFactor.qrLabel': 'QR code for your authenticator app',
  'you.secondFactor.scan': 'Add this account to your authenticator app.',
  'you.secondFactor.open': 'Open in an authenticator app',
  'you.secondFactor.byHand': 'Or type this secret into the app by hand:',
  'you.secondFactor.prove':
    'Enter a code from the app. Nothing is switched on until one works — so a ' +
    'secret that was typed wrong cannot lock you out.',
  'you.secondFactor.finish': 'Turn it on',
  'you.secondFactor.remove': 'Turn it off',
  'you.secondFactor.removePassword': 'Your password',
  'you.secondFactor.removePassword.hint':
    'Needed to turn it off, so an open laptop is not enough.',
  'you.secondFactor.codes': 'Your recovery codes',
  'you.secondFactor.codes.hint':
    'Keep these somewhere safe. Each works once, and they are the way back in if ' +
    'you lose the app. They will not be shown again.',
  'you.secondFactor.codes.kept': 'I have kept them',
  'you.activity': 'A mail about what changed',
  'you.activity.hint':
    'A list of pages that changed in your workspaces — titles and names, never ' +
    'what was written, and never a page you cannot open. Off unless you choose it.',
  'you.activity.scope': 'What it covers',
  'you.activity.scope.hint':
    'Watching a folder covers everything under it. Nothing you cannot open is ' +
    'ever listed either way.',
  'you.activity.scope.all': 'Everything I can see',
  'you.activity.scope.watched': 'Only pages I watch',
  'you.activity.off': 'No such mail',
  'you.activity.daily': 'Every weekday morning',
  'you.activity.weekly': 'Monday mornings',
  'you.notifications.schedule': 'How often',
  'you.notifications.schedule.hint':
    'A daily mail arrives at eight in the morning, in your own timezone, and ' +
    'only if something is still unread.',
  'you.notifications.schedule.batched': 'As things happen',
  'you.notifications.schedule.daily': 'Once a day',
  'you.notifications.schedule.off': 'Never email me',
  'you.notifications.mentions': 'Email me when somebody mentions me',
  'you.notifications.assignments': 'Email me when somebody gives me a task',
  'you.notifications.replies': 'Email me about replies in comments I am in',
  'you.notifications.replies.hint':
    'Off by default: this is the kind that arrives most often and asks least.',
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
  'workspaces.area': 'Workspaces',
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
  'trash.group.when': 'View',
  'trash.group.kind': 'By kind',
  'trash.view.recent': 'Recently deleted',
  'trash.view.expiring': 'Going soon',
  'trash.view.pages': 'Pages',
  'trash.view.folders': 'Folders',
  'trash.scope': '{workspace} · kept for 30 days',
  'trash.daysLeft': '{count, plural, one {# day left} other {# days left}}',
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
  'search.chip.in': 'in {value}',
  'search.chip.inMany': 'in {value} · {count} folders',
  'search.chip.inNone': 'in {value} · no such folder',
  'search.chip.author': 'Written by {value}',
  'search.chip.assignedMe': 'Assigned to me',
  'search.chip.assigned': 'Assigned to {value}',
  'search.chip.after': 'Edited on or after {value}',
  'search.chip.before': 'Edited on or before {value}',
  'search.chip.notADate': 'Not a date. Use YYYY-MM-DD.',
  'search.keep': 'Keep this search',
  'search.nameIt': 'Call it something',
  'search.forget': 'Forget {name}',
  'search.syntax':
    'Narrow it by typing tag:name, in:folder, author:name, assigned:me, ' +
    'after:2026-08-01 or before:2026-09-01. A filter on its own works too.',
  'search.nothing': 'Nothing matched.',
  'search.didYouMean': 'Did you mean',
  'search.similar': 'Similar names',
  // Why a result matched: the name rather than something in the text.
  'search.matchedTitle': 'title',

  // --- a table of entries ------------------------------------------------
  'table.emptyTitle': 'Move every entry in this collection to the trash',
  'table.confirmEmpty':
    'Move every entry in this collection to the trash? Each one is a page, so ' +
    'nothing is destroyed — they can be restored from the trash, or with undo.',
  'board.allSorted': 'Everything is sorted.',
  'board.emptyColumn': 'Nothing here yet.',
  'board.noneLoaded': 'None of the loaded rows. There may be more.',
  'table.countOf': '{shown} of {total} rows',
  'table.countMany': '{shown} rows, of more than 10 000',
  'table.more': 'Show more rows',
  'table.sortedWhole':
    'Sorted by a computed column, so every row was read to order them. Other ' +
    'sorts load a page at a time.',
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
  'access.viewer': 'Can view',
  'access.commenter': 'Can read and comment',
  'access.editor': 'Can edit',
  'access.admin': 'Can manage',
  // "Can edit · from a group called Editors" — one message, because word order
  // and the case of "from" differ by language.

  // --- the block menu ----------------------------------------------------
  'block.insert': 'Insert a block',
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
  'block.assignee': 'Assigned to',
  'block.assignee.nobody': 'Nobody',
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
  'diff.whatThisDid': 'What this changed',
  'diff.sinceThen': 'Changed since',
  'diff.added': 'Added',
  'diff.removed': 'Removed',
  'diff.changed': 'Rewritten',
  'diff.moved': 'Moved',
  'diff.movedFrom': 'from position {from} to {to}',
  'diff.empty': '(empty)',
  'diff.nothing': 'Nothing changed.',
  'diff.compare': 'Compare',
  'diff.noFormatting':
    'Bold, italic and links are not compared \u2014 only the words.',
  'diff.approximate':
    '{count} blocks could not be matched between the two versions, so this ' +
    'comparison is approximate for those.',
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
  'comment.startInternal': 'Only for members — a share link cannot read this',
  'comment.viaEmail': 'by email',
  'comment.viaEmail.hint':
    'This arrived as a reply to a notification. SONE trimmed the quoted part.',
  'comment.trimmed': 'trimmed',
  'comment.attachmentsDropped': 'attachments not kept',
  'comment.internal': ' · internal',
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
  'comment.aboutItem': 'About an item on the canvas',
  'comment.startPlaceholder': 'What about this?',
  'panel.guest': 'guest',
  'panel.guestWriting':
    'Some of this was written before the page began keeping track, or by ' +
    'somebody who gave no name at all.',
  'panel.noPeople':
    'Nobody is recorded yet. Writing is attributed from the moment it is written, so ' +
    'anything typed before this page started keeping track is not listed here.',
  // --- a canvas (ADR-0043) ------------------------------------------------
  'canvas.commented': '{count, plural, one {One comment} other {# comments}}',
  'canvas.commentedInternal':
    '{count, plural, one {One comment} other {# comments}}, {internal} of them ' +
    'only for members',
  'canvas.tools': 'Canvas tools',
  'canvas.tool.select': 'Select',
  'canvas.tool.hand': 'Move the board',
  'canvas.tool.pen': 'Pen',
  'canvas.tool.text': 'Text',
  'canvas.remove': 'Remove this',
  'canvas.handle': 'What to do with this',
  'canvas.comment': 'Comment on this',
  'canvas.duplicate': 'Duplicate',
  'canvas.lock': 'Lock in place',
  'canvas.unlock': 'Unlock',
  'canvas.toFront': 'Bring to front',
  'canvas.textItem': 'Text on the canvas',
  'canvas.resize': 'Resize this',
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
  'reset.forgot': 'Forgot your password?',
  'reset.askTitle': 'Set a new password',
  'reset.askHint':
    'Enter the address you sign in with. If it has an account, a link is on its ' +
    'way — the link works for an hour and once.',
  'reset.ask': 'Send me a link',
  'reset.asking': 'Sending…',
  'reset.askedTitle': 'Check your mail',
  'reset.askedHint':
    'If that address has an account here, a link is on its way. It works for an ' +
    'hour. Nothing has changed until you use it.',
  'reset.setTitle': 'Choose a new password',
  'reset.setHint':
    'At least 12 characters. Everywhere you are signed in will be signed out, ' +
    'including here.',
  'reset.newPassword': 'New password',
  'reset.set': 'Set the password',
  'reset.setting': 'Saving…',
  'reset.done': 'The password is set',
  'reset.done.hint':
    'Every session was signed out, so sign in again with the new password.',
  'reset.toSignIn': 'Go to sign in',
  'reset.backToSignIn': 'Back to sign in',
  'auth.secondFactor': 'One more step',
  'auth.secondFactor.hint':
    'Enter the six-digit code from your authenticator app.',
  'auth.code': 'Code',
  'auth.checking': 'Checking…',
  'auth.secondFactor.lost':
    'Lost the app? Use one of your recovery codes instead. If those are gone ' +
    'too, whoever runs this instance can remove the second factor for you.',
  'error.unknown_account': 'No such account.',
  'error.page_not_found': 'That page is not there.',
  'error.second_factor_required':
    'This instance now requires two-step sign-in. Set up an authenticator to ' +
    'carry on.',
  'error.enrol_yourself_first':
    'Set up an authenticator on your own account before requiring one of ' +
    'everybody.',
  'error.one_archive_at_a_time':
    'Pick either one archive or several Markdown files, not both at once.',
  'error.too_many_to_pack': 'That is more files than the import packs at once.',
  'error.too_many_entries':
    'That archive holds more files than the import reads at once. Split it, or ' +
    'import a folder at a time.',
  'error.zip64_unsupported':
    'That archive is in the Zip64 format, which the import cannot read. ' +
    'Re-creating it with ordinary zip usually works.',
  'error.wrong_code': 'That code is not right.',
  'error.code_already_used':
    'That code has been used already. Wait for the next one.',
  'error.ticket_expired': 'That took too long. Sign in again.',
  'error.already_enrolled': 'There is already an authenticator on this account.',
  'error.no_enrolment': 'Nothing to confirm. Start again.',
  'error.wrong_password': 'That password is not right.',
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
