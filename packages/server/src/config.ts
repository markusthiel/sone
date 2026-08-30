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
  maxUploadBytes: number;
  /** The provider's client secret, or null. From the environment only. */
  oidcClientSecret: string | null;
  storage:
    | { backend: 'local'; path: string }
    | {
        backend: 's3';
        endpoint: string;
        region: string;
        bucket: string;
        accessKeyId: string;
        secretAccessKey: string;
        forcePathStyle: boolean;
      };
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

  const backend = oneOf(
    'SONE_STORAGE_BACKEND',
    optional(env, 'SONE_STORAGE_BACKEND', 'local'),
    ['local', 's3'] as const,
  );

  const storage: Config['storage'] =
    backend === 'local'
      ? {
          backend: 'local',
          path: optional(env, 'SONE_STORAGE_PATH', '/var/lib/sone/files'),
        }
      : {
          backend: 's3',
          endpoint: required(env, 'SONE_S3_ENDPOINT'),
          region: optional(env, 'SONE_S3_REGION', 'us-east-1'),
          bucket: required(env, 'SONE_S3_BUCKET'),
          accessKeyId: required(env, 'SONE_S3_ACCESS_KEY_ID'),
          secretAccessKey: required(env, 'SONE_S3_SECRET_ACCESS_KEY'),
          forcePathStyle: optional(env, 'SONE_S3_FORCE_PATH_STYLE', 'true') === 'true',
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
    maxUploadBytes: Math.floor(maxUploadMb * 1024 * 1024),
    // Never in the database (ADR-0024): a secret in a table is a secret in
    // every backup. Absent means single sign-on stays off, whatever the
    // administration area says.
    oidcClientSecret: optional(env, 'SONE_OIDC_CLIENT_SECRET', '') || null,
    storage,
  };
}
