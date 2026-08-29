/**
 * The size scale.
 *
 * A checkbox rendered 44px tall because a global button minimum applied to it.
 * That is what this scale exists to prevent: a size chosen once, in the wrong
 * place, applying everywhere.
 *
 * These tests read the stylesheet as text. That is unusual and deliberate —
 * jsdom does not compute layout, so the only thing testable is whether the
 * rules say what they should. It catches the two mistakes that actually
 * happened: an element-wide rule that should be a class, and a control with a
 * hand-picked size instead of a scale value.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { codeOf } from './helpers/source.ts';

const raw = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/styles.css'),
  'utf8',
);

/**
 * The stylesheet without comments.
 *
 * A first version of the size check scanned the raw file and flagged a
 * `min-height: 44px` written inside a comment explaining why that value is
 * wrong. A check with false positives is worse than no check: it teaches people
 * to ignore the output. The same mistake was made once before, in the migration
 * checker, on apostrophes.
 */
const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');

test('comments are excluded from the scan', () => {
  // The check below would otherwise flag the comment that explains why a
  // hand-written 44px is wrong.
  assert.ok(raw.includes('min-height: 44px'), 'the explaining comment is still there');
  assert.ok(!css.includes('min-height: 44px'), 'and it is not scanned as a rule');
});

test('the scale is defined', () => {
  for (const name of [
    '--sone-marker',
    '--sone-control',
    '--sone-control-lg',
    '--sone-tap',
    '--sone-space-4',
    '--sone-radius',
  ]) {
    assert.ok(css.includes(`${name}:`), `${name} is not defined`);
  }
});

test('the bare button selector styles nothing but inheritance', () => {
  // `button { min-height: 44px }` is what stretched a 15px checkbox into a
  // rounded rectangle overlapping its own label. A button is used for form
  // submits, icon buttons, menu items, checkboxes and disclosure triangles;
  // sizing all of those together cannot be right.
  const match = /\nbutton \{([^}]*)\}/.exec(css);
  assert.ok(match, 'a bare button rule should still exist for font and cursor');
  const body = match[1]!;
  for (const forbidden of ['min-height', 'min-block-size', 'padding', 'border:']) {
    assert.ok(
      !body.includes(forbidden),
      `the bare button rule sets ${forbidden}, which then applies to every control`,
    );
  }
});

test('the framed button style is opt-in', () => {
  assert.ok(css.includes('button.btn'), 'a .btn class should carry the framed style');
});

test('markers are sized in both directions and opt out of any minimum', () => {
  // min-height beats height. A marker that sets only `block-size` is one global
  // rule away from being stretched again.
  const marker = /\.ProseMirror \.sone-todo-marker \{([^}]*)\}/.exec(css);
  assert.ok(marker, 'the checkbox rule should exist');
  assert.match(marker[1]!, /min-block-size:\s*0/);
  assert.match(marker[1]!, /block-size:\s*var\(--sone-marker\)/);
});

test('the gutter width in the stylesheet matches the one used to place it', () => {
  // The gutter is positioned from its right edge, so the code has to know how
  // wide it is. Two places holding one number drift; this notices.
  // readFileSync is already imported at the top of this file; ESM has no
  // require, which the first version of this test forgot.
  const source = readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/components/BlockMenu.tsx'),
    'utf8',
  );
  const inCode = /const GUTTER_WIDTH = (\d+)/.exec(source)?.[1];
  const inCss = /\.block-gutter \{[^}]*inline-size:\s*(\d+)px/.exec(css)?.[1];

  assert.ok(inCode, 'GUTTER_WIDTH should be declared');
  assert.ok(inCss, '.block-gutter should set an explicit width');
  assert.equal(inCss, inCode, 'the stylesheet and the placement disagree');
});

test('narrow screens reserve room for the gutter', () => {
  // On a phone the content runs edge to edge, and without extra padding the
  // controls have nowhere to go but on top of the first line.
  // Read from the variable rather than from the rule, which now references it.
  // The first version of this test matched a literal rem value and broke the
  // moment the value was named — a check that only works while nothing is
  // refactored is not much of a check.
  const editorPadding = /--sone-text-indent:\s*([\d.]+)rem/.exec(css);
  const narrowPadding = /@media \(max-width: 60rem\)[\s\S]{0,200}?padding-inline-start:\s*(\d+)px/.exec(css);
  const gutterWidth = /\.block-gutter \{[^}]*inline-size:\s*(\d+)px/.exec(css);

  assert.ok(narrowPadding, 'narrow screens should reserve extra padding');
  assert.ok(gutterWidth, '.block-gutter should have a width');

  assert.ok(editorPadding, '--sone-text-indent should be defined in rem');
  const reserved = Number(narrowPadding[1]) + Number(editorPadding[1]) * 16;
  assert.ok(
    reserved >= Number(gutterWidth[1]),
    `only ${reserved}px reserved for a ${gutterWidth[1]}px gutter`,
  );
});

