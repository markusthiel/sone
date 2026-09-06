/**
 * SONE server configuration.
 *
 * Read once at startup and validated eagerly. A self-hosted product that
 * starts successfully and then fails on the first upload because a variable
 * was missing is worse than one that refuses to start.
 */

export interface Config {
  databaseUrl: string;
  /**
   * Permit starting against a database recorded as having run a newer version.
   *
   * SONE_ALLOW_DOWNGRADE. An escape hatch for the case where the version
   * *labels* are misleading rather than the code being older, which is
   * possible because the check compares strings. Never a default.
   */
  allowDowngrade: boolean;
  secretKey: string;
  publicUrl: string;
  port: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  signupMode: 'open' | 'invite' | 'closed';
  /** Where mail goes, if anywhere. Empty host means no email (ADR-0058). */
  smtpHost: string | null;
  smtpPort: string | null;
  smtpUser: string | null;
  smtpFrom: string | null;
  /**
   * Never in the database, for the same reason as the OIDC secret (ADR-0024):
   * a secret in a table is a secret in every backup.
   */
  smtpPassword: string | null;
  /** Where replies are read from, if anywhere (ADR-0060). */
  imapHost: string | null;
  imapPort: string | null;
  imapUser: string | null;
  /** The address people reply to, which sub-addressing makes one per notification. */
  replyMailbox: string | null;
  /** Never in the database, for the same reason as the SMTP one (ADR-0060). */
  imapPassword: string | null;
  maxUploadBytes: number;
  /** The provider's client secret, or null. From the environment only. */
  oidcClientSecret: string | null;
  /** Days a deleted workspace is kept before it is removed. */
  workspaceRetentionDays: number;
  /**
   * Where attachments are kept. Local, and only local (ADR-0107).
   *
   * There was a second branch here, with an endpoint, a bucket and credentials
   * — for a backend that does not exist. `store.ts` says so plainly in its own
   * header ("so an S3 backend can implement it later"), and `main.ts` built a
   * `LocalFileStore` whatever this said. The type is what made an operator
   * believe otherwise, so the type is what changed.
   */
  storage: { backend: 'local'; path: string };
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(`configuration error: ${message}`);
    this.name = 'ConfigError';
  }
}

const required = (env: NodeJS.ProcessEnv, key: string): string => {
  const value = env[key];
  if (value === undefined || value.trim() === '') {
    throw new ConfigError(`${key} is required but not set`);
  }
  return value.trim();
};

const optional = (env: NodeJS.ProcessEnv, key: string, fallback: string): string =>
  env[key]?.trim() || fallback;

