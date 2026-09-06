/**
 * SONE — instance settings.
 *
 * Configuration comes from two places and the split is deliberate.
 *
 * The environment is right for anything that must be known before the database
 * is reachable: the database URL, the secret key, the port. Those stay
 * environment-only, because a database that will not open cannot tell you how
 * to open it.
 *
 * Everything else — the things an administrator wants to change on a Tuesday —
 * lives in a table and falls back to the environment. Without that, changing
 * whether people may sign up means editing a compose file and restarting the
 * server, which is a deployment for a checkbox.
 *
 * Reads are cached with a short lifetime rather than on every request or once
 * at boot. Once at boot means a change needs a restart, which is the problem
 * being solved; every request means a query per page load for values that
 * change monthly.
 */

import { sanitiseTheme, type WorkspaceTheme } from '@sone/core';
import type { Pool } from 'pg';

import { queryRows } from '../db/pool.js';

/**
 * Settings an administrator may change, with their types.
 *
 * A closed list, so a typo in a key is a rejected write rather than a silently
 * stored value nothing will ever read.
 */
export const SETTING_KEYS = {
  /** Who may create an account. */
  signupMode: { type: 'enum', values: ['open', 'invite', 'closed'] as const },
  /** Shown on the sign-in screen, so people know which instance they are on. */
  instanceName: { type: 'string', maxLength: 120 },
  /** Whether members other than admins may create workspaces. */
  allowWorkspaceCreation: { type: 'boolean' },
  /** Default interface language for new accounts. */
  defaultLocale: { type: 'string', maxLength: 35 },
  /**
   * How the interface addresses somebody, in languages that distinguish it.
   *
   * `informal` is "du" and `formal` is "Sie". A property of the instance rather
   * than of a person: it is the tone the people running it have chosen for their
   * own house, and two members of one workspace reading different forms of
   * address in the same sentence would be stranger than either choice.
   *
   * Meaningless in English, which is why it is one setting and not a locale of
   * its own: a second German catalogue would duplicate every string and drift
   * (ADR-0041).
   */
  addressForm: { type: 'enum', values: ['informal', 'formal'] as const },

  /*
   * Where to send mail, if anywhere (ADR-0058).
   *
   * Empty host means no email: nothing is attempted, nothing is offered in the
   * interface, and no queue fills up. A self-hosted instance without a relay is
   * a normal instance, not a broken one.
   */
  smtpHost: { type: 'string', maxLength: 253 },
  smtpPort: { type: 'string', maxLength: 5 },
  smtpUser: { type: 'string', maxLength: 320 },
  /** The address mail comes from, which a relay usually insists on owning. */
  smtpFrom: { type: 'string', maxLength: 320 },
  smtpSecurity: { type: 'enum', values: ['starttls', 'tls', 'none'] as const },
  /**
   * Whether a mail may name the page.
   *
   * `title` is the default because "you have a notification" is a mail nobody
   * can act on and everybody learns to filter. `workspace` is for an operator
   * who cannot accept even a title leaving the instance — a real need, and not
   * the common one, which is why it is not the default (ADR-0058).
   */
  emailDetail: { type: 'enum', values: ['title', 'workspace'] as const },

  /*
   * Where replies are read from, if anywhere (ADR-0060).
   *
   * Empty host means no replies: notifications carry no Reply-To, nothing is
   * polled, and the feature is absent rather than broken — the same shape as
   * mail itself.
   *
   * `replyMailbox` is the address people will reply *to*, which sub-addressing
   * turns into one address per notification. It is separate from `smtpFrom`
   * because a relay usually insists on owning the sender, while the mailbox
   * being polled is often a different account entirely.
   */
  /*
   * Whether everybody needs a second factor, and since when (ADR-0065).
   *
   * Two settings rather than one, because the grace period is counted from the
   * moment it was switched on — stored rather than derived, so it cannot move
   * when somebody edits an unrelated setting and the store rewrites its row.
   *
   * `requireSecondFactorSince` is an ISO timestamp as text. Empty means it has
   * never been on.
   */
  requireSecondFactor: { type: 'boolean' },
  requireSecondFactorSince: { type: 'string', maxLength: 40 },

  imapHost: { type: 'string', maxLength: 253 },
  imapPort: { type: 'string', maxLength: 5 },
  imapUser: { type: 'string', maxLength: 320 },
  imapFolder: { type: 'string', maxLength: 64 },
  replyMailbox: { type: 'string', maxLength: 320 },

  /*
   * What the instance looks like where nobody has said otherwise (ADR-0123).
   *
   * The two settings here are the first that cannot come from the environment,
   * and that is not an oversight: a theme is an object and a logo is bytes,
   * neither of which belongs in a compose file. They resolve from a fixed
   * default instead — empty, which is what a fresh instance has and renders
   * exactly as every instance rendered before there was branding.
   *
   * The theme goes through the same `sanitiseTheme` a workspace's does, so an
   * administrator cannot express anything a workspace could not. That matters
   * more here than there: this is the one everybody sees who has set nothing.
   */
  brandTheme: { type: 'json', check: checkTheme },
  /*
   * The mark, as a storage key and the type its bytes actually are.
   *
   * One value and not two settings, because they must not drift: a key stored
   * beside the wrong type is a PNG served as a JPEG, and the browser that
   * refuses it is right.
   */
  brandLogo: { type: 'json', check: checkLogo },
} as const;

