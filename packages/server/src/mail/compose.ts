/**
 * SONE server — what a notification email says (ADR-0058).
 *
 * Who and where. Never what.
 *
 * No message text, no quoted passage, no excerpt. A mailbox is not a permission
 * system: it is a third party's server, retained indefinitely, searchable by
 * whoever administers it, forwarded by accident, readable on an unlocked phone
 * on a table. Everything this project has built about who may read what stops at
 * the moment a body of text leaves for an SMTP relay.
 *
 * Separate from the sending so that the rule above can be tested without a
 * relay, which is the part worth testing.
 */

export interface Waiting {
  kind: 'mention' | 'reply' | 'assignment';
  /** The page's title, used only when the instance allows that much. */
  pageTitle: string;
  pageId: string;
  /** Who caused it, by display name. A name is not content. */
  actor: string;
}

export interface ComposeInput {
  waiting: Waiting[];
  workspaceName: string;
  /** How much a mail may name (ADR-0058). */
  detail: 'title' | 'workspace';
  /** Where SONE lives, for the links. */
  baseUrl: string;
  locale: 'en' | 'de';
}

export interface Composed {
  subject: string;
  /** Plain text only: an HTML mail is a second thing to keep true. */
  body: string;
}

const LINES = {
  en: {
    one: (actor: string, where: string, kind: string) => `${actor} ${kind} ${where}.`,
    mention: 'mentioned you on',
    reply: 'replied to a comment you are in, on',
    assignment: 'gave you a task on',
    subjectOne: (actor: string, where: string) => `${actor} — ${where}`,
    subjectMany: (count: number, workspace: string) =>
      `${count} notifications in ${workspace}`,
    footer: (url: string) =>
      `\nOpen SONE: ${url}\n\nThis message contains no comment text on purpose.\nTo stop these emails, sign in and change it under You → Notifications:\n${url}/settings/notifications`,
  },
  de: {
    one: (actor: string, where: string, kind: string) => `${actor} ${kind} ${where}.`,
    mention: 'hat dich erwähnt auf',
    reply: 'hat auf einen Kommentar geantwortet, in dem du bist, auf',
    assignment: 'hat dir eine Aufgabe gegeben auf',
    subjectOne: (actor: string, where: string) => `${actor} — ${where}`,
    subjectMany: (count: number, workspace: string) =>
      `${count} Benachrichtigungen in ${workspace}`,
    footer: (url: string) =>
      `\nSONE öffnen: ${url}\n\nDiese Nachricht enthält absichtlich keinen Kommentartext.\nZum Abstellen anmelden und unter Du → Benachrichtigungen ändern:\n${url}/settings/notifications`,
  },
} as const;

/**
 * One mail for everything waiting for one person in one workspace.
 *
 * Not one per notification: somebody mentioned four times while a page is being
 * restructured gets four mails, and the fourth teaches them to filter the
 * sender.
 */
export function composeNotificationEmail(input: ComposeInput): Composed | null {
  if (input.waiting.length === 0) return null;

  const words = LINES[input.locale];
  const named = (one: Waiting): string =>
    // The page's title only when the instance allows it. `workspace` is for an
    // operator who cannot accept even a title leaving — then a mail says where
    // to look and nothing about what is there.
    input.detail === 'title' ? `“${one.pageTitle}”` : input.workspaceName;

  const lines = input.waiting.map((one) => words.one(one.actor, named(one), words[one.kind]));

  const first = input.waiting[0]!;
  const subject =
    input.waiting.length === 1
      ? words.subjectOne(first.actor, named(first))
      : words.subjectMany(input.waiting.length, input.workspaceName);

  /*
   * A link per line, and the base URL at the end.
   *
   * Plain URLs, not wrapped and not per-recipient: knowing whether somebody
   * followed a link is not worth becoming the kind of software that measures it
   * (ADR-0058).
   */
  const body = [
    ...lines.map((line, at) => {
      const one = input.waiting[at]!;
      return `${line}\n${input.baseUrl}/p/${one.pageId}`;
    }),
    words.footer(input.baseUrl),
  ].join('\n\n');

  return { subject, body };
}
