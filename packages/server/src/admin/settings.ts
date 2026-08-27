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
} as const;

export type SettingKey = keyof typeof SETTING_KEYS;

export interface InstanceSettings {
  signupMode: 'open' | 'invite' | 'closed';
  instanceName: string;
  allowWorkspaceCreation: boolean;
  defaultLocale: string;
}

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
    const values: InstanceSettings = { ...this.defaults };
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
  return undefined;
}