/**
 * A theme, filtered rather than trusted — and rejected if it is not one at all.
 *
 * Both halves matter and they answer different questions. *Inside* an object,
 * an unusable field is dropped: a theme arrives from a form, and one stale
 * value must not cost an instance the rest of its settings. But a value that is
 * not an object is a caller sending the wrong thing, and `sanitiseTheme` would
 * turn it into `{}` — which would quietly clear the instance's whole
 * appearance because a client had a bug.
 */
function checkTheme(value: unknown): WorkspaceTheme | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return sanitiseTheme(value);
}

/** A storage key, in the storage layer's own shape. Anything else names nothing. */
const LOGO_KEY = /^[0-9a-f]{2}\/[0-9a-f]{62}(\.[a-z0-9]{1,8})?$/;
const LOGO_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']);

export interface BrandLogo {
  key: string;
  mime: string;
}

function checkLogo(value: unknown): BrandLogo | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const key = raw['key'];
  const mime = raw['mime'];
  if (typeof key !== 'string' || !LOGO_KEY.test(key)) return undefined;
  if (typeof mime !== 'string' || !LOGO_TYPES.has(mime)) return undefined;
  return { key, mime };
}

/** What a sign-in screen needs to look like this instance. */
export interface BrandInfo {
  name: string;
  theme: WorkspaceTheme;
  /**
   * Where the logo is, with the key in the address.
   *
   * The bytes at a storage key never change — the key is their hash — so the
   * answer may be cached hard. That is only safe because the *address* moves: a
   * new logo is a new URL, and nobody is shown last month's mark out of a
   * proxy.
   */
  logo: string | null;
}

export type SettingKey = keyof typeof SETTING_KEYS;

export interface InstanceSettings {
  signupMode: 'open' | 'invite' | 'closed';
  instanceName: string;
  allowWorkspaceCreation: boolean;
  defaultLocale: string;
  addressForm: 'informal' | 'formal';
  /** Empty host means no email at all (ADR-0058). */
  smtpHost: string;
  smtpPort: string;
  smtpUser: string;
  smtpFrom: string;
  smtpSecurity: 'starttls' | 'tls' | 'none';
  emailDetail: 'title' | 'workspace';
  /** Empty host means no replies (ADR-0060). */
  requireSecondFactor: boolean;
  requireSecondFactorSince: string;
  imapHost: string;
  imapPort: string;
  imapUser: string;
  imapFolder: string;
  replyMailbox: string;
  /** What the instance looks like where nobody said otherwise (ADR-0123). */
  brandTheme: WorkspaceTheme;
  brandLogo: BrandLogo | null;
}

/**
 * The two that have no environment behind them.
 *
 * Every other setting falls back to a value the deployment supplied; a theme is
 * an object and a logo is bytes, and neither belongs in a compose file. Empty
 * is what a fresh instance has.
 */
const NO_ENVIRONMENT: Pick<InstanceSettings, 'brandTheme' | 'brandLogo'> = {
  brandTheme: {},
  brandLogo: null,
};

/** Where each value came from, so the interface can say so. */
export type SettingSource = 'database' | 'environment';

export interface ResolvedSettings {
  values: InstanceSettings;
  sources: Record<SettingKey, SettingSource>;
}

export interface SettingsDefaults {
  signupMode: 'open' | 'invite' | 'closed';
  instanceName: string;
  allowWorkspaceCreation: boolean;
  defaultLocale: string;
  addressForm: 'informal' | 'formal';
  /** Empty host means no email at all (ADR-0058). */
  smtpHost: string;
  smtpPort: string;
  smtpUser: string;
  smtpFrom: string;
  smtpSecurity: 'starttls' | 'tls' | 'none';
  emailDetail: 'title' | 'workspace';
  /** Empty host means no replies (ADR-0060). */
  requireSecondFactor: boolean;
  requireSecondFactorSince: string;
  imapHost: string;
  imapPort: string;
  imapUser: string;
  imapFolder: string;
  replyMailbox: string;
}

