/**
 * SONE server — what a mail says, once, and how it is drawn twice (ADR-0121).
 *
 * Asked for as *„außerdem ein schönes Mail-Design"*, against a rule written
 * where the mails were composed:
 *
 * > Plain text only: an HTML mail is a second thing to keep true.
 *
 * The rule is right about **two documents** and not about two renderings. What
 * it was protecting against is a text part and an HTML part maintained side by
 * side, which drift: a line added to one and forgotten in the other, and only
 * half the recipients ever see the difference.
 *
 * So a mail is a **structure** — what it is about, its lines, the one thing to
 * do, why it arrived — and both forms are produced from it. A line added to a
 * letter appears in both or in neither, and there is nothing to keep in step.
 *
 * ## What did not change
 *
 * **Who and where. Never what** (ADR-0058). This module decides how a letter
 * looks; what may go in one is decided where it is built, exactly as before. A
 * prettier mail must not become a mail that says more, and the test for that
 * runs against both renderings.
 *
 * **No remote images.** Not a logo, not a spacer, not a pixel. A remote image
 * tells the sender when a mail was opened and roughly from where, and this
 * project does not measure that. The wordmark is text until an instance has a
 * logo of its own to inline.
 */

export interface LetterLine {
  /** One sentence, as a person would read it aloud. */
  text: string;
  /** Where it points, if anywhere. */
  url?: string;
  /**
   * A detail belonging to the line above it.
   *
   * One field rather than a group structure, because one letter needs it — the
   * digest lists pages under the workspace they changed in — and a nesting
   * model built for one caller is a model the next one will not fit either.
   */
  under?: boolean;
}

export interface Letter {
  subject: string;
  /**
   * One line above the rest, larger. Optional, and usually absent for a
   * notification — its lines *are* the heading.
   */
  heading?: string;
  lines: LetterLine[];
  /** The one thing to do: a button in HTML, a labelled URL in text. */
  action?: { label: string; url: string };
  /** Quiet lines at the end: why this arrived, how to stop it. */
  footer?: string[];
  /**
   * The instance's accent, as a hex colour.
   *
   * Absent means the design's own. A workspace accent is a name in a palette
   * that only the browser can resolve (ADR-0023), so what reaches here is
   * already a literal or nothing at all.
   */
  accent?: string;
  /**
   * The mark at the top, as an attachment this message carries (ADR-0132).
   *
   * A `cid`, never a URL. ADR-0121 refused remote images and refuses them
   * still: one would tell the sender when the mail was opened and roughly from
   * where. An attachment tells nobody anything.
   *
   * Absent falls back to the wordmark as text, which is what every mail sent
   * before this looked like and what an instance with no logo still gets.
   */
  logoCid?: string;
  /** What the mark says when it cannot be shown: the instance's name. */
  logoAlt?: string;
  /** Where SONE lives, for the wordmark. */
  baseUrl: string;
  locale: 'en' | 'de';
}

/**
 * A URL safe to put in an `href`.
 *
 * Every URL in a letter is built by SONE today. That is a fact about the
 * callers and not about the type — and `javascript:` in an `href` is one caller
 * away, which some mail clients still follow. The line survives without its
 * link rather than the whole letter failing: a mail that arrived saying what
 * happened is worth more than one that did not arrive.
 */
function safeUrl(url: string | undefined): string | null {
  if (!url) return null;
  return /^https?:\/\//i.test(url) ? url : null;
}

/** Text that cannot become markup. Page titles and names reach these lines. */
function escape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * What a text-only client shows.
 *
 * Deliberately close to what these mails said before there was an HTML part:
 * the line, then its link under it, blank lines between, the footer last. Plain
 * URLs, not wrapped and not per-recipient — whether somebody followed a link is
 * not worth becoming the kind of software that measures it.
 */
export function renderText(letter: Letter): string {
  const blocks: string[] = [];
  if (letter.heading) blocks.push(letter.heading);

  for (const line of letter.lines) {
    const url = safeUrl(line.url);
    const indent = line.under ? '  ' : '';
    const body = url ? `${indent}${line.text}\n${indent}${url}` : `${indent}${line.text}`;
    // A detail joins the block above it rather than starting one: a blank line
    // between a workspace and the pages under it undoes the grouping.
    if (line.under && blocks.length > 0) blocks[blocks.length - 1] += `\n${body}`;
    else blocks.push(body);
  }

  const action = letter.action && safeUrl(letter.action.url);
  if (letter.action && action) blocks.push(`${letter.action.label}: ${action}`);

  if (letter.footer?.length) blocks.push(letter.footer.join('\n'));

  return `${blocks.join('\n\n')}\n`;
}

