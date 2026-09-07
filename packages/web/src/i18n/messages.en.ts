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
  'inbox.title': 'Inbox',
  'settings.title': 'Settings',
  // Two areas, not three: a workspace has one of its own (ADR-0070).
  'settings.scope': 'Just yours',
  'admin.scope': 'Everyone on this server',
  'inbox.group.state': 'Inbox',
  'inbox.group.kind': 'By kind',
  'inbox.group.workspace': 'By workspace',
  'inbox.view.unread': 'Unread',
  'inbox.view.all': 'Everything',
  'inbox.view.snoozed': 'Later',
  'inbox.emptyView': 'Nothing here in this view.',
  'inbox.empty':
    'Nothing is waiting. This is where it appears when somebody names you in ' +
    'a comment, or replies in a thread you are part of.',
  'inbox.unreadOnly': 'Only what is unread',
  'inbox.markAll': 'Mark everything read',
  'inbox.times': '{count, plural, one {# time} other {# times}}',
  'inbox.keys': 'j/k to move · Enter opens · e read · u unread · s later',
  'inbox.markRead': 'Read',
  'inbox.markUnread': 'Unread',
  'inbox.snooze': 'Later',
  'inbox.snooze.later': 'In three hours',
  'inbox.snooze.tomorrow': 'Tomorrow morning',
  'inbox.snooze.nextWeek': 'Next week',
  'inbox.wake': 'Bring it back',
  'inbox.remove': 'Remove',
  'inbox.answer': 'Reply',
  'inbox.answer.placeholder': 'Write a reply… Enter sends, Shift+Enter makes a line.',
  'inbox.answer.send': 'Send',
  'inbox.answer.sending': 'Sending…',
  'inbox.answer.failed': 'It could not be sent.',
  'inbox.backOn': 'back on {when}',
  'inbox.mention': 'You were named',
  'inbox.reply': 'A reply in a thread',
  'inbox.assignment': 'Assigned to you',
  'inbox.noEmail': 'SONE does not send email. This is where notifications are.',
  // The same sentence for an instance that does (ADR-0139). It names the
  // setting rather than the answer: whether *you* are emailed is yours, and
  // this screen is not the place to state somebody's own preference back at
  // them.
  'inbox.andEmail':
    'Notifications live here. Whether you are also emailed is up to you, under You → Notifications.',
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
  'sidebar.show': 'Show the sidebar',
  'sidebar.search': 'Search',
  'sidebar.places': 'Parts of SONE',
  'mode.pages': 'Pages',
  'mode.you': 'You',
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
  'error.empty_message': 'A comment needs something in it.',
  'error.message_too_long': 'That comment is longer than a comment can be.',
  'error.invalid_anchor': 'That comment lost the passage it was about. Select the text again.',
  'error.too_many_threads': 'This page is holding as many threads as it can. Resolve a few first.',
  'error.not_your_link': 'That connection was begun for a different account.',
  'error.no_other_way_in':
    'That is the only way into this account. Set a password first, or you would ' +
    'be locking yourself out.',
  'error.already_linked_elsewhere':
    'That provider account is already connected to somebody else here.',
  'error.already_have_one':
    'This account already has a provider connected. Disconnect that one first.',
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
  'error.invalid_color_scheme': 'Light or dark — there is nothing else to be.',
  'error.invalid_landing': 'That is not a way to set a first page (ADR-0119).',
  'error.invalid_cover':
    'That is not a cover this can store. A picture has to be one uploaded here '
    + '(ADR-0117).',
  'error.unsupported_color': 'That colour is not one of the eight.',
  'error.invalid_level': 'There is no such page level.',
  'error.invalid_right': 'There is no such right.',
  'error.system_role': 'Built-in roles cannot be changed or deleted.',
  'error.role_in_use': 'Somebody still holds this role. Move those people and groups first.',
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
  // Only shown where the instance has a relay (ADR-0139).
  'workspace.export.willMail':
    'It keeps going if you close this. You will be emailed when the archive is ready.',
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
  'swatch.asDesigned': '{label}: as designed',
  'swatch.own': '{label}: a colour of your own',
  'sidebar.unfavourite': 'Remove {title} from favourites',
  'entry.untitled': 'Untitled',
  // What an entry is called in a sentence when it has no title of its own.
  'entry.thisOne': 'this entry',
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
  // The counts on the overview, which were assembled in the markup from a
  // number and an `s` (ADR-0148).
  'admin.counts.admins': '{count, plural, one {# administrator} other {# administrators}}',
  'admin.counts.deactivated': '{count} deactivated',
  'admin.counts.content':
    '{pages, plural, one {# page} other {# pages}} in ' +
    '{folders, plural, one {# folder} other {# folders}}',
  'admin.counts.files': '{count, plural, one {# attachment} other {# attachments}}',
  'admin.counts.onDisk': '{size} on disk',
  'admin.workspaces': 'Workspaces',
  'admin.accounts': 'Accounts',
  'admin.accounts.hint': 'Everybody with an account here',
  'admin.accounts.note':
    'Deactivating keeps the account and its work, and signs it out immediately. ' +
    'Accounts are never deleted from here: removing one would take every page it ' +
    'created with it, and “this person has left” is not “their work never happened”.',
  // A row in that list (ADR-0146). The two rights are switches, the two others
  // are buttons, and the line under the name is what the account *is*.
  'admin.account.you': 'you',
  'admin.account.noAddress': 'no address',
  'admin.account.guest': 'share-link guest',
  'admin.account.workspaces': '{count, plural, one {# workspace} other {# workspaces}}',
  'admin.account.deactivated': 'deactivated',
  'admin.account.administrator': 'Administrator',
  'admin.account.managesWorkspaces': 'Manages workspaces',
  'admin.account.deactivate': 'Deactivate',
  'admin.account.reactivate': 'Reactivate',
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
  'admin.maintenance.ran':
    'Recovered {recovered, plural, one {# projection} other {# projections}}, ' +
    'compacted {compacted, plural, one {# document} other {# documents}}.',
  // A pass in which every task threw used to render exactly like a clean one.
  'admin.maintenance.failed':
    '{count, plural, one {# task failed} other {# tasks failed}} in this pass:',
  'admin.welcomeMail': 'Welcome mail',
  'admin.welcomeMail.hint':
    'A short mail on somebody’s first sign-in. Off unless you turn it on — an ' +
    'instance where an administrator makes accounts for colleagues and tells ' +
    'them in person does not need it. The notice about a sign-in from an ' +
    'unfamiliar browser deliberately has no switch.',
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
  'admin.brand': 'Appearance',
  'admin.brand.section.hint': 'This instance’s logo and base design.',
  'admin.brand.hint':
    'Both are visible before anybody signs in, which is the point of them.',
  'admin.brand.choose': 'Choose a logo',
  'admin.brand.remove': 'Remove the logo',
  'admin.brand.logo.note':
    'Square is best; PNG, JPEG or WebP. A nearly square picture is fitted ' +
    'rather than stretched. With no logo the interface draws its own mark.',
  'admin.brand.design': 'Base design',
  'admin.brand.design.hint':
    'Used wherever a workspace has set nothing of its own. A workspace fills ' +
    'in over it rather than replacing it.',
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
  'admin.addressForm.hint':
    'In German and other languages that distinguish it. English has one form and is ' +
    'unaffected.',
  'admin.mail.noUser': '(no user)',
  'admin.mail.usingLine': '{user} @ {host}:{port} · {security} · from {from}',
  'admin.pendingNote': 'normal while people are editing',
  'admin.noMessage': 'no message recorded',
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
  'mention.pick': 'Mention somebody',
  'mention.nobody': 'There is nobody else in this workspace yet.',
  'mention.noMatch': 'Nobody here matches “{query}”.',
  'you.sso': 'Single sign-on',
  'you.sso.note':
    'Sign in with the provider this instance is configured for, instead of your ' +
    'password. Your password keeps working; connecting one adds a second way in ' +
    'rather than replacing the first.',
  'you.sso.connected': 'Connected to',
  'you.sso.connect': 'Connect',
  'you.sso.disconnect': 'Disconnect',
  'you.sso.justLinked': 'Connected. You can sign in with it from now on.',
  'you.sso.onlyWayIn':
    'This is the only way into this account. Set a password first, or you would ' +
    'be locking yourself out.',
  'you.signIn.hint': 'Your password',
  'you.appearance': 'Appearance',
  'you.appearance.hint': 'How SONE looks to you',
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
  'you.newPassword.hint':
    'At least twelve characters. Length is what makes a password hard to guess; a ' +
    'short one with symbols in it is not.',
  'you.changePassword': 'Change password',
  'you.changingPassword': 'Changing…',
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
    'Light or dark belongs to your account and applies wherever you sign in. ' +
    'The two text sizes stay in this browser: a size that suits a phone is ' +
    'wrong on a large monitor.',
  'you.theme': 'Theme',
  'you.theme.hint':
    'With no choice of your own, the workspace decides. “Match the system” is ' +
    'itself a choice and overrides it — somebody outside in the sun wants light ' +
    'whatever their workspace thinks.',
  'you.theme.workspace': 'As the workspace says',
  'you.theme.system': 'Match the system',
  'you.theme.light': 'Light',
  'you.theme.dark': 'Dark',
  'you.interfaceSize': 'Interface text size',
  'you.interfaceSize.hint': 'The sidebar, menus and settings — everything but your writing.',
  'you.editorSize': 'Editor text size',
  'you.editorSize.hint': 'Your writing, and nothing else.',
  'you.density': 'Density',
  'you.density.hint':
    'How tightly the interface is packed. Kept in this browser, like the sizes above — a phone and a monitor want different answers.',
  'you.thisBrowser': 'This browser',

  'about.server': 'Server',
  'about.documentFormat': 'Document format',
  'about.stale':
    'This browser is running an older build than the server. Reload to pick up the ' +
    'current version — until then, what you see may not match what the server does.',
  'about.licence':
    'SONE is free software under the AGPL-3.0. No seat limits, no feature gates, no ' +
    'enterprise edition.',
  'about.syncProtocol': 'Sync protocol',
  'about.checking': 'checking…',

  // --- this workspace's settings -----------------------------------------
  'workspace.nameAndMark': 'Name and mark',
  'workspace.nameAndMark.hint': 'What this workspace is called and how it is recognised',
  'workspace.typography': 'Type',
  'workspace.typography.hint': 'Sizes and spacing for headings, text and code.',
  'workspace.colours': 'Colours & surfaces',
  'workspace.colours.hint': 'Tint, accent, and the eight colour names.',
  'workspace.landing': 'First page',
  'workspace.landing.hint': 'What this workspace opens with, for everybody.',
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
  'page.opening': 'Opening…',
  'page.otherPeopleHere': '{count, plural, one {# other person here} other {# other people here}}',
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
  'format.copied': 'Copied',
  'format.copy': 'Copy',
  'format.copyCode': 'Copy the code',
  'format.linkWord': 'Link',
  // The letter on each button is not translated — B, I, S are the shapes people
  // know — but the tooltip that says what it does is.
  'format.bold': 'Bold (Mod-B)',
  'format.italic': 'Italic (Mod-I)',
  'format.strikethrough': 'Strikethrough',
  'format.code': 'Code (Mod-E)',
  'format.removeLink': 'Remove',
  'slash.noMatch': 'No blocks match “{query}”',
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
  'workspaces.loading': 'Loading…',
  'workspaces.youAreHere': 'you are here',
  'workspaces.deleted': 'deleted',
  'workspaces.personal.note':
    'One for each account. {count, plural, one {# in total} other {# in total}}.',
  'workspaces.show': 'Show',
  'workspaces.hide': 'Hide',
  'workspaces.creating': 'Creating…',
  'workspaces.memberCount': '{count, plural, one {# person} other {# people}}',
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
  'workspaces.all': 'All workspaces',
  'workspaces.chosen': 'This workspace',

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
  'group.members': '{count, plural, one {# person} other {# people}}',
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
  'oidc.noSecret':
    'No client secret is set. Add SONE_OIDC_CLIENT_SECRET to the server’s environment ' +
    'and restart it; single sign-on stays off until then. The secret is deliberately ' +
    'not stored here — a secret in the database is a secret in every backup.',
  'oidc.issuer.hint':
    'The provider’s base URL. Everything else is read from its discovery document, so ' +
    'nothing here needs to know which provider it is.',
  'oidc.callback':
    'Add /api/auth/oidc/callback on this instance’s public URL to the provider’s list ' +
    'of redirect URIs.',
  'oidc.buttonLabel.hint':
    'What the sign-in page says. People recognise their own login by name, not by the ' +
    'protocol behind it.',
  'oidc.allowSignup.hint':
    'Off by default. Trusting a provider to say who somebody is does not oblige you to ' +
    'let everybody there in.',
  'invitation.used':
    'This invitation has already been used. If that was you just now, your account is ' +
    'ready.',
  'invitation.invitedTo': 'You have been invited to join {workspace}.',
  'invitation.aWorkspace': 'a workspace',
  'invitation.join': 'Join',
  'invitation.joining': 'Joining…',
  'invitation.checking': 'Checking the invitation…',
  'invitation.keepsYours': 'Your own workspace stays where it is. Joining adds this one beside it.',
  'option.rename.note':
    'Rename an option freely — entries keep it. Removing one hides it from the entries ' +
    'that use it, and adding a new option with the same name does not bring them back.',
  // The provider's name stays as it is written; the sentence around it does not
  // (ADR-0148).
  'video.embedVerdict': 'A {provider} video. Nothing is loaded from them until somebody presses play.',
  'video.streamVerdict': 'A live {kind} stream, played in the page.',
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
  'invite.outstanding': 'Outstanding invitations',
  'invite.anybodyWithLink': 'Anybody with the link',
  'invite.role': 'Role',
  'invite.for': 'For',
  'invite.expires': 'Expires',
  'invite.used': 'Used',
  'invite.withdraw': 'Withdraw',
  // How often a link may be used, asked instead of assumed (ADR-0147).
  'invite.maxUses': 'How many people may use it',
  'invite.maxUses.hint':
    'One link, one person, unless you say otherwise. More is how you invite a group ' +
    'without typing every address — and it is a link, so it can be forwarded by ' +
    'anybody who has it.',
  'invite.usedOf': '{used} of {max}',
  'invite.create': 'Create invitation',
  'invite.creating': 'Creating…',
  'invite.link.note':
    'Copy it now — it is not stored anywhere it can be read again, and this screen ' +
    'will not show it a second time.',
  'invite.link.mailed':
    'Sent to {address}. The link is here as well, in case it does not arrive: it is ' +
    'not stored anywhere it can be read again.',
  'invite.withdraw.of': 'Withdraw the invitation for {who}',

  // --- groups and page permissions ---------------------------------------
  // --- Roles (ADR-0087) -----------------------------------------------------
  'role.note':
    'A role says two things: what somebody may do on pages with no rules of their own, and what they may manage in the workspace. Roles can be given to people and to groups.',
  'role.new': 'New role',
  'workspace.roleUnknown': 'role unknown',
  'role.name': 'Name',
  'role.name.note': 'What the role is called in lists.',
  'role.namePlaceholder': 'Editorial',
  'role.level': 'On pages',
  'role.level.note':
    'Applies to pages nothing was shared on. An individual share can give more, never less.',
  'role.level.none': 'Nothing without an explicit share',
  'role.rights': 'In the workspace',
  'role.rights.note': 'Independent of each other. None of them is needed to do your own work.',
  'role.edit': 'Change',
  'role.delete': 'Delete',
  'role.builtIn': 'Built in',
  'role.heldBy':
    '{members, plural, =0 {No people} one {One person} other {# people}}' +
    '{groups, plural, =0 {} one {, one group} other {, # groups}}',
  'role.heldByNamed':
    '{rest, plural, =0 {{names}} one {{names} and one more} other {{names} and # more}}',
  'role.heldByNobody': 'Nobody has it yet',
  'role.card.onPages': 'On pages',
  'role.card.inWorkspace': 'In the workspace',
  'role.card.noRights': 'Manages nothing',
  'role.confirmDelete': 'Delete “{name}”?',
  'role.forGroup': 'This group’s role',
  'role.groupNone': 'No role',
  'right.people.manage': 'Manage people',
  'right.groups.manage': 'Manage groups',
  'right.workspace.settings': 'Workspace settings',
  'right.roles.manage': 'Define roles',
  'workspace.roles': 'Roles',
  'workspace.roles.hint': 'What somebody may do, and who holds which role',

  'group.new': 'New group',
  'group.namePlaceholder': 'Editors',
  'group.addSomebody': 'Add somebody',
  'group.choosePerson': 'Choose a person…',
  'group.nobody': 'Nobody yet.',
  'group.create': 'Create',
  'group.delete': 'Delete',
  'group.remove': 'Remove',
  // --- Cap (ADR-0087) --------------------------------------------------------
  'cap.label': 'At most',
  'cap.none': 'No ceiling',
  'cap.note':
    'Limits what is possible here at most, including for the people given more below. Whoever administers the workspace is exempt; otherwise a ceiling could never be lifted.',
  'cap.inherited': '“{from}” already applies here: {level}.',

  // --- Sharing overview -------------------------------------------------------
  'shares.title': 'Shares',
  'shares.note':
    'What is shared out of this workspace — and what has been shared with you. Both can be withdrawn from here.',
  'shares.links': 'Links',
  'shares.links.note':
    'Anybody holding the link gets in. Review these first: a link leaves the building.',
  'shares.granted': 'Shared by you',
  'shares.received': 'Shared with you',
  'shares.nothing': 'Nothing.',
  'shares.subtree': 'with subpages',
  'shares.onlyPage': 'this page only',
  'shares.viaGroup': 'through the group “{name}”',
  'shares.by': 'from {name}',
  'shares.protected': 'password protected',
  'shares.expires': 'expires {date}',
  'shares.mine': 'yours',
  'shares.revoke': 'Revoke',
  'shares.open': 'Open page',

  'tree.pathOnly': 'Not shared with you',
  'perm.people': 'People',
  'perm.peopleHere': 'People in this workspace',
  'perm.groups': 'Groups',
  'perm.addGroup': 'Add a group',
  'perm.chooseGroup': 'Choose a group…',
  'perm.checking': 'Checking…',
  'perm.restricted.note':
    'The workspace cannot reach this page or anything under it. Owners and admins ' +
    'still can — somebody has to be able to undo this.',
  'perm.open.note':
    'Everybody in the workspace can reach this page. Adding someone below gives them ' +
    'more than their role does, never less.',
  'perm.inheritedFrom': '{level} · from {source}',
  'perm.accessFor': 'Access for {who}',
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
  'tag.remove': 'Remove {tag}',
  'tag.add': 'Add a tag',
  'tag.none': 'None',

  // --- sharing a page ----------------------------------------------------
  'share.signInRequired':
    'This link needs an account',
  'share.signInRequired.hint':
    'Whoever made this link asked for people to be signed in, so their name is recorded with anything they write. Sign in and open the link again.',
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
  'share.byMail': 'Send by mail',
  'share.byMail.note':
    'The mail carries the link, who sent it and when it expires — plus the ' +
    'sentence below, if there is one. No page content.',
  'share.byMail.to': 'To',
  'share.byMail.message': 'A sentence with it (optional)',
  'share.byMail.send': 'Send',
  'share.byMail.sent': 'Sent to {to}.',
  'error.invalid_address': 'That does not look like an email address.',
  'error.no_relay': 'This instance cannot send mail.',
  'share.revoke': 'Revoke',
  // The link dialog's own words (ADR-0148).
  'share.copy': 'Copy',
  'share.copied': 'Copied',
  'share.includeSubpages': 'Include subpages',
  'share.password': 'Password (optional)',
  'share.password.tooShort':
    'At least {count} characters — a link password protects the same content an ' +
    'account password does.',
  'share.withSubpages': 'with subpages',
  'share.thisPageOnly': 'this page only',
  'share.hasPassword': 'password',
  'share.until': 'until {date}',
  'share.noExpiry': 'no expiry',
  'share.inUseBy': 'in use by {count}',
  'share.onASubpage': 'on a subpage',
  'share.show': 'Show link',
  'share.shown': 'Shown',
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
  'type.note.type':
    'Sizes and spacing for this workspace. A block that carries its own size or colour ' +
    'keeps it — these apply where nobody has chosen.',
  'type.note.colour':
    'How this workspace looks: the tint on its surfaces, the accent, and what the eight ' +
    'colour names mean. Applies wherever nobody has chosen something of their own.',
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

  // --- one piece of furniture at a time (ADR-0122) ------------------------
  'type.surfaces': 'Surfaces',
  'type.surfaces.note':
    'Single parts of the interface can be treated differently from the rest — ' +
    'the narrow rail dark, everything else light. What is chosen is a ' +
    'relationship and not a colour: “inverted” is dark in the light theme and ' +
    'light in the dark one, from one stored value.',
  'type.surface.rail': 'Narrow rail',
  'type.surface.sidebar': 'Sidebar',
  'type.surface.panel': 'Right panel',
  'type.treatment.follow': 'As designed',
  'type.treatment.raised': 'Raised',
  'type.treatment.sunken': 'Sunken',
  'type.treatment.inverted': 'Inverted',
  'type.treatment.accent': 'Accent',
  'type.fonts': 'Type',
  'type.fonts.note':
    'What is chosen is a pair — the face for text and the one for code — not a ' +
    'font name. Every face is served by this instance; “as the device” loads ' +
    'none at all.',
  'type.fonts.designed': 'As designed (Archivo)',
  'type.fonts.reading': 'For reading (Literata)',
  'type.fonts.plain': 'Plain (Inter)',
  'type.fonts.system': 'As the device',
  'type.file': 'The theme as a file',
  'type.file.note':
    'A file holds the whole theme — colours, surfaces, corners, type and ' +
    'light-or-dark. Loading one fills in the form; nothing is stored until you ' +
    'press Save.',
  'type.file.export': 'Export',
  'type.file.import': 'Import',
  'type.file.loaded': '“{name}” loaded — not saved yet.',
  'type.file.unnamed': 'Unnamed',
  'error.not_a_theme': 'That is not a SONE theme file.',
  'type.scheme': 'Light or dark',
  'type.scheme.inherit': 'As the instance says',
  'type.scheme.light': 'Light',
  'type.scheme.dark': 'Dark',
  'type.scheme.system': 'As the device says',
  'type.corners': 'Corners',
  'type.corners.note':
    'Three steps rather than a number: all three radii move together, so a ' +
    'small control does not become a pill by accident.',
  'type.corners.sharp': 'Sharp',
  'type.corners.soft': 'As designed',
  'type.corners.round': 'Round',

  // --- where a workspace opens -------------------------------------------
  'landing.title': 'Where you land',
  'landing.lastPage': 'The page you were on last',
  'landing.lastPage.hint': 'Follows you: whatever you had open in this workspace.',
  'landing.fixedPage': 'A particular page',
  'landing.fixedPage.hint': 'Always the same one, whatever you were doing.',
  'landing.top': 'The top page',
  'landing.top.hint': 'The first in the tree. It changes when somebody reorders.',
  'landing.newest': 'The most recently edited page',
  'landing.newest.hint': 'Where the work is — not the one created last.',
  'landing.page': 'Page',
  'landing.choose': 'Choose a page…',
  // --- and a person's own answer (ADR-0119) ------------------------------
  'landing.mine': 'For you',
  'landing.mine.note':
    'Only for you, and only in this workspace. Everybody else keeps following what is ' +
    'set above.',
  'landing.follow': 'Whatever the workspace says',
  'landing.follow.hint': 'Currently: {what}',

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
  'move.heading': 'Move “{title}”',
  'move.title': 'Move to',
  'move.root': 'Workspace root',
  'move.find': 'Find a folder',
  'move.noMatch': 'No folder matches.',

  'action.saving': 'Saving…',
  // The theme table's controls, named for a screen reader by element and by
  // what the control changes (ADR-0148).
  'theme.reset': 'Reset {name}',
  'theme.elementSize': '{element} size',
  'theme.elementColour': '{element} colour',
  'theme.elementSpaceAbove': '{element} space above',
  'theme.elementSpaceBelow': '{element} space below',
  'action.saved': 'Saved.',

  // --- the trash ---------------------------------------------------------
  'trash.title': 'Trash',
  'trash.group.when': 'View',
  'trash.group.kind': 'By kind',
  'trash.view.recent': 'Recently deleted',
  'trash.view.expiring': 'Going soon',
  'trash.view.pages': 'Pages',
  'trash.view.folders': 'Folders',
  // Retention only: which workspace is the chooser above it (ADR-0114).
  'trash.scope': 'Kept for 30 days',
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
  'trash.search': 'Search the trash',
  'trash.emptyView': 'Nothing in this view.',
  'trash.noMatch': 'Nothing is called “{query}”.',
  'trash.deletedAt': 'deleted {at}',
  'trash.withInside':
    '{count, plural, one {with # entry inside} other {with # entries inside}}',
  'trash.folderGone': 'the folder it was in is gone',
  'trash.read': 'Look inside',
  'trash.hide': 'Close',
  'trash.unreadable': 'Its contents cannot be read just now.',
  'trash.nothingInIt': 'No text in it.',
  'trash.andMore': '… and more.',
  'trash.restoreTo': 'Restore to…',
  'trash.restoreTitle': 'Restore “{title}” to',
  'trash.parentGone':
    'The folder this was in was deleted as well. Choose where it should come back.',

  // --- search ------------------------------------------------------------
  'search.title': 'Search',
  // --- filters in the search mode (ADR-0118) --------------------------------
  'search.saved': 'Kept',
  'search.facet.tags': 'Tags',
  'search.facet.findTag': 'Find a tag',
  'search.facet.findTagPlaceholder': 'Type a tag…',
  'search.facet.people': 'People',
  'search.facet.who': 'Find a person',
  'search.facet.whoPlaceholder': 'Type a name…',
  'search.facet.assignedMe': 'Assigned to you',
  'search.facet.writtenBy': 'By {name}',
  'search.facet.in': 'In folder',
  'search.facet.anywhere': 'Anywhere',
  'search.facet.when': 'Last edited',
  'search.facet.after': 'From',
  'search.facet.before': 'To',
  'search.facet.clear': 'Clear filters',
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
  // The table's own labels, most of them read only by a screen reader
  // (ADR-0148).
  'table.groupBy': 'Group by {field}',
  'table.selectNone': 'Clear the selection',
  'table.selectAll': 'Select every entry shown',
  'table.nameColumn': 'Name',
  'table.selectEntry': 'Select {title}',
  'table.openEntry': 'Open {title}',
  'table.thisEntry': 'this entry',
  'table.renameColumn': 'Rename the {field} column',
  'table.editOptions': 'Edit the options of {field}',
  'table.removeColumn': 'Remove the {field} column',
  'table.titleColumn': 'Every entry has a title',
  'table.name': 'Name',
  'table.untitled': 'Untitled',
  'option.colourFor': 'Colour for {option}',
  'option.remove': 'Remove {option}',
  'option.thisOne': 'this option',
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
  'role.owner': 'Owner',
  'role.owner.hint': 'May transfer and delete the workspace',
  'access.add': 'Give access',
  'access.note':
    'For people who already have an account on this server. Somebody who does ' +
    'not is invited from the administration — that makes an account, which is ' +
    'a different thing.',
  'access.example': 'someone@example.org',
  'access.address': 'Email address',
  'access.address.hint': 'The address they sign in here with.',
  // --- finding somebody rather than typing an address (ADR-0119) ------------
  'access.person': 'Person',
  'access.person.hint': 'A name or an email address. Suggestions from two characters.',
  'access.alreadyHere': 'is already here',
  'access.willAdd': '{name} ({email}) will get access.',
  'access.as': 'They come in as',
  'access.give': 'Give access',
  'access.given': '{email} has access now.',
  'error.no_such_account':
    'There is no account here with that address. New people are invited from the administration.',
  'error.already_member': 'They are already in this workspace.',
  'error.invalid_email': 'Please enter an email address.',
  'member.roleFor': 'Role for {name}',
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
  'block.actions.counted':
    'What to do with this block ({count, plural, one {# block} other {# blocks}} ' +
    'including children)',
  'block.appliesToNested':
    'Applies to this block and {count, plural, one {# nested block} other {# nested blocks}}',
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
  'panel.people.marked':
    'Their writing is marked in the page. Choose them again to clear it.',
  'panel.people.choose':
    'Choose somebody to see what they wrote. This is who has written here, not who is ' +
    'here now — which is what the circles at the top show instead.',
  'panel.people.departed': 'Somebody who has left',

  // --- a cover (ADR-0117) --------------------------------------------------
  'cover.add': 'Cover',
  'cover.change': 'Change cover',
  'cover.remove': 'Remove',
  'cover.upload': 'Upload a picture',
  'cover.uploading': 'Uploading…',
  'cover.colors': 'Colour',
  'cover.gradients': 'Gradient',
  'cover.own': 'A colour of your own',
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
  'panel.untitledFile': 'Untitled file',
  'panel.thisFile': 'this file',
  'panel.showThisInPage': 'Show {filename} in the page',
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
  'auth.sso': 'Single sign-on',
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
  'error.no_text': 'There is nothing there to send.',
  'error.thread_gone':
    'That conversation is gone — it was deleted while this row was sitting here.',
  'error.invalid_time':
    'That moment will not do: it has to be in the future and at most a year away.',
  'error.invalid_parent':
    'It cannot go there: a folder cannot sit inside itself.',
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