/** How long a resolved set of settings is reused. */
const CACHE_MS = 5_000;

export class SettingsStore {
  private cached: ResolvedSettings | null = null;
  private cachedAt = 0;

  constructor(
    private readonly pool: Pool,
    private readonly defaults: SettingsDefaults,
  ) {}

  /** Drop the cache, so the next read sees a write immediately. */
  invalidate(): void {
    this.cached = null;
  }

  async resolve(): Promise<ResolvedSettings> {
    if (this.cached && Date.now() - this.cachedAt < CACHE_MS) return this.cached;

    const rows = await queryRows<{ key: string; value: unknown }>(
      this.pool,
      `SELECT key, value FROM instance_settings`,
    );

    const stored = new Map(rows.map((row) => [row.key, row.value]));
    const values: InstanceSettings = { ...this.defaults, ...NO_ENVIRONMENT };
    const sources = {
      signupMode: 'environment',
      instanceName: 'environment',
      allowWorkspaceCreation: 'environment',
      defaultLocale: 'environment',
    } as Record<SettingKey, SettingSource>;

    for (const key of Object.keys(SETTING_KEYS) as SettingKey[]) {
      if (!stored.has(key)) continue;
      const parsed = validate(key, stored.get(key));
      if (parsed === undefined) {
        // A stored value that no longer validates — a setting whose allowed
        // values changed between releases, say. The environment default is used
        // and the row is left alone rather than deleted, so an administrator can
        // see and correct it.
        continue;
      }
      (values as unknown as Record<string, unknown>)[key] = parsed;
      sources[key] = 'database';
    }

    this.cached = { values, sources };
    this.cachedAt = Date.now();
    return this.cached;
  }

  /**
   * What this instance looks like, for the screen that draws it (ADR-0123).
   *
   * Assembled here rather than at each caller: the sign-in screen and the
   * application both want it, and the logo's address is derived from the key
   * rather than stored — two places building that URL is two places to get the
   * cache-busting wrong.
   */
  async brand(): Promise<BrandInfo> {
    const values = (await this.resolve()).values;
    return {
      name: values.instanceName,
      theme: values.brandTheme,
      logo: values.brandLogo
        ? `/api/instance/logo?v=${values.brandLogo.key.replace('/', '').slice(0, 12)}`
        : null,
    };
  }

  /** Read one setting. */
  async get<K extends SettingKey>(key: K): Promise<InstanceSettings[K]> {
    return (await this.resolve()).values[key];
  }

  /**
   * Write a setting, or clear it back to the environment default.
   *
   * `null` deletes the row rather than storing null, so "not set" and "set to
   * nothing" cannot both exist and mean different things.
   */
  async set(key: SettingKey, value: unknown, actorId: string | null): Promise<void> {
    if (value === null) {
      await this.pool.query(`DELETE FROM instance_settings WHERE key = $1`, [key]);
      this.invalidate();
      return;
    }

    const parsed = validate(key, value);
    if (parsed === undefined) {
      throw new SettingError(`invalid value for ${key}`, 'invalid_setting_value');
    }

    await this.pool.query(
      `INSERT INTO instance_settings (key, value, updated_by)
       VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (key) DO UPDATE
         SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
      [key, JSON.stringify(parsed), actorId],
    );
    this.invalidate();
  }
}

export class SettingError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'SettingError';
  }
}

/**
 * Check a value against its declared type.
 *
 * Returns `undefined` for anything invalid rather than throwing, so a bad row
 * in the table degrades to the environment default instead of stopping the
 * server. A setting is not worth a failed boot.
 */
export function validate(key: SettingKey, value: unknown): unknown | undefined {
  const spec = SETTING_KEYS[key];

  if (spec.type === 'enum') {
    return typeof value === 'string' && (spec.values as readonly string[]).includes(value)
      ? value
      : undefined;
  }
  if (spec.type === 'boolean') {
    return typeof value === 'boolean' ? value : undefined;
  }
  if (spec.type === 'string') {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 && trimmed.length <= spec.maxLength ? trimmed : undefined;
  }
  if (spec.type === 'json') {
    // The check belongs to the key rather than to the type: a theme and a logo
    // are both objects and share nothing else. `undefined` from a check is a
    // refusal, exactly as it is for the other three.
    return spec.check(value);
  }
  return undefined;
}
