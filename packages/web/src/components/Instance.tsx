/**
 * SONE web — what this instance can do, in one place (ADR-0139).
 *
 * The logo was here first, and the argument for putting it in a context is
 * written where it was provided:
 *
 * > Here rather than threaded as a prop: the mark appears in the rail, in the
 * > mode bar on a phone, on the sign-in screen and beside a workspace in the
 * > switcher, and **four routes to it are four chances to show two different
 * > logos on one screen.**
 *
 * `canSendMail` is the same fact with the same four readers and the same
 * failure — except that it had already happened. The empty inbox said *"SONE
 * does not send email"* while the share dialog, three clicks away, offered to
 * mail a link; and the export screen said nothing at all, because whoever wrote
 * it concluded the flag did not exist.
 *
 * So one context, named for the instance rather than for a field. A fifth thing
 * the interface needs to know about this server goes in here, and a fifth
 * reader needs no plumbing.
 *
 * **The default is the cautious answer.** With no provider — or an instance
 * payload that has not loaded, or an older server that does not send the field —
 * `canSendMail` is false, so nothing promises a mail on the strength of not
 * knowing.
 */

import { createContext, useContext } from 'react';

export interface InstanceFacts {
  /** The instance's own logo, or null for SONE's mark (ADR-0123). */
  logo: string | null;
  /**
   * A second mark, inked for dark surfaces (ADR-0149).
   *
   * Optional in the ordinary sense and in a stricter one: an instance with a
   * single mark uses it on every ground, which is what every instance did
   * before this existed. Two marks is the case where a workspace paints the
   * rail dark and the one drawn for paper stops reading on it.
   */
  logoOnDark?: string | null;
  /** Whether a relay is configured at all (ADR-0059, ADR-0126). */
  canSendMail: boolean;
}

const InstanceContext = createContext<InstanceFacts>({
  logo: null,
  logoOnDark: null,
  canSendMail: false,
});

/** Wraps the whole application, once, in `App`. */
export const Instance = InstanceContext.Provider;

export const useInstance = (): InstanceFacts => useContext(InstanceContext);
