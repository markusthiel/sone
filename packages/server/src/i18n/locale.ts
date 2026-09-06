/**
 * SONE — server-side internationalisation.
 *
 * The server does three i18n jobs and deliberately not a fourth:
 *
 *   - resolves which locale a *recipient* should be addressed in (email)
 *   - supplies the collation for user-visible text sorting
 *   - picks the text search dictionary
 *
 * It does NOT translate API responses. Errors carry a machine-readable code
 * and parameters; the client renders them. Otherwise the catalogue would have
 * to exist twice, and switching language in the UI could not re-render an
 * error already on screen. See ADR-0011.
 */

import type { Pool, PoolClient } from 'pg';

import { queryOne } from '../db/pool.js';

/** Locales with a shipped UI catalogue. Extended as translations land. */
export const SUPPORTED_LOCALES = ['en', 'de'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export const FALLBACK_LOCALE: SupportedLocale = 'en';

/**
 * Postgres text search configuration per language.
 *
 * Only languages with a dictionary shipped by Postgres are listed. Anything
 * else falls back to 'simple', which does no stemming but does not lie about
 * it. Notably absent and worth knowing: Postgres has no built-in dictionary
 * for Chinese, Japanese or Korean, so those need an extension (pg_bigm,
 * zhparser) and are 'simple' until someone deploys one.
 */
export const SEARCH_CONFIG_BY_LANGUAGE: Readonly<Record<string, string>> = {
  ar: 'arabic',
  da: 'danish',
  de: 'german',
  el: 'greek',
  en: 'english',
  es: 'spanish',
  fi: 'finnish',
  fr: 'french',
  hu: 'hungarian',
  id: 'indonesian',
  it: 'italian',
  nb: 'norwegian',
  nl: 'dutch',
  nn: 'norwegian',
  no: 'norwegian',
  pt: 'portuguese',
  ro: 'romanian',
  ru: 'russian',
  sv: 'swedish',
  tr: 'turkish',
};

/**
 * ICU collation for a language.
 *
 * 'und-x-icu' is the language-neutral Unicode collation and the right default:
 * correct for most European languages, and the only defensible choice for a
 * workspace holding mixed-language content. A language-specific collation is
 * better only when the content really is monolingual — Swedish, for instance,
 * sorts 'ä' after 'z' where German sorts it with 'a', and there is no
 * collation that is right for both at once.
 */
export function collationForLanguage(language: string): string {
  const base = primaryLanguage(language);
  // Languages whose sort order differs enough from the neutral default that
  // using it would be visibly wrong to a native reader.
  const specific: Record<string, string> = {
    sv: 'sv-x-icu',
    da: 'da-x-icu',
    nb: 'nb-x-icu',
    nn: 'nn-x-icu',
    no: 'no-x-icu',
    fi: 'fi-x-icu',
    tr: 'tr-x-icu',
    cs: 'cs-x-icu',
    et: 'et-x-icu',
    hu: 'hu-x-icu',
    lt: 'lt-x-icu',
    lv: 'lv-x-icu',
    pl: 'pl-x-icu',
    sk: 'sk-x-icu',
  };
  return specific[base] ?? 'und-x-icu';
}

export function searchConfigForLanguage(language: string): string {
  return SEARCH_CONFIG_BY_LANGUAGE[primaryLanguage(language)] ?? 'simple';
}

/** 'de-CH' -> 'de'. Search dictionaries are per language, not per region. */
export const primaryLanguage = (tag: string): string =>
  tag.toLowerCase().split(/[-_]/)[0] ?? '';

/**
 * Negotiate a UI locale from an Accept-Language header.
 *
 * Used only for anonymous visitors — a signed-in user's stored preference
 * always wins, because a header describes the browser and the preference
 * describes the person.
 */
export function negotiateLocale(
  acceptLanguage: string | null | undefined,
): SupportedLocale {
  if (!acceptLanguage) return FALLBACK_LOCALE;

  const ranked = acceptLanguage
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params
        .map((p) => p.trim())
        .find((p) => p.startsWith('q='))
        ?.slice(2);
      const quality = q === undefined ? 1 : Number.parseFloat(q);
      return {
        tag: (tag ?? '').trim().toLowerCase(),
        quality: Number.isFinite(quality) ? quality : 0,
      };
    })
    .filter((entry) => entry.tag !== '' && entry.quality > 0)
    .sort((a, b) => b.quality - a.quality);

  for (const { tag } of ranked) {
    const exact = SUPPORTED_LOCALES.find((l) => l === tag);
    if (exact) return exact;
    const base = primaryLanguage(tag);
    const partial = SUPPORTED_LOCALES.find((l) => primaryLanguage(l) === base);
    if (partial) return partial;
  }
  return FALLBACK_LOCALE;
}

/**
 * The locale to address a user in.
 *
 * Order: the user's own setting, then the workspace default, then English.
 * The requesting user's locale never enters into it — an invitation sent by a
 * German admin to a French colleague must arrive in French.
 */
