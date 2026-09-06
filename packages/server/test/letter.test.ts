/**
 * One letter, two renderings (ADR-0121).
 *
 * Asked for as *„außerdem ein schönes Mail-Design"*, against a rule in the file
 * it would replace:
 *
 * > Plain text only: an HTML mail is a second thing to keep true.
 *
 * The rule is right about *two documents* and not about two renderings. A mail
 * is built here as a structure — what it is about, its lines, the one thing to
 * do, why it arrived — and the text and the HTML are both produced from it. So
 * there is nothing to keep in step: a line added to a letter appears in both or
 * in neither.
 *
 * The tests that matter are the ones about what must be true of **both**
 * renderings, because that is the property the old rule was protecting.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { renderHtml, renderText, type Letter } from '../src/mail/letter.js';

const letter = (over: Partial<Letter> = {}): Letter => ({
  subject: 'Anna — “Q3 Planung”',
  lines: [{ text: 'Anna hat dich erwähnt auf “Q3 Planung”.', url: 'https://sone.example.org/p/1' }],
  action: { label: 'Seite öffnen', url: 'https://sone.example.org/p/1' },
  footer: ['Diese Nachricht enthält absichtlich keinen Kommentartext.'],
  baseUrl: 'https://sone.example.org',
  locale: 'de',
  ...over,
});

describe('both renderings', () => {
  test('say the same things', () => {
    // The whole argument for one structure. A line that reached one rendering
    // and not the other is exactly the drift ADR-0058 refused to risk.
    const one = letter();
    const text = renderText(one);
    const html = renderHtml(one);

    for (const said of ['Anna hat dich erwähnt', 'Q3 Planung', 'absichtlich keinen']) {
      assert.match(text, new RegExp(said), `text says ${said}`);
      assert.match(html, new RegExp(said), `html says ${said}`);
    }
    assert.match(text, /https:\/\/sone\.example\.org\/p\/1/);
    assert.match(html, /href="https:\/\/sone\.example\.org\/p\/1"/);
  });

  test('and carry nothing that was not put in them', () => {
    /*
     * The rule this whole area exists under (ADR-0058): **who and where, never
     * what.** A prettier mail must not become a mail that says more — so the
     * renderings add wording of their own only where it is furniture, and a
     * letter with no excerpt in it produces no excerpt in either form.
     */
    const bare = letter({ lines: [{ text: 'Du wurdest erwähnt auf “Q3 Planung”.' }], footer: [] });
    delete bare.action;

    for (const rendered of [renderText(bare), renderHtml(bare)]) {
      assert.doesNotMatch(rendered, /Vertrag|Meyer|können wir/);
    }
  });
});

describe('the text rendering', () => {
  test('puts each link under the line it belongs to', () => {
    // Plain URLs, not wrapped and not per-recipient: whether somebody followed
    // a link is not worth becoming the kind of software that measures it.
    const text = renderText(
      letter({
        lines: [
          { text: 'Eins.', url: 'https://sone.example.org/p/1' },
          { text: 'Zwei.', url: 'https://sone.example.org/p/2' },
        ],
      }),
    );

    assert.match(text, /Eins\.\nhttps:\/\/sone\.example\.org\/p\/1/);
    assert.match(text, /Zwei\.\nhttps:\/\/sone\.example\.org\/p\/2/);
  });

  test('and carries no markup at all', () => {
    // It is what a text-only client shows, and a stray tag there is the visible
    // half of a mail built as one document and split in two.
    assert.doesNotMatch(renderText(letter()), /<[a-z]/i);
  });
});

describe('the html rendering', () => {
  test('escapes what people typed', () => {
    /*
     * A page title reaches a line, and a page title is text somebody wrote.
     * Unescaped, `<b>` in a heading is markup in somebody's mailbox and `"` in
     * a URL ends the attribute.
     */
    const html = renderHtml(
      letter({
        subject: 'x',
        lines: [{ text: 'Erwähnt auf <b>„fett"</b> & mehr.' }],
      }),
    );

    assert.doesNotMatch(html, /<b>/);
    assert.match(html, /&lt;b&gt;/);
    assert.match(html, /&amp; mehr/);
  });

  test('refuses a link that is not http', () => {
    /*
     * Every URL in a letter is built by SONE today. That is a fact about the
     * callers and not about the type, and `javascript:` in an `href` is one
     * caller away — some mail clients still follow one.
     */
    const html = renderHtml(
      letter({
        lines: [{ text: 'Klick', url: 'javascript:alert(1)' }],
        action: { label: 'Los', url: 'data:text/html,x' },
      }),
    );

    assert.doesNotMatch(html, /javascript:|data:text/);
    assert.match(html, /Klick/, 'the line survives, only the link is dropped');
  });

  test('styles inline, because a mail client removes a stylesheet', () => {
    // Gmail strips `<style>`, so anything only said there is not said. The
    // block is there for the dark-mode query, which cannot be inlined at all —
    // and the inline values are the light ones, so removing the block leaves a
    // mail that reads.
    const html = renderHtml(letter());
    const withoutStyleBlock = html.replace(/<style>[\s\S]*?<\/style>/g, '');

    assert.match(withoutStyleBlock, /style="[^"]*background/i, 'colours survive the strip');
    assert.match(html, /prefers-color-scheme: dark/, 'and the query is offered to those who keep it');
  });

  test('is a table, because mail clients are not browsers', () => {
    // Flexbox and grid do not survive Outlook; a table does. Stated here so
    // that a later tidy-up into `<div>`s has to argue with a test.
    assert.match(renderHtml(letter()), /<table/);
    assert.match(renderHtml(letter()), /max-width:\s*600px|width="600"/);
  });

  test('and says who it is from without fetching anything', () => {
    /*
     * No remote images — not a logo, not a spacer, not a tracking pixel. A
     * remote image in a mail tells the sender when it was opened and from
     * where, and this project does not measure that (ADR-0058). The wordmark is
     * text until an instance has a logo of its own to inline.
     */
    const html = renderHtml(letter());
    assert.doesNotMatch(html, /<img/);
    assert.match(html, /SONE/);
  });
});
