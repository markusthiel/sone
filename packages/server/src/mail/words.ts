/**
 * SONE server — a letter's voice: which language, and which address (ADR-0133).
 *
 * ## The resolver existed and nothing asked it
 *
 * `recipientLocale` has been in `i18n/locale.ts` since ADR-0011, exported, with
 * a docstring stating the order it answers in — *the user's own setting, then
 * the workspace default, then English* — and the note that the **sender's**
 * language never enters into it. Nothing called it. Every letter written
 * between ADR-0058 and ADR-0132 put `locale: 'en'` in the structure beside the
 * words, and one of them resolved a locale by hand, in one branch, skipping the
 * workspace fallback.
 *
 * So this is not new machinery. It is the wire from the answer to the letters.
 *
 * ## Two questions, not one
 *
 * A letter needs a **language** and an **address**, and they come from
 * different places. The language is the reader's: it is on their account, or on
 * the workspace they are being written to about. The address — „du" or „Sie" —
 * is the instance's, one setting for everything this server says, exactly as
 * the interface uses it. A German instance that has chosen Sie must not have
 * mails that say du, which is what a mail catalogue without this would do.
 *
 * English ignores `address` entirely: the catalogue has no branch on it, and
 * `formatMessage` leaves an unused value alone.
 */

import { formatMessage, type MessageValues } from '@sone/core';

import type { SupportedLocale } from '../i18n/locale.js';
import { de } from './words.de.js';
import { en, type MailKey } from './words.en.js';

export type { MailKey };

/** How this instance addresses people, where a language distinguishes it. */
export type AddressForm = 'informal' | 'formal';

/**
 * One letter's voice: the catalogue, bound to a language and an address.
 *
 * A function rather than an object, because every call site does the same one
 * thing with it, and a letter reads better as `say('access.heading', {…})` than
 * as a lookup and a format.
 */
export type Say = (key: MailKey, values?: MessageValues) => string;

const CATALOGUES: Record<SupportedLocale, Partial<Record<MailKey, string>>> = { en, de };

export function words(locale: SupportedLocale, address: AddressForm = 'informal'): Say {
  const catalogue = CATALOGUES[locale] ?? en;
  return (key, values = {}) =>
    /*
     * English is the fallback for a missing key rather than the key itself.
     *
     * The type checker makes a missing German key impossible today. It stops
     * being impossible the moment somebody adds a third language by copying
     * `words.de.ts` and leaving a line out, and an English sentence in a Dutch
     * mail is a great deal better than the word `access.heading`.
     *
     * `address` is passed to every message without being asked for, so a
     * message that needs the address does not have to be called differently
     * from one that does not.
     */
    formatMessage(catalogue[key] ?? en[key], { address, ...values }, locale);
}