test('the title and the body share one text indent', () => {
  // The editor reserves space for list markers; the title did not, so the
  // heading sat 24px to the left of its own body text — a misalignment people
  // see without being able to name.
  assert.match(css, /\.ProseMirror \{[^}]*padding-inline-start:\s*var\(--sone-text-indent\)/);
  assert.match(css, /\.page-title \{[^}]*var\(--sone-text-indent\)/);
});

test('table styling does not depend on attributes the node view drops', () => {
  // Enabling column resizing installs prosemirror-tables' own node view, which
  // builds the table in JavaScript and never consults the schema's toDOM — so
  // `data-block` is absent from a rendered table, and a selector requiring it
  // matches nothing. A whole section of table styling was dead this way, and
  // the page showed a container with no borders and no header.
  const dead = [...css.matchAll(/table\[data-block=/g)];
  assert.equal(
    dead.length,
    0,
    'a table selector requires data-block, which the node view does not emit',
  );

  // And the styling has to exist at all.
  assert.match(css, /\.ProseMirror table \{[^}]*table-layout:\s*fixed/);
  assert.match(css, /\.ProseMirror \.tableWrapper/);
});

test('no control invents its own tap size', () => {
  // A hand-written 44px is a scale value that has drifted from the scale.
  const offenders = [...css.matchAll(/min-(?:height|block-size):\s*44px/g)];
  assert.equal(
    offenders.length,
    0,
    'use var(--sone-tap) so the size can be changed in one place',
  );
});

test('the caret label fades and the bar does not', () => {
  // A name beside a caret says "somebody is working here", and left on screen
  // it goes on saying that after they stopped. The bar stays: it says another
  // person is in the document, which remains true.
  assert.match(css, /\.sone-caret-label\s*\{[^}]*animation:/);
  assert.match(css, /@keyframes sone-caret-label-fade/);
  // Hovering brings it back, so the information is quiet rather than gone.
  assert.match(css, /\.ProseMirror-yjs-cursor:hover \.sone-caret-label/);
});

test('the error banner does not take part in the app grid', () => {
  // It was a child of `.app`, a two-column grid with no explicit rows, so a
  // third element pushed the sidebar into one row and the page into another —
  // the layout came apart at the moment something had already gone wrong. A
  // message about a failure must not itself be one.
  const banner = css.slice(css.indexOf('.app-error {'));
  const rule = banner.slice(0, banner.indexOf('}'));
  assert.match(rule, /position:\s*fixed/);
  assert.doesNotMatch(rule, /grid-column/);
});

test('the status line truncates rather than wrapping', () => {
  // A status that changes the height of its bar moves everything below it, at
  // the moment somebody is least able to afford surprises.
  assert.match(css, /\.topbar\b[^}]*flex-wrap:\s*nowrap/);
  assert.match(css, /\.topbar \.status-text\b[^}]*text-overflow:\s*ellipsis/);
});

test('presentation attributes are styled for every value the schema allows', () => {
  // A value the schema emits and the stylesheet ignores is a setting that
  // appears to have been accepted and does nothing.
  for (const align of ['start', 'center', 'end']) {
    assert.ok(css.includes(`[data-align='${align}']`), align);
  }
  for (const width of ['wide', 'full']) {
    assert.ok(css.includes(`[data-width='${width}']`), width);
  }
  for (const color of ['grey', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink']) {
    assert.ok(css.includes(`[data-color='${color}']`), color);
  }
});

test('nothing breaks out of the column on a narrow screen', () => {
  // There is no margin to break into, and doing it anyway pushes the text off
  // the side of the page.
  assert.match(css, /max-width: 720px\)[\s\S]{0,400}data-width='full'\][\s\S]{0,80}margin-inline: 0/);
});

