/**
 * SONE — formatting a message (ADR-0041).
 *
 * A subset of ICU MessageFormat: `{name}` substitution, `{n, plural, …}` and
 * `{x, select, …}`. Forty lines rather than a dependency, because the only hard
 * part is the plural rule and `Intl.PluralRules` is the platform's.
 *
 * Why plurals at all, when a ternary looks shorter: German has different rules
 * around zero from English, Polish has four forms, Arabic six. `n === 1 ? 'entry'
 * : 'entries'` is not a string with a variant — it is English grammar written in
 * code, and no catalogue can translate it. Several of those existed in this
 * codebase before this file did.
 *
 * ## In `core` because a mail is a message too (ADR-0133)
 *
 * It lived in `packages/web` while the interface was the only thing with a
 * catalogue. The mails have one now, and they need the same plural rule, the
 * same `select`, and the same answer for a placeholder nobody supplied — so the
 * alternative to moving it was a second implementation whose difference from
 * this one nobody would notice until a German reader met a sentence written for
 * English grammar.
 *
 * Nothing here touches a DOM or a database. That is what made it movable, and
 * it is worth keeping true.
 */

export type MessageValues = Record<string, string | number>;

/**
 * Split the body of a `{…}` block on commas at depth zero.
 *
 * Nested braces are the normal case — `one {# entry}` — so a plain `split(',')`
 * would cut inside them.
 */
function topLevelParts(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let at = 0; at < body.length; at++) {
    const char = body[at];
    if (char === '{') depth++;
    else if (char === '}') depth--;
    else if (char === ',' && depth === 0) {
      parts.push(body.slice(start, at));
      start = at + 1;
    }
  }
  parts.push(body.slice(start));
  return parts;
}

/** The `key {text}` branches of a plural or select block. */
function branches(rest: string): Map<string, string> {
  const found = new Map<string, string>();
  let at = 0;
  while (at < rest.length) {
    // A branch name: anything up to the opening brace.
    const open = rest.indexOf('{', at);
    if (open === -1) break;
    const name = rest.slice(at, open).trim();

    let depth = 0;
    let close = open;
    for (; close < rest.length; close++) {
      if (rest[close] === '{') depth++;
      else if (rest[close] === '}') {
        depth--;
        if (depth === 0) break;
      }
    }
    if (depth !== 0) break;

    found.set(name, rest.slice(open + 1, close));
    at = close + 1;
  }
  return found;
}

/**
 * Find the matching `}` for the `{` at `open`.
 *
 * Counted rather than searched, because a plural block contains braces.
 */
function matchingBrace(text: string, open: number): number {
  let depth = 0;
  for (let at = open; at < text.length; at++) {
    if (text[at] === '{') depth++;
    else if (text[at] === '}') {
      depth--;
      if (depth === 0) return at;
    }
  }
  return -1;
}

export function formatMessage(
  message: string,
  values: MessageValues = {},
  locale = 'en',
): string {
  let out = '';
  let at = 0;

  while (at < message.length) {
    const open = message.indexOf('{', at);
    if (open === -1) {
      out += message.slice(at);
      break;
    }
    out += message.slice(at, open);

    const close = matchingBrace(message, open);
    if (close === -1) {
      // An unbalanced brace is a broken message. Emitted as it stands rather
      // than swallowed: a visible `{` is a bug report, and a silently dropped
      // half-sentence is not.
      out += message.slice(open);
      break;
    }

    const parts = topLevelParts(message.slice(open + 1, close));
    const name = (parts[0] ?? '').trim();
    const kind = (parts[1] ?? '').trim();

    if (kind === 'plural' || kind === 'select') {
      const options = branches(parts.slice(2).join(','));
      const value = values[name];

      let chosen: string | undefined;
      if (kind === 'plural') {
        const count = typeof value === 'number' ? value : Number(value ?? 0);
        // An exact match wins over the category: `=0 {nothing}` is how a
        // language says something specific about zero, and every language has
        // one of those somewhere.
        chosen =
          options.get(`=${count}`) ??
          options.get(new Intl.PluralRules(locale).select(count)) ??
          options.get('other');
      } else {
        chosen = options.get(String(value)) ?? options.get('other');
      }

      /*
       * `#` is the count, which is what makes a plural branch readable — and it
       * belongs to a **plural** and to nothing else.
       *
       * It was replaced for a `select` too, using the select's own value, which
       * is a bug the German mails found by being the first messages to put a
       * plural inside a `{address, select, …}`: `Sie haben # Tage` came out as
       * *„Sie haben formal Tage"*. The interface was one `#` away from the same
       * thing and had simply never written one.
       */
      const filled = kind === 'plural' ? (chosen ?? '').replaceAll('#', String(value ?? '')) : (chosen ?? '');
      out += formatMessage(filled, values, locale);
    } else {
      const value = values[name];
      // A missing value leaves the placeholder visible for the same reason an
      // unbalanced brace does.
      out += value === undefined ? `{${name}}` : String(value);
    }

    at = close + 1;
  }

  return out;
}
