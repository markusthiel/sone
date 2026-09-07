/**
 * The shared components: fields, buttons, and everything that floats.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { codeOf, stylesOf } from './helpers/source.ts';

const css = stylesOf(new URL('../src/styles.css', import.meta.url));

test('a field is a surface at rest and a border when focused', () => {
  // A form of equally weighted boxes reads as heavy before anybody has read a
  // single label.
  // Matched loosely on purpose: the selector grew a list of exclusions when
  // checkboxes turned out to be caught by it, and a test that spells the
  // selector out fails on every such correction without any of them being
  // wrong.
  assert.match(css, /background: var\(--surface-sunken\);\n {2}transition: border-color/);
  // `--accent-line` rather than the raw accent since ADR-0137: this border *is*
  // the field's focus indication, so it is the one thing on the page that has to
  // be visible whatever colour a workspace picked. Whether it is, is computed in
  // `contrast.test.ts`; this is that the border is still what marks the focus.
  assert.match(css, /:focus,\s*\n?textarea:focus \{[^}]*border-color: var\(--accent-line\)/);
});

test('a focused field has one ring, not two', () => {
  // The accent border replaces the outline rather than joining it. Two rings
  // around one field is the tell of a control nobody looked at.
  assert.match(css, /:focus,\s*\n?textarea:focus \{[^}]*outline: none/);
});

test('everything else keeps a visible focus ring', () => {
  /*
   * The exception above is only allowed because it replaces the ring with
   * something at least as visible — a claim this file made in a comment and
   * nothing checked. A pale accent was a ring at 1.07:1 (ADR-0137).
   *
   * "At least as visible" is arithmetic now, in `contrast.test.ts`, over every
   * colour a workspace can choose. What is left here is that the ring exists.
   */
  assert.match(css, /button:focus-visible, a:focus-visible[^{]*\{[^}]*outline: 2px solid/);
});