test('the appearance controls act on click, like every other popup', () => {
  // Acting on pointerdown fires before a finger lifts and cancels the scroll
  // gesture with it — the root cause of every touch bug in this project.
  const source = readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/components/BlockMenu.tsx'),
    'utf8',
  );
  assert.equal([...source.matchAll(/onPointerDown=\{/g)].length, 0);
  assert.match(source, /popupItem\(\(\) => run\(setBlockStyle/);
});

test('a block type nobody listed still gets a control', () => {
  // Better a small default than a section that silently vanishes when somebody
  // adds a block type and forgets the table.
  const source = readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/components/BlockMenu.tsx'),
    'utf8',
  );
  assert.match(source, /APPEARANCE\[node\.type\.name\] \?\? \{/);
});

test('the column type menu opens away from the data', () => {
  // It grew leftward across the rows, covering the table while you choose what
  // kind of column to add to it. Rightward is where the new column is about to
  // appear — and on a narrow screen there is no room there, so it flips back.
  const menu = css.slice(css.indexOf('.collection-type-menu {'));
  const rule = menu.slice(0, menu.indexOf('}'));
  assert.match(rule, /inset-inline-start:\s*0/);
  assert.match(css, /max-width: 720px\)[\s\S]{0,200}collection-type-menu[\s\S]{0,120}inset-inline-end:\s*0/);
});

test('the title column says it is fixed rather than just lacking a bin', () => {
  // Every other column has a remove button. A missing control reads as a bug —
  // somebody looks for it, does not find it, and concludes the interface is
  // inconsistent rather than that the column is special.
  assert.match(css, /\.collection-column-fixed/);
});

test('form controls are big enough that a phone does not zoom in', () => {
  // iOS zooms whenever a focused control has a font under 16px, and it does not
  // zoom back out — so tapping a search box left the whole page magnified.
  assert.match(css, /@media \(pointer: coarse\)[\s\S]{0,400}font-size:\s*max\(16px/);
});

test('zoom itself is not forbidden', () => {
  // user-scalable=no would also stop the symptom, and would stop somebody who
  // needs to magnify a page from doing so. Taking a capability away from people
  // who depend on it, to work around a font size, is not a trade worth making.
  //
  // Checked on the viewport tag rather than on the file: index.html already
  // carries a comment saying why zoom is not disabled, and a first version of
  // this test matched that comment. A test that cannot tell prose from markup
  // gets silenced by rewording rather than by fixing anything — the same
  // mistake I made in the file-block tests, twice now.
  const html = readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../index.html'),
    'utf8',
  );
  const viewport = /<meta name="viewport"[^>]*>/.exec(html)?.[0] ?? '';
  assert.ok(viewport !== '', 'there is a viewport tag');
  assert.doesNotMatch(viewport, /user-scalable\s*=\s*no/);
  assert.doesNotMatch(viewport, /maximum-scale/);
});

test('the page does not pull to refresh', () => {
  // Dragging a zoomed page back down was reloading it, which loses what
  // somebody was reading.
  assert.match(css, /html,\s*body\s*\{[^}]*overscroll-behavior:\s*none/);
});

test('indenting is reachable without a keyboard', () => {
  // Only Tab did this, and a phone keyboard has no Tab key — so on a touch
  // device nothing could be indented at all. That is what made a toggle
  // unusable there: its content *is* the blocks indented under it, so a toggle
  // could have a title and nothing inside it.
  const menu = readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/components/BlockMenu.tsx'),
    'utf8',
  );
  assert.match(menu, /run\(indentBlockSubtree\)/);
  assert.match(menu, /run\(outdentBlockSubtree\)/);
});

test('no rule targets a class the editor never emits', () => {
  // Six did. They were written as `.block`, and blocks carry `data-block` and
  // no class — so they sat in the stylesheet doing nothing, and paragraphs fell
  // back to the browser's own margin, which is why spacing looked uneven beside
  // headings that have deliberate ones.
  assert.doesNotMatch(css, /(^|[\s,}])\.block[\s[{]/m);
});

test('paragraph spacing is decided here, not by the browser', () => {
  assert.match(css, /\.ProseMirror p\[data-block\][^}]*margin-block/);
});

