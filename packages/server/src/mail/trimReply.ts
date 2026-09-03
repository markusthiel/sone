/**
 * SONE server — what somebody actually wrote in a reply (ADR-0060).
 *
 * Quote detection is guesswork. There is no standard for how a mail client
 * marks the message being replied to, and every one of them does it slightly
 * differently — so this is a set of stated rules rather than a clever
 * heuristic, and the result is **marked in the panel** so a reader can tell
 * that a machine trimmed a reply rather than that a colleague wrote something
 * strange.
 *
 * The rules, in order of how much they are trusted:
 *
 * 1. A line beginning `>` starts the quote. This one is nearly universal.
 * 2. An attribution line — "On … wrote:", "Am … schrieb:" and their common
 *    variants — starts the quote. Matched conservatively: a line has to look
 *    like an attribution *and* be followed by quoted or indented text, because
 *    "Am Montag schrieb ich das falsch" is a sentence somebody might write.
 * 3. A line that is exactly `-- ` starts a signature. The trailing space is
 *    part of the convention and its absence is common, so a bare `--` counts
 *    too.
 * 4. Everything from the first of those to the end is dropped.
 */

export interface TrimmedReply {
  /** What is left, with surrounding blank lines removed. */
  text: string;
  /** Whether anything was dropped, so the panel can say the reply was trimmed. */
  trimmed: boolean;
}

/** Attribution lines, English and German, as written by common clients. */
const ATTRIBUTION = [
  // "On Tue, 2 Sep 2026 at 14:03, Anna <anna@…> wrote:"
  /^\s*On .+ wrote:\s*$/i,
  // "Am 02.09.2026 um 14:03 schrieb Anna:" and "Am Dienstag, … schrieb Anna:"
  /^\s*Am .+ schrieb.*:\s*$/i,
  // Outlook and several webmails: a header block rather than a sentence.
  /^\s*-{3,}\s*(Original Message|Ursprüngliche Nachricht)\s*-{3,}\s*$/i,
  /^\s*(From|Von):\s.+$/i,
  // "Anna <anna@example.org> schrieb am …:"
  /^\s*.+<[^>]+@[^>]+>\s+(wrote|schrieb).*:\s*$/i,
];

const looksQuoted = (line: string): boolean => /^\s*>/.test(line) || /^\s{2,}\S/.test(line);

export function trimReply(body: string): TrimmedReply {
  const lines = body.replace(/\r\n/g, '\n').split('\n');

  let cut = lines.length;
  for (let at = 0; at < lines.length; at += 1) {
    const line = lines[at] ?? '';

    if (/^\s*>/.test(line)) {
      cut = at;
      break;
    }

    if (/^--\s?$/.test(line)) {
      cut = at;
      break;
    }

    if (ATTRIBUTION.some((shape) => shape.test(line))) {
      /*
       * Only when something quoted follows.
       *
       * "Am Montag schrieb ich das falsch" is a sentence, not an attribution,
       * and cutting a reply at it would silently delete what somebody said. So
       * the next non-empty line has to look quoted or indented — and a header
       * block (From:/Von:) counts as quoted for this purpose, since Outlook
       * writes several of them in a row.
       */
      const next = lines.slice(at + 1).find((one) => one.trim() !== '');
      if (
        next === undefined ||
        looksQuoted(next) ||
        ATTRIBUTION.some((shape) => shape.test(next))
      ) {
        cut = at;
        break;
      }
    }
  }

  const kept = lines.slice(0, cut).join('\n').trim();
  return { text: kept, trimmed: cut < lines.length };
}

/**
 * The text part of a mail, or null when there is none.
 *
 * `text/plain` only. An HTML-only mail is refused rather than converted: a
 * guess at what somebody's markup meant would arrive in a page as a sentence
 * they did not write, and answering "send it as text" is the honest failure.
 *
 * Deliberately not a MIME parser. It takes the plain part a parser handed it,
 * and exists so the decision above is written down where it applies.
 */
export function plainBody(parts: Array<{ mime: string; text: string }>): string | null {
  const plain = parts.find((part) => part.mime.toLowerCase().startsWith('text/plain'));
  return plain?.text ?? null;
}
