/**
 * SONE — bytes as something a person reads (ADR-0138).
 *
 * Four lines, and in `core` for one reason: the screen and the mail describe
 * **the same archive**. Two implementations of this rule is two chances for a
 * letter to say "48.2 MB" about a file the settings screen calls "49 MB", and
 * the person reading both would be right to wonder which file each meant.
 *
 * The same argument moved `formatMessage` here in ADR-0133 — with the
 * difference that this one is about agreeing on a *fact* rather than on a
 * grammar rule, which is the stronger version of it.
 *
 * Deliberately kibibytes with the decimal names, which is what every operating
 * system's file dialog shows and therefore what somebody will compare it to.
 */
export function readableSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
