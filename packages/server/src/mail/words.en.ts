/**
 * SONE server — what the mails say, in English (ADR-0133).
 *
 * The catalogue every letter is written from. It is the same arrangement the
 * interface has had since ADR-0041 — one file per language, the others typed
 * against this one — for the same reason: a key added here and forgotten in
 * German has to be a compile error rather than an English sentence arriving in
 * a German mailbox.
 *
 * ## Two things this file changes about the English
 *
 * **Plurals are plurals.** The letters said `${days} day(s)` and
 * `${n} page(s)`, which is what a form letter says rather than what a person
 * writes. A ternary would have been no better: `n === 1 ? 'day' : 'days'` is
 * English grammar written in code, and no catalogue can translate it (the note
 * at the top of `@sone/core`'s formatter says this at length).
 *
 * **A sentence is a sentence, not a prefix and a name.** Where a letter names
 * who did something, the whole sentence has two forms rather than one with a
 * name glued to the front: German cannot put a subject in front of *„Du wurdest
 * erwähnt"* and stay grammatical, and neither can English — *„Anna You were
 * mentioned on"*.
 *
 * ## What did not change
 *
 * **Who and where. Never what** (ADR-0058). A translated mail must not become a
 * mail that says more, and the tests that hold that line run against both
 * languages.
 */