export async function recipientLocale(
  db: Pool | PoolClient,
  userId: string,
  workspaceId?: string | null,
): Promise<SupportedLocale> {
  const row = await queryOne<{ user_locale: string | null; workspace_locale: string | null }>(
    db,
    `SELECT u.locale AS user_locale,
            (SELECT w.default_locale FROM workspaces w WHERE w.id = $2) AS workspace_locale
       FROM users u WHERE u.id = $1`,
    [userId, workspaceId ?? null],
  );
  if (!row) return FALLBACK_LOCALE;
  return supported(row.user_locale) ?? supported(row.workspace_locale) ?? FALLBACK_LOCALE;
}

/**
 * The locale to address somebody known only by their address (ADR-0133).
 *
 * Two letters go to a mailbox rather than to an account: an invitation, which
 * exists because there is no account yet, and a shared link, which usually goes
 * outside. Both said English, and both said it for a reason that is only half
 * true — **an address is not the same thing as no account**. A colleague on
 * this instance who is sent a link has a row in `users` with a language on it,
 * and asking costs one query.
 *
 * Where there is genuinely nobody, the workspace decides. That is not the
 * sender's language dressed up: a workspace has a language of its own, chosen
 * for the place rather than for the person, and a page in a German workspace is
 * more likely to be read in German than in English. It is a guess, and so was
 * "always English" — this is the better one, and it is the second step
 * `recipientLocale` already takes for exactly the same reason.
 */
export async function addressLocale(
  db: Pool | PoolClient,
  email: string | null | undefined,
  workspaceId?: string | null,
): Promise<SupportedLocale> {
  const row = await queryOne<{ user_locale: string | null; workspace_locale: string | null }>(
    db,
    // Lowercased on both sides: addresses are compared case-insensitively
    // everywhere else here, and a colleague who typed one capital letter is
    // still the same person.
    `SELECT (SELECT u.locale FROM users u
              WHERE lower(u.email) = lower($1) AND u.deactivated_at IS NULL
              LIMIT 1) AS user_locale,
            (SELECT w.default_locale FROM workspaces w WHERE w.id = $2) AS workspace_locale`,
    [email ?? '', workspaceId ?? null],
  );
  return supported(row?.user_locale) ?? supported(row?.workspace_locale) ?? FALLBACK_LOCALE;
}

/** One candidate, exactly or by its language. Null when this server has neither. */
function supported(candidate: string | null | undefined): SupportedLocale | null {
  if (!candidate) return null;
  return (
    SUPPORTED_LOCALES.find((l) => l === candidate.toLowerCase()) ??
    SUPPORTED_LOCALES.find((l) => primaryLanguage(l) === primaryLanguage(candidate)) ??
    null
  );
}

export interface WorkspaceI18n {
  defaultLocale: string;
  searchConfig: string;
  sortCollation: string;
}

export async function workspaceI18n(
  db: Pool | PoolClient,
  workspaceId: string,
): Promise<WorkspaceI18n> {
  const row = await queryOne<{
    default_locale: string;
    search_config: string;
    sort_collation: string;
  }>(
    db,
    `SELECT default_locale, search_config::text AS search_config, sort_collation
       FROM workspaces WHERE id = $1`,
    [workspaceId],
  );
  return {
    defaultLocale: row?.default_locale ?? FALLBACK_LOCALE,
    searchConfig: row?.search_config ?? 'simple',
    sortCollation: row?.sort_collation ?? 'und-x-icu',
  };
}

/**
 * Render a `COLLATE` clause for an ORDER BY on user-visible text.
 *
 * Collation names cannot be parameterised in SQL, so this is string
 * interpolation into a query — which means the value must be validated, not
 * trusted. The allowlist below is that validation. Do not relax it.
 *
 * Never apply this to a fractional index: those are compared byte-wise and a
 * collated comparison would reorder blocks (ADR-0002, migration 0005).
 */
export function collateClause(collation: string): string {
  if (!/^[a-z]{2,3}(-[a-zA-Z0-9]{2,8})*-x-icu$/.test(collation) && collation !== 'und-x-icu') {
    // Fall back rather than throw: a bad setting must not take search and
    // sorting offline.
    return 'COLLATE "und-x-icu"';
  }
  return `COLLATE "${collation}"`;
}

/**
 * Set a workspace's language, deriving search configuration and collation.
 *
 * Returns whether the search configuration changed, because that invalidates
 * every stored search vector in the workspace: the caller must trigger a
 * re-materialisation. The `stale_search_rows` view makes the condition visible
 * if that is forgotten.
 */
export async function setWorkspaceLanguage(
  db: Pool | PoolClient,
  workspaceId: string,
  language: string,
): Promise<{ searchConfigChanged: boolean; searchConfig: string; sortCollation: string }> {
  const before = await workspaceI18n(db, workspaceId);
  const searchConfig = searchConfigForLanguage(language);
  const sortCollation = collationForLanguage(language);

  await db.query(
    `UPDATE workspaces
        SET default_locale = $2, search_config = $3::regconfig, sort_collation = $4
      WHERE id = $1`,
    [workspaceId, language, searchConfig, sortCollation],
  );

  return {
    searchConfigChanged: before.searchConfig !== searchConfig,
    searchConfig,
    sortCollation,
  };
}
