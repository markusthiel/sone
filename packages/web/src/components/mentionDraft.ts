/**
 * SONE web — naming somebody in a comment (ADR-0085).
 *
 * A comment is a plain string, not a document. That is the whole difference
 * from a mention in the page's text, and it decides everything here.
 *
 * In the page, a mention is a **node** carrying an id: the label is what is
 * drawn, the id is what is meant, and renaming somebody or deleting half the
 * word cannot make it mean somebody else. A comment message has `text` and a
 * separate `mentions: string[]` (ADR-0052), so the id cannot live inside the
 * sentence — it lives beside it, and something has to decide which of the ids
 * somebody picked while typing are still meant when they press Enter.
 *
 * **The rule is: an id counts if its `@label` is still in the text.** Type a
 * name, change your mind, delete it, and the notification goes with it. Type it
 * and leave it, and it stands. That is matching by label, which is exactly the
 * fragility a node exists to avoid — and it is the honest behaviour available
 * to a string. The alternative, keeping every id ever picked, sends somebody a
 * notification about a sentence that does not name them.
 */

export interface Picked {
  userId: string;
  label: string;
}

/**
 * Where an `@` query begins in a draft, or null.
 *
 * The same rule as the editor's plugin, in the form a textarea can answer: an
 * `@` at the start or after whitespace or an opening bracket, and at most
 * thirty characters after it. An `@` mid-word is an email address.
 */
export function mentionQueryAt(
  text: string,
  caret: number,
): { from: number; query: string } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at === -1) return null;

  const preceding = at === 0 ? '' : before[at - 1];
  if (preceding !== '' && preceding !== undefined && !/[\s([{]/.test(preceding)) return null;

  const query = before.slice(at + 1);
  // A name can contain a space, so length is what closes this rather than a
  // space — see the note in the editor's plugin.
  if (query.includes('\n') || query.length > 30) return null;
  return { from: at, query };
}

/** Put the chosen name into the draft, replacing the query. */
export function withMention(
  text: string,
  at: { from: number; query: string },
  person: Picked,
): { text: string; caret: number } {
  const head = text.slice(0, at.from);
  const tail = text.slice(at.from + 1 + at.query.length);
  const inserted = `@${person.label} `;
  return { text: `${head}${inserted}${tail}`, caret: head.length + inserted.length };
}

/**
 * Which of the people picked while typing are still named in the text.
 *
 * See the note at the top: this is matching by label, and it is what a string
 * allows. Two people with the same display name would both be notified by one
 * mention of that name — which is a real limitation and the better failure of
 * the two available, since the other is telling nobody.
 */
export function mentionsInDraft(text: string, picked: readonly Picked[]): string[] {
  const out = new Set<string>();
  for (const one of picked) {
    if (one.label !== '' && text.includes(`@${one.label}`)) out.add(one.userId);
  }
  return [...out];
}