export const en = {
  // --- an invitation, to somebody with no account yet (ADR-0121) ------------
  'invitation.subject': '{where}: you have been invited',
  'invitation.heading': 'You have been invited to {where}.',
  'invitation.body':
    'Follow the link to make an account. Nothing has been created for you yet — ' +
    'the account exists once you have set a password.',
  // Said, because a link that stops working without warning produces a question
  // to somebody who cannot see the problem.
  'invitation.expires':
    '{days, plural, one {The link works for one more day.} other {The link works for # more days.}}',
  'invitation.action': 'Set up your account',
  'invitation.footer':
    'If you were not expecting this, you can ignore it. Nothing happens until you sign up.',

  // --- added to a workspace (ADR-0121) -------------------------------------
  'access.subject': '{where}: you have access to {workspace}',
  'access.heading': 'You can now work in {workspace}.',
  'access.by': '{by} gave you access, as {role}.',
  'access.anon': 'You were given access, as {role}.',
  // No token and no link to accept: there is nothing to do, which is the whole
  // reason this is an announcement rather than an invitation.
  'access.nothing': 'There is nothing to accept — it is already yours to open.',
  'access.action': 'Open it',

  // --- access taken away (ADR-0128) ----------------------------------------
  'removal.subject': '{where}: your access to {workspace} has ended',
  'removal.heading': 'You no longer have access to {workspace}.',
  'removal.by': '{by} removed your access.',
  'removal.anon': 'Your access was removed.',
  'removal.gone':
    'Anything shared with you inside it has gone with it. If this is ' +
    'unexpected, ask whoever runs that workspace.',

  // --- a role changed (ADR-0128) -------------------------------------------
  'role.subject': '{where}: your role in {workspace} has changed',
  'role.heading': 'You are now {role} in {workspace}.',
  'role.by': '{by} changed your role.',
  'role.anon': 'Your role was changed.',
  // A role decides what somebody may do, and the honest thing to say is that it
  // may now be less rather than leaving them to find out.
  'role.mayDiffer': 'What you can do there may have changed with it.',
  'role.action': 'Open it',

  // --- an unfamiliar sign-in (ADR-0130) ------------------------------------
  'device.subject': '{where}: a new sign-in to your account',
  'device.heading': 'Somebody signed in from a browser this account has not used.',
  'device.where': 'Just now, from {from}.',
  'device.whereUnknown': 'Just now, from an address this instance could not see.',
  'device.otherwise':
    'If that was you, there is nothing to do. If it was not, change your ' +
    'password now and tell whoever runs this instance.',
  'device.action': 'Open your settings',
  // Said plainly, because the alternative is somebody trusting it to be more
  // than it is.
  'device.footer': 'This is sent once per browser. A browser is not proof of who was using it.',

  // --- the first sign-in of all (ADR-0130) ---------------------------------
  'welcome.subject': '{where}: welcome',
  'welcome.headingNamed': 'Welcome, {name}.',
  'welcome.heading': 'Welcome.',
  'welcome.ready': 'Your account on {where} is ready and you are signed in.',
  'welcome.workspaces':
    'Notes live in workspaces, and you will see the ones you have been ' +
    'given. Everything you write stays on this server.',
  'welcome.action': 'Open SONE',

  // --- an invitation nobody redeemed (ADR-0129) ----------------------------
  'chase.subject': '{where}: an invitation is still waiting',
  'chase.heading': 'Nobody has used this invitation yet.',
  'chase.toAddress':
    '{days, plural, one {You invited {who} to {workspace} one day ago.} ' +
    'other {You invited {who} to {workspace} # days ago.}}',
  'chase.asLink':
    '{days, plural, one {You made an invitation link for {workspace} one day ago.} ' +
    'other {You made an invitation link for {workspace} # days ago.}}',
  'chase.stillWorks': 'It still works. Send it again, or withdraw it if it was a mistake.',
  'chase.action': 'Open the invitations',

  // --- a link about to stop working (ADR-0129) -----------------------------
  'link.subject': '{where}: a link you shared expires soon',
  'link.heading': 'A link to {what} stops working on {when}.',
  'link.theyCannot': 'Whoever you sent it to will not be able to open it after that.',
  'link.makeNew': 'Make a new one if they still need it, or let it lapse.',
  // A page with no title of its own, named rather than quoted as an empty string.
  'link.somePage': 'a page',
  'link.action': 'Open SONE',

  // --- mail that did not go out (ADR-0129) ---------------------------------
  'outage.subject':
    '{where}: {count, plural, one {a notification did not go out} ' +
    'other {# notifications did not go out}}',
  'outage.heading': 'Some mail from this instance failed to send.',
  'outage.window':
    '{count, plural, one {One notification has failed since {when}.} ' +
    'other {# notifications have failed since {when}.}} ' +
    'This message arrived, so the relay is answering now.',
  // The mails themselves are gone: a notification is about something that has
  // already happened, and re-sending a week-old one is worse than not sending
  // it.
  'outage.notResent': 'The failed ones are not resent. Check the relay settings.',
  'outage.action': 'Open the administration',

  // --- a link somebody sent by hand (ADR-0126) -----------------------------
  // The subject names the sender and not the page: it is the half that is never
  // in doubt, and a subject line is the part of a mail most likely to be read
  // over somebody's shoulder.
  'share.subject': '{by} shared something with you',
  'share.line': '{by} shared {what} with you.',
  // Announced, never included. A link with a password and the password in the
  // same message is a link with no password.
  'share.password': 'This link is protected by a password. Ask whoever sent it.',
  'share.until': 'The link works until {when}.',
  'share.action': 'Open the page',
  'share.footer':
    'You are receiving this because somebody sent you a link. There is ' +
    'nothing to unsubscribe from.',

  // --- what changed (the digest) -------------------------------------------
  'digest.subject.weekly': 'SONE: what changed this week',
  'digest.subject.daily': 'SONE: what changed yesterday',
  'digest.somebody': 'somebody',
  'digest.workspace': '{workspace}:',
  'digest.byOne': '{title} — {who}',
  'digest.bySeveral':
    '{others, plural, one {{title} — {who} and one other} ' +
    'other {{title} — {who} and # others}}',
  'digest.changed': '{count, plural, one {one page changed} other {# pages changed}}',
  'digest.more': '{count, plural, one {and one more.} other {and # more.}}',
  'digest.action': 'Open SONE',

  // --- a notification (ADR-0058) -------------------------------------------
  'notify.mention': '{by} mentioned you on {what}.',
  'notify.mentionAlone': 'You were mentioned on {what}.',
  'notify.reply': '{by} replied to a comment you are in, on {what}.',
  'notify.replyAlone': 'There is a reply in a comment you are in, on {what}.',
  'notify.assignment': '{by} gave you a task on {what}.',
  'notify.assignmentAlone': 'You were given a task on {what}.',
  // Without an actor the page is the subject, which is the useful half.
  'notify.subjectOne': '{what}',
  'notify.subjectOneBy': '{by} — {what}',
  'notify.subjectMany':
    '{count, plural, one {one notification in {workspace}} ' +
    'other {# notifications in {workspace}}}',
  'notify.action': 'Open SONE',
  'notify.footer.noText': 'This message contains no comment text on purpose.',
  'notify.footer.stop': 'To stop these emails, sign in and change it under You → Notifications:',
} as const;

export type MailKey = keyof typeof en;