test('an element that can be hidden is not forced visible by a display rule', () => {
  // This is why a file block's menu stayed open, and why no amount of event
  // handling could have fixed it: the browser's rule for [hidden] is
  // `display: none`, and any class selector setting `display` beats it. The
  // element carried hidden="" and rendered anyway.
  //
  // Checked rather than remembered, because the mistake is invisible in both
  // files on their own — the component looks right, the stylesheet looks right,
  // and only the pair is wrong.
  const components = readdirSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/components'),
  ).filter((name) => name.endsWith('.tsx') || name.endsWith('.ts'));

  const offenders: string[] = [];

  for (const file of components) {
    // Without comments, and `aria-hidden` is not `hidden` — a first version
    // counted both and produced nine hits of which one was real. A check with
    // eight false positives is one nobody reads.
    const source = codeOf(
      new URL(`../src/components/${file}`, import.meta.url),
    );

    // Elements that carry both a class and `hidden`, in either order, close
    // enough together to be the same tag.
    const pairs = [
      // The attribute, not the word. `aria-hidden` and `visibility: 'hidden'`
      // both contain it and neither hides anything the browser's [hidden] rule
      // would act on — counting them produced nine hits of which one was real,
      // and a check with eight false positives is one nobody reads.
      //
      // Lookaheads rather than plain matches, so one pair does not consume the
      // text a later pair sits in. Written the obvious way first, it found the
      // trigger's class, swallowed the next eighty characters, and missed the
      // menu's — the one element with the bug. The check passed while the bug
      // was present, which is the worst thing a check can do.
      ...source.matchAll(
        /className="([a-z0-9-]+)"(?=[\s\S]{0,200}?(?<![-\w'"])hidden(?=[\s=/>]))/g,
      ),
      ...source.matchAll(
        /(?<![-\w'"])hidden(?=[\s=/>])(?=[\s\S]{0,200}?className="([a-z0-9-]+)")/g,
      ),
      ...source.matchAll(/className = '([a-z0-9-]+)'(?=[\s\S]{0,400}?\.hidden\s*=)/g),
    ];

    for (const [, className] of pairs) {
      const rule = new RegExp(`\\.${className}\\s*\\{[^}]*display\\s*:`);
      if (!rule.test(css)) continue;
      if (css.includes(`.${className}[hidden]`)) continue;
      offenders.push(`${file}: .${className}`);
    }
  }

  assert.deepEqual(offenders, [], `display beats hidden: ${offenders.join(', ')}`);
});

test('the gutter anchors to a block that has nothing inside it', () => {
  // `domAtPos(from + 1)` looks inside the block, which works for a paragraph and
  // not for an atom: an image or a file has nothing inside to find, so the
  // lookup returned the editor's root and the gutter was positioned against
  // that — at the very top of the page.
  const menu = codeOf(
    new URL('../src/components/BlockMenu.tsx', import.meta.url),
  );
  assert.match(menu, /view\.nodeDOM\(from\)/);
  const nodeDomAt = menu.indexOf('view.nodeDOM(from)');
  const posAt = menu.indexOf('view.domAtPos(from + 1)');
  assert.ok(nodeDomAt > 0 && nodeDomAt < posAt, 'the node’s own element is tried first');
});

test('an image is offered only the widths that differ', () => {
  // "Wide" is a step between the column and the page, and for an image all
  // three read as "the width of the text, or a bit more" — three names for one
  // thing, which is how it was reported.
  const menu = codeOf(new URL('../src/components/BlockMenu.tsx', import.meta.url));
  assert.match(menu, /node\.type\.name === 'image'\s*\?\s*\[\]/);
});

test('full width reaches the edges of the page, and no further', () => {
  // It was a second small step outward, which is why it did not look different
  // from the column. Then it was 100vw — the *window*, sidebar included — so a
  // full-width image pushed the whole page sideways and the header scrolled
  // with it. Measured against the content area now.
  assert.match(css, /\[data-width='full'\][^}]*100cqw/);
  assert.doesNotMatch(css, /\[data-width='full'\][^}]*100vw/);
  assert.match(css, /\.main \{[^}]*container-type: inline-size/);
});

test('the gutter stays legible over whatever it sits on', () => {
  // It sits beside the block, which is empty margin for a paragraph and a
  // photograph for a full-width image — grey icons on a picture are invisible.
  const gutter = css.slice(css.indexOf('.block-gutter {'));
  assert.match(gutter.slice(0, 400), /background:/);
});

test('the page cannot scroll sideways', () => {
  // A full-width block is centred against the container while its own
  // containing block is inset by the editor's text indent, so the arithmetic
  // leaves a pixel or two over one edge — enough for a scrollbar.
  //
  // `clip` rather than `hidden`: hidden would make this a scroll container and
  // let something scroll silently instead of overflowing visibly.
  assert.match(css, /\.main \{[^}]*overflow-x: clip/);
  assert.doesNotMatch(css, /\.main \{[^}]*overflow-x: hidden/);
});