/*
 * The shell.
 *
 * A table, because flexbox and grid do not survive Outlook. Styles inline,
 * because Gmail removes `<style>` — so the inline values are the light ones and
 * a client that strips the block still shows a mail that reads. The block
 * carries only the dark-mode query, which cannot be inlined at all.
 *
 * 600px is the width every mail client has been able to show since the
 * nineteen-nineties, and it is still the honest answer.
 */
const INK = '#26241f';
const MUTED = '#6a675f';
const PAPER = '#faf8f4';
const CARD = '#ffffff';
const LINE = '#e5e1d8';
const DEFAULT_ACCENT = '#2f6f5e';

export function renderHtml(letter: Letter): string {
  const accent = /^#[0-9a-f]{6}$/i.test(letter.accent ?? '') ? letter.accent! : DEFAULT_ACCENT;
  const action = letter.action && safeUrl(letter.action.url);

  const lines = letter.lines
    .map((line) => {
      const url = safeUrl(line.url);
      const text = escape(line.text);
      const body = url
        ? `<a href="${escape(url)}" style="color:${accent};text-decoration:none">${text}</a>`
        : text;
      const style = line.under
        ? `margin:0 0 4px;padding-inline-start:16px;font-size:14px;line-height:1.5;color:${MUTED}`
        : `margin:0 0 14px;font-size:15px;line-height:1.5;color:${INK}`;
      return `<p class="${line.under ? 'sone-muted' : 'sone-ink'}" style="${style}">${body}</p>`;
    })
    .join('\n');

  const button =
    letter.action && action
      ? `
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0 4px">
          <tr><td style="background:${accent};border-radius:2px">
            <a href="${escape(action)}" style="display:inline-block;padding:10px 18px;font-size:15px;color:#ffffff;text-decoration:none">${escape(letter.action.label)}</a>
          </td></tr>
        </table>`
      : '';

  const footer = (letter.footer ?? [])
    .map(
      (line) =>
        `<p style="margin:0 0 6px;font-size:12px;line-height:1.5;color:${MUTED}">${escape(line)}</p>`,
    )
    .join('\n');

  const heading = letter.heading
    ? `<h1 style="margin:0 0 14px;font-size:19px;font-weight:600;line-height:1.3;color:${INK}">${escape(letter.heading)}</h1>`
    : '';

  const home = safeUrl(letter.baseUrl) ?? '';

  /*
   * The mark, or the wordmark as text (ADR-0132).
   *
   * `cid:` and never a URL — an attachment the message carries, so nothing is
   * fetched and nobody learns when it was opened (ADR-0058, ADR-0121).
   *
   * On a pale chip rather than straight on the paper: a client in dark mode
   * darkens the paper by the query below and cannot recolour a picture, so the
   * chip is what keeps a dark-inked logo legible in both. The chip is *not* in
   * the dark-mode query for the same reason — it has to stay pale.
   */
  const mark = letter.logoCid
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>` +
      `<td style="background:${PAPER};border-radius:4px;padding:8px 10px">` +
      `<a href="${escape(home)}" style="text-decoration:none">` +
      `<img src="cid:${escape(letter.logoCid)}" alt="${escape(letter.logoAlt ?? 'SONE')}" ` +
      `height="26" style="display:block;border:0;height:26px;width:auto"></a>` +
      `</td></tr></table>`
    : // Text, which is what every mail looked like before an instance could
      // carry a mark of its own.
      `<a href="${escape(home)}" class="sone-muted" style="font-size:13px;letter-spacing:0.12em;text-transform:uppercase;color:${MUTED};text-decoration:none">SONE</a>`;

  return `<!doctype html>
<html lang="${letter.locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(letter.subject)}</title>
<style>
  @media (prefers-color-scheme: dark) {
    .sone-paper { background: #1c1b18 !important; }
    .sone-card { background: #26241f !important; border-color: #3a372f !important; }
    .sone-ink { color: #f2efe8 !important; }
    .sone-muted { color: #a8a496 !important; }
  }
</style>
</head>
<body class="sone-paper" style="margin:0;padding:0;background:${PAPER}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="sone-paper" style="background:${PAPER}">
  <tr>
    <td align="center" style="padding:28px 12px">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:100%;max-width:600px">
        <tr>
          <td style="padding:0 0 12px">
${mark}
          </td>
        </tr>
        <tr>
          <td class="sone-card" style="background:${CARD};border:1px solid ${LINE};border-radius:4px;padding:22px 22px 18px">
            <div class="sone-ink">
${heading}
${lines}
            </div>
${button}
          </td>
        </tr>
        <tr>
          <td class="sone-muted" style="padding:14px 4px 0">
${footer}
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>
`;
}
