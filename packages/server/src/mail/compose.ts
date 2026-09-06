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

import type { SupportedLocale } from '../i18n/locale.js';
import type { Letter } from './letter.js';
import { words, type AddressForm } from './words.js';

export interface Waiting {
  kind: 'mention' | 'reply' | 'assignment';
  /** The page's title, used only when the instance allows that much. */
  pageTitle: string;
  pageId: string;
  /**
   * Who caused it, by display name, when that is known — and it is not.
   *
   * `notifications` records the user, the workspace, the page, the kind and an
   * excerpt. It does *not* record an actor, which I found by writing the query
   * that joins one and watching Postgres refuse the column. The record was
   * written promising "Anna mentioned you"; the data supports "you were
   * mentioned on".
   *
   * Kept as a nullable field rather than removed, because the wording below is
   * the only thing that has to change when the column exists — and null is the
   * honest value until it does. A name is not content, so there is no reason of
   * principle to leave it out.
   */
  actor: string | null;
}

export interface ComposeInput {
  waiting: Waiting[];
  workspaceName: string;
  /** How much a mail may name (ADR-0058). */
  detail: 'title' | 'workspace';
  /** Where SONE lives, for the links. */
  baseUrl: string;
  locale: SupportedLocale;
  /** „du" or „Sie" (ADR-0133). Absent is the informal default. */
  address?: AddressForm;
}

/*
 * What this returns is a `Letter` (ADR-0121).
 *
 * It returned `{ subject, body }` — a finished plain-text mail — under the
 * rule "an HTML mail is a second thing to keep true". That rule is right about
 * two *documents* and not about two renderings: a letter is a structure, and
 * the text and the HTML are both produced from it, so a line reaching one and
 * not the other is not a mistake that can be made.
 *
 * What decides how much a mail may say is still here, unchanged, which is the
 * half ADR-0058 was actually protecting.
 */

/*
 * The words are in the catalogue, not here (ADR-0133).
 *
 * This module had its own table of two languages — the only mail that ever had
 * one — and it was right about everything except where it lived. Eleven other
 * letters were written beside it in English, because a table private to one
 * file is not a place anybody else adds a sentence to.
 *
 * What it was right about is kept, and it is the reason there are two keys per
 * kind rather than one with a name in front: German cannot put a subject before
 * *„Du wurdest erwähnt"* and stay grammatical, and neither can English —
 * *„Anna You were mentioned on"*. The sentence changes, not the prefix, which
 * is what a nullable actor actually costs.
 */

/**
 * One mail for everything waiting for one person in one workspace.
 *
 * Not one per notification: somebody mentioned four times while a page is being
 * restructured gets four mails, and the fourth teaches them to filter the
 * sender.
 */
export function composeNotificationEmail(input: ComposeInput): Letter | null {
  if (input.waiting.length === 0) return null;

  const say = words(input.locale, input.address ?? 'informal');
  const named = (one: Waiting): string =>
    // The page's title only when the instance allows it. `workspace` is for an
    // operator who cannot accept even a title leaving — then a mail says where
    // to look and nothing about what is there.
    input.detail === 'title' ? `“${one.pageTitle}”` : input.workspaceName;

  const lines = input.waiting.map((one) =>
    one.actor === null
      ? say(`notify.${one.kind}Alone`, { what: named(one) })
      : say(`notify.${one.kind}`, { by: one.actor, what: named(one) }),
  );

  const first = input.waiting[0]!;
  const subject =
    input.waiting.length === 1
      ? first.actor === null
        ? say('notify.subjectOne', { what: named(first) })
        : say('notify.subjectOneBy', { by: first.actor, what: named(first) })
      : say('notify.subjectMany', {
          count: input.waiting.length,
          workspace: input.workspaceName,
        });

  /*
   * A link per line, and the way in at the end.
   *
   * Plain URLs, not wrapped and not per-recipient: knowing whether somebody
   * followed a link is not worth becoming the kind of software that measures it
   * (ADR-0058).
   */
  return {
    subject,
    lines: lines.map((text, at) => ({
      text,
      url: `${input.baseUrl}/p/${input.waiting[at]!.pageId}`,
    })),
    action: { label: say('notify.action'), url: input.baseUrl },
    footer: [
      say('notify.footer.noText'),
      say('notify.footer.stop'),
      `${input.baseUrl}/settings/notifications`,
    ],
    baseUrl: input.baseUrl,
    locale: input.locale,
  };
}