test('a primary button looks the same whichever class was remembered', () => {
  // Two rules styled it — `.btn.primary` and `.primary` — and one hardcoded
  // white text, which is wrong the moment the accent lightens for dark mode
  // and black is what reads on it.
  assert.match(css, /button\.primary \{[^}]*color: var\(--accent-contrast\)/);
  assert.doesNotMatch(css, /button\.primary \{[^}]*color: #fff/);
});

test('there are three button weights and no fourth', () => {
  // A fourth is how a screen ends up with three things that all look slightly
  // important.
  assert.match(css, /button\.btn\.primary \{/);
  assert.match(css, /button\.btn\.quiet \{/);
});

test('everything that floats shares one treatment', () => {
  // Height is expressed by the overlay surface, because a shadow on a dark
  // background reads as dirt.
  // Counted on the token rather than the literal it used to be: the treatment
  // being shared is now a named one, which is the point of the count.
  const lifts = css.match(/box-shadow: var\(--sone-shadow-lg\)/g) ?? [];
  assert.ok(lifts.length >= 3, `only ${lifts.length} panels share the lift`);
  assert.match(css, /background: var\(--surface-overlay\)/);
});

// --- the areas --------------------------------------------------------------

test('the sidebar is separated by a surface, not by a rule', () => {
  // A step of surface groups; a line divides. The sidebar and the page are one
  // thing you are working in, not two placed beside each other, and a strong
  // rule between them says the opposite.
  assert.match(css, /border-inline-end: 1px solid var\(--border-subtle\)/);
  assert.match(css, /\.page-body \{[^}]*max-width: 46rem/);
});

test('the furniture is tinted and the writing is not', () => {
  // The other way round to begin with: the page was the sunken surface and the
  // sidebar sat on white above it. Wrong way for a writing tool — paper is the
  // brightest thing on a desk.
  assert.match(css, /body \{[^}]*background: var\(--surface-page\)/);
  // The topbar left this list (ADR-0042): it is not furniture beside the writing,
  // it is a strip *above* it on the same surface, and its only mark is a line
  // that appears once something has scrolled behind it.
  assert.match(css, /\.topbar \{[^}]*background: var\(--surface-page\)/s);
  // A workspace may now treat a piece of furniture differently (ADR-0122), so
  // the chrome surface is the *fallback* rather than the whole declaration —
  // which is the assertion that still matters: a workspace that has treated
  // nothing looks exactly as it did before treatments existed.
  for (const area of ['\\.sidebar', '\\.right-panel']) {
    assert.match(
      css,
      new RegExp(`${area} \\{[^}]*background: var\\(--sone-theme-[a-z]+-bg, var\\(--surface-chrome\\)\\)`),
      `${area} is furniture`,
    );
  }
});

test('a heading does not move when it is clicked', () => {
  // Two ways it did. The border was declared on focus, so the words below moved
  // a pixel; and a folder's name was a button that became an input, which
  // changed the heading's height and nudged the whole page down. The border is
  // declared transparent at rest, and there is one element now instead of two.
  assert.match(css, /\.page-title \{[^}]*border-block-end: 1px solid transparent/);
  const folderView = codeOf(new URL('../src/components/FolderView.tsx', import.meta.url));
  assert.doesNotMatch(folderView, /renaming/, 'no rename state to swap elements on');
  assert.match(folderView, /className="page-title"/, 'the same element a page uses');
});

test('editing a title is a line, not a box', () => {
  // The field rule fills a focused input with a surface and draws a border
  // round it, which is right for a form: clicking a heading turned it into a
  // white bar across the page and read as a dialog having opened.
  //
  // The selector has to carry an element to outweigh that rule, which is the
  // trap already recorded beside it.
  assert.match(css, /input\.page-title:focus[^{]*\{[^}]*background: transparent/);
  assert.match(
    css,
    /input\.page-title:focus[^{]*\{[^}]*border-block-end-color: var\(--border-default\)/,
  );
  // Declared transparent at rest, so showing it moves nothing.
  assert.match(
    css,
    /\.page-title \{[^}]*border-block-end: 1px solid transparent/,
  );
});

test('a settings screen uses the same two surfaces as everything else', () => {
  /*
   * It kept the old arrangement after the rest of the interface was turned
   * over: a tinted section with a white list beside it, the opposite of the
   * application it belonged to.
   *
   * It has no surfaces of its own at all now (ADR-0069). The settings are
   * content in the shell, so the paper is the shell's paper and the list beside
   * them is the panel every mode has — which is where the rule that used to be
   * asserted here now lives.
   */
  assert.doesNotMatch(css, /\.settings-screen/);
  assert.match(css, /\.sidebar \{[^}]*background: var\(--sone-theme-sidebar-bg, var\(--surface-chrome\)\)/);

  // A card is set off from the paper, and not with the surface its own fields
  // use — a field that matches its card is a field nobody can see.
  for (const box of ['\\.settings-card', '\\.admin-table']) {
    assert.match(
      css,
      new RegExp(`${box} \\{[^}]*background: var\\(--surface-chrome\\)`),
      `${box} is set off`,
    );
    assert.doesNotMatch(
      css,
      new RegExp(`${box} \\{[^}]*background: var\\(--surface-sunken\\)`),
      `${box} is not the field surface`,
    );
  }
});

test('the settings body is described in one rule', () => {
  // The screen it used to live in was described in two — one capped it at 900px
  // with a padding, the other made it a fixed layer at inset 0, and both
  // applied. The screen is gone; the guard moves to what replaced it rather
  // than going with it.
  const rules = [...css.matchAll(/^\.settings-body \{/gm)];
  assert.equal(rules.length, 1);
});

test('the writing has no surface of its own', () => {
  // A sheet under the text sounded right and looked wrong: on a wide screen the
  // column read as a lighter panel floating in a darker window — a distinction
  // nobody asked for, and one the eye keeps re-noticing.
  assert.doesNotMatch(css, /\.page-body \{[^}]*background: var\(--surface\)/);
});

test('a checkbox is not treated as a text field', () => {
  // The field rule sets a full-width box 44px tall, which is right for
  // something you type in and absurd for a checkbox: they rendered as enormous
  // blue lozenges filling the row.
  assert.match(css, /input:not\(:where\(\[type='checkbox'\]/);
  assert.match(css, /input\[type='checkbox'\], input\[type='radio'\] \{[^}]*accent-color: var\(--accent\)/);
});

test('the settings navigation reads down the left, not down the middle', () => {
  // A column flex box centres its children without align-items, and the text
  // inside each child centres without text-align. Both were missing, so the
  // entries sat in the middle of a left-hand column.
  assert.match(css, /\.settings-nav-item \{[^}]*align-items: flex-start/);
  assert.match(css, /\.settings-nav-item \{[^}]*text-align: start/);
});

test('the field rule cannot outweigh a class written for one field', () => {
  // Chained `:not(a):not(b):not(c)` adds three classes' worth of specificity, so
  // the generic rule beat `.page-title` and drew a box around the page heading.
  // `:where()` contributes none.
  assert.match(css, /input:not\(:where\(\[type='checkbox'\], \[type='radio'\], \[type='color'\]\)\)/);
  assert.doesNotMatch(css, /input:not\(\[type='checkbox'\]\):not\(\[type='radio'\]\)/);
});

test('every icon in the set has a size of its own', () => {
  // Two did not: a 16-unit box, a 1.3 stroke, and no width or height — so they
  // filled whatever they were put in. A stylesheet happened to size them in the
  // sidebar, and the moment one was used in the settings switcher, where no rule
  // named it, it came out as a sun the width of the column.
  //
  // A member of a set drawn differently from the set is a trap for whoever uses
  // it next, so this counts the ones that skip the shared construction.
  const icons = codeOf(new URL('../src/components/icons.tsx', import.meta.url));
  const drawn = [...icons.matchAll(/export function (\w+Icon)\(([^)]*)\)/g)];
  assert.ok(drawn.length > 20, 'the set was found');
  for (const [, name, params] of drawn) {
    assert.match(params ?? '', /props: IconProps/, `${name} takes the shared props`);
  }
  assert.doesNotMatch(icons, /viewBox="0 0 16 16"/, 'and one box for the whole set');
});

test('the sidebar footer is laid out in one rule', () => {
  // There were two, and the later one set `display: flex` without a direction —
  // so the earlier one's `column` stayed and the four marks stacked. A property
  // left unset is not a property left alone. They are one rule now, which is
  // what the original note was asking for: the placement moved in beside the
  // layout when the footer started appearing in a second column.
  // Counted at the top level only. The rail scopes a few of its own overrides
  // to `.rail-account .sidebar-footer` — the name and the version do not fit in
  // 56px — and a scoped override is not the fault this guards, which was two
  // rules for the same element at the same specificity.
  const rules = css.match(/^\.sidebar-footer \{/gm) ?? [];
  assert.equal(rules.length, 1);
  assert.doesNotMatch(css, /^\.sidebar-footer \{[^}]*flex-direction: column/m);
  assert.match(css, /\.sidebar-footer \{[^}]*margin-block-start: auto/);
});

test('a matched passage is split, never put through innerHTML', () => {
  // The passage comes out of somebody's document. Rendering it as markup to get
  // two tags would be a stored-XSS hole, which is why the delimiters are control
  // characters and not `<mark>` (ADR-0033).
  const search = codeOf(new URL('../src/components/Search.tsx', import.meta.url));
  assert.match(search, /text\.split\(MATCH_OPEN\)/);
  assert.doesNotMatch(search, /dangerouslySetInnerHTML/);

  const server = codeOf(new URL('../../server/src/http/pages.ts', import.meta.url));
  assert.match(server, /StartSel=\\u0002, StopSel=\\u0003/);
  assert.doesNotMatch(server, /StartSel=<mark>/);
});

test('an older bundle says so where it cannot be missed', () => {
  // The check existed and lived in Settings → About, which is the last place
  // anybody looks. Three debugging rounds went into "is the browser running the
  // code we are talking about", and each answer came from a screenshot of an
  // asset hash rather than from the application.
  const notice = codeOf(new URL('../src/components/StaleBundleNotice.tsx', import.meta.url));
  const app = codeOf(new URL('../src/App.tsx', import.meta.url));
  assert.match(app, /<StaleBundleNotice \/>/);
  assert.match(notice, /isStaleBundle\(info\.commit\)/);

  // Not automatic: reloading somebody's page under them loses a half-typed
  // paragraph, and an editor that reloads itself is worse than one running
  // yesterday's code.
  const effect = notice.slice(notice.indexOf('useEffect'), notice.indexOf('if (!stale'));
  assert.doesNotMatch(effect, /location\.reload/);
  assert.match(notice, /onClick=\{\(\) => window\.location\.reload\(\)\}/);
});
