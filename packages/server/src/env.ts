/**
 * SONE server — numbers that come from the environment (ADR-0111).
 *
 * Six settings are read straight out of `process.env` with `Number(...)`, and
 * each of them ends up somewhere a bad value is expensive: inside an interval
 * string Postgres parses, inside a `Date` a column has to accept, inside a
 * connection pool's size. `Number('')` is 0, `Number('ten')` is NaN, and both
 * pass every type check there is.
 *
 * Two of the six were already careful. `passwordCost` refuses anything outside
 * 10–20, and `VERSION_RETENTION_DAYS` was clamped by ADR-0080 with a paragraph
 * explaining exactly this hazard — that `SONE_VERSION_RETENTION_DAYS=0` deletes
 * the entire history of every page, and that a non-number reaches Postgres as
 * the string "NaN days". The other four were written the obvious way, and the
 * paragraph stayed in the file where it was written.
 *
 * So the rule lives here instead of in a comment beside each reader, and
 * `scripts/check-env-numbers.mjs` fails the build on the seventh caller that
 * reaches for `Number(process.env…)` directly.
 *
 * ## Refusing, not throwing
 *
 * A bad value gives the default and is recorded, and the server starts. The
 * alternative — refusing to boot — is defensible for a setting like
 * `SONE_SECRET_KEY`, which `config.ts` does throw for, and wrong for these:
 * every one of them has a sensible default, and an instance that will not start
 * because somebody typed `SONE_DB_POOL_MAX=ten` has turned a slow query into an
 * outage.
 *
 * What must not happen is the refusal being silent, which is the failure this
 * whole family produces: `SONE_JOB_RESULT_HOURS=x` made every finished job
 * write `expires_at` from an Invalid Date, so Postgres rejected the completion
 * of work that had actually succeeded, and the runner recorded it as failed.
 * Nothing in that chain says "check the environment".
 */

/**
 * What a caller expects of the number.
 *
 * `min` is the interesting one. Every bound in this codebase exists because
 * zero or negative has a meaning in the place the number lands, and it is never
 * the meaning somebody intended: zero retention days is "delete all history",
 * zero result hours is "the export expires before the download starts", zero
 * quiet minutes is "take a version of everything, every five minutes".
 */
export interface NumberBounds {
  min?: number;
  max?: number;
  /** Reject a fraction rather than truncating it, where only whole units mean anything. */
  integer?: boolean;
}

/** Keys whose value was refused, in the order they were read. */
const refused = new Map<string, string>();

/**
 * What the environment asked for and did not get, for the boot log.
 *
 * A copy: a caller iterating this while another module is still being imported
 * would otherwise see the map change under it, and the whole point is a message
 * somebody reads once at startup.
 */
export const refusedEnvNumbers = (): Array<{ key: string; value: string }> =>
  [...refused.entries()].map(([key, value]) => ({ key, value }));

/** Test seam: these constants are read at import time, so a test needs a reset. */
export const forgetRefusedEnvNumbers = (): void => refused.clear();

/**
 * A number from the environment, or the default.
 *
 * Refuses rather than clamps, deliberately. Clamping `SONE_JOB_RESULT_HOURS=0`
 * up to 1 would silently give an operator something they did not ask for and
 * leave them believing the setting works; falling back to the documented
 * default and saying so at startup gives them the same working instance and a
 * sentence to search for.
 */
export function envNumber(
  key: string,
  fallback: number,
  bounds: NumberBounds = {},
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return fallback;

  const asked = Number(raw);
  const ok =
    Number.isFinite(asked) &&
    (!bounds.integer || Number.isInteger(asked)) &&
    (bounds.min === undefined || asked >= bounds.min) &&
    (bounds.max === undefined || asked <= bounds.max);

  if (!ok) {
    refused.set(key, raw);
    return fallback;
  }
  return asked;
}