const oneOf = <T extends string>(
  key: string,
  value: string,
  allowed: readonly T[],
): T => {
  if (!allowed.includes(value as T)) {
    throw new ConfigError(`${key} must be one of ${allowed.join(', ')}, got "${value}"`);
  }
  return value as T;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const secretKey = required(env, 'SONE_SECRET_KEY');
  if (secretKey.length < 32) {
    throw new ConfigError(
      'SONE_SECRET_KEY must be at least 32 characters. Generate one with: openssl rand -base64 48',
    );
  }

  /*
   * `s3` is named here so the refusal below can be specific (ADR-0107).
   *
   * Left in the list rather than removed: an unknown value gets "must be one of
   * local, s3", which for somebody who set `s3` on purpose is a message that
   * makes no sense. They get their own, and it is the one worth writing.
   */
  const backend = oneOf(
    'SONE_STORAGE_BACKEND',
    optional(env, 'SONE_STORAGE_BACKEND', 'local'),
    ['local', 's3'] as const,
  );

  if (backend === 's3') {
    /*
     * Refused, and the whole point is *where* it is refused.
     *
     * This branch used to require `SONE_S3_ENDPOINT`, `SONE_S3_BUCKET` and two
     * credentials, and hand back an object holding them — which is the
     * strongest possible statement that a feature exists. Nothing implemented
     * it. `main.ts` built a `LocalFileStore` pointed at the default path, so
     * uploads went to the container's disk while the operator believed they
     * were in a bucket.
     *
     * That would merely be a wasted setting if the backup did not read the same
     * flag: `backup.mjs` passes no files path for a non-local backend, so the
     * archive contained the database and **none of the attachments**, and the
     * restore then told whoever ran it to point at the bucket.
     *
     * So this must not start. The message says where the files are, because
     * they are all still there and the fix costs one variable and moves
     * nothing — and somebody reading "S3 is not implemented" without that
     * sentence would reasonably conclude their attachments are gone.
     */
    throw new ConfigError(
      'SONE_STORAGE_BACKEND=s3 is not implemented in this build, and was never ' +
        'wired to anything: uploads have been written to the local disk at ' +
        '/var/lib/sone/files the whole time, whatever the S3 settings said.\n\n' +
        'Nothing has to move. Set SONE_STORAGE_BACKEND=local (and ' +
        'SONE_STORAGE_PATH=/var/lib/sone/files, or wherever the volume is ' +
        'mounted) and the same files are served from the same place.\n\n' +
        'Check your backups: an archive taken while this was set contains no ' +
        'attachments at all. The next one, taken with the setting corrected, ' +
        'will.',
    );
  }

  const storage: Config['storage'] = {
    backend: 'local',
    path: optional(env, 'SONE_STORAGE_PATH', '/var/lib/sone/files'),
  };

  const publicUrl = optional(env, 'SONE_PUBLIC_URL', 'http://localhost:3000').replace(
    /\/+$/,
    '',
  );

  const port = Number(optional(env, 'PORT', '3000'));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigError(`PORT must be a valid port number, got "${port}"`);
  }

  const maxUploadMb = Number(optional(env, 'SONE_MAX_UPLOAD_MB', '100'));
  if (!Number.isFinite(maxUploadMb) || maxUploadMb <= 0) {
    throw new ConfigError(`SONE_MAX_UPLOAD_MB must be a positive number`);
  }

  return {
    databaseUrl: required(env, 'SONE_DATABASE_URL'),
    // An escape hatch, not a setting. See FenceOptions in db/version.ts.
    allowDowngrade: optional(env, 'SONE_ALLOW_DOWNGRADE', 'false') === 'true',
    secretKey,
    publicUrl,
    port,
    logLevel: oneOf('SONE_LOG_LEVEL', optional(env, 'SONE_LOG_LEVEL', 'info'), [
      'debug',
      'info',
      'warn',
      'error',
    ] as const),
    signupMode: oneOf('SONE_SIGNUP_MODE', optional(env, 'SONE_SIGNUP_MODE', 'invite'), [
      'open',
      'invite',
      'closed',
    ] as const),
    smtpHost: optional(env, 'SONE_SMTP_HOST', '') || null,
    smtpPort: optional(env, 'SONE_SMTP_PORT', '') || null,
    smtpUser: optional(env, 'SONE_SMTP_USER', '') || null,
    smtpFrom: optional(env, 'SONE_SMTP_FROM', '') || null,
    smtpPassword: optional(env, 'SONE_SMTP_PASSWORD', '') || null,
    imapHost: optional(env, 'SONE_IMAP_HOST', '') || null,
    imapPort: optional(env, 'SONE_IMAP_PORT', '') || null,
    imapUser: optional(env, 'SONE_IMAP_USER', '') || null,
    replyMailbox: optional(env, 'SONE_REPLY_MAILBOX', '') || null,
    imapPassword: optional(env, 'SONE_IMAP_PASSWORD', '') || null,
    maxUploadBytes: Math.floor(maxUploadMb * 1024 * 1024),
    // Never in the database (ADR-0024): a secret in a table is a secret in
    // every backup. Absent means single sign-on stays off, whatever the
    // administration area says.
    oidcClientSecret: optional(env, 'SONE_OIDC_CLIENT_SECRET', '') || null,
    // How long a deleted workspace is kept (ADR-0027). Configurable because
    // what "deleted" should mean differs per instance, and a month is a
    // default rather than a rule.
    workspaceRetentionDays: Math.max(
      1,
      Number(optional(env, 'SONE_WORKSPACE_RETENTION_DAYS', '30')) || 30,
    ),
    storage,
  };
}
