/**
 * SONE core — what to call a role (ADR-0143).
 *
 * A workspace has four roles it did not make and any number it did. The four
 * are words this application wrote — they are seeded in English by a migration
 * and every screen branches on their `key`, never on their name (ADR-0102) — so
 * they belong in the catalogues like every other word it wrote. The rest are
 * names somebody typed, and translating „Redaktion" would be inventing.
 *
 * That decision is one line. It was written three times in the interface, a
 * fourth place skipped it and showed the English row, and the two letters whose
 * whole subject is a role never asked it at all. So it lives here, once, for
 * the reason `readableSize` does (ADR-0138): **a screen and a letter about the
 * same thing have to call it the same thing.**
 *
 * The words themselves stay in the two catalogues, which is why this takes a
 * translator rather than importing one — `packages/web` and `packages/server`
 * each have their own, and neither belongs in `core`.
 */

/** The four a workspace does not make. */
export const SYSTEM_ROLE_KEYS = ['owner', 'admin', 'member', 'guest'] as const;

export type SystemRoleKey = (typeof SYSTEM_ROLE_KEYS)[number];

/**
 * Is this one of the four?
 *
 * `'custom'` is not, and saying so is the point: it is what a member row sends
 * where the role has no key (ADR-0102), and it names the *absence* of a system
 * word rather than a fifth one.
 */
export const isSystemRole = (key: string | null | undefined): key is SystemRoleKey =>
  typeof key === 'string' && (SYSTEM_ROLE_KEYS as readonly string[]).includes(key);

/**
 * What to call a role: the system's word translated, or the name somebody
 * typed.
 *
 * The key decides, not the name, so a workspace that renamed its `owner` row
 * still reads as an owner — a rename changes a label, not what the role is.
 *
 * Empty where there is nothing to say. A comment author carries no role, and a
 * placeholder there would be a claim about somebody; the caller supplies its
 * own word for "unknown" if it wants one.
 */
export function nameOfRole(
  role: { key?: string | null | undefined; name?: string | null | undefined },
  translate: (key: SystemRoleKey) => string,
): string {
  if (isSystemRole(role.key)) return translate(role.key);
  return (role.name ?? '').trim();
}
