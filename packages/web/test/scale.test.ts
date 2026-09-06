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
  // The heading is a row of icon and name, so the indent is on the row: the icon
  // starts exactly where a block below it would, and the name follows it.
  assert.match(css, /\.entry-heading \{[^}]*padding-inline-start:\s*var\(--sone-text-indent\)/);
  assert.match(css, /\.page-title \{[^}]*padding: 0;/);
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

test('the column type menu is not clipped by the table it belongs to', () => {
  // It was absolute inside the scroll container, and a container with
  // `overflow-x: auto` clips the other axis too — so the list of column types
  // was cut off at the edge of the table and the ones below the fold could
  // neither be read nor chosen. That is the report.
  const menu = css.slice(css.indexOf('.collection-type-menu {'));
  const rule = menu.slice(0, menu.indexOf('}'));
  assert.match(rule, /position: fixed/);
  assert.doesNotMatch(rule, /inset-inline-start|inset-block-start/);

  const table = codeOf(new URL('../src/components/CollectionTable.tsx', import.meta.url));
  // Placed from the button's own rectangle, and clamped so it cannot open off
  // the right edge of the window — the same failure in another direction.
  assert.match(table, /getBoundingClientRect\(\)/);
  assert.match(table, /Math\.min\(addingColumn\.x/);
  // Rendered after the table rather than inside the header cell, or the fixed
  // position would still be measured inside something that clips.
  assert.ok(
    table.indexOf('className="collection-type-menu"') > table.indexOf('</table>'),
    'the menu is drawn outside the scroller',
  );
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
  // In the row of six at the top of the menu now, rather than in a "Nesting"
  // section of its own: the same two commands were offered twice under two
  // names, which is the menu disagreeing with itself.
  assert.match(menu, /command: indentBlockSubtree/);
  assert.match(menu, /command: outdentBlockSubtree/);
  assert.match(menu, /aria-label=\{t\(action\.label\)\}/, 'and each says what it does');
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
  // Read from the rule rather than from a byte window: the window version broke
  // the moment a comment above it grew, which is a test measuring the wrong
  // thing.
  const gutter = css.slice(css.indexOf('.block-gutter {'));
  assert.match(gutter.slice(0, gutter.indexOf('}')), /background: color-mix/);
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

test('full width is a centring, corrected for the left-only padding', () => {
  // The reading column is centred in the page, so the breakout has to be a
  // centring too. Replacing that with a fixed offset forgot the centring and
  // pushed the block to the right — and the half-indent is the gap that was
  // left on one side and not the other, since the editor pads only the left.
  // The *block's* rule specifically: a page can carry `data-width` now too, and
  // the two mean different things — a block breaking out of the column, and a
  // page having no column to break out of.
  const rule = css.slice(css.indexOf(".ProseMirror [data-width='full'] {"));
  assert.match(rule.slice(0, 400), /50% - 50cqw - var\(--sone-text-indent\) \/ 2/);
  assert.match(rule.slice(0, 400), /50% - 50cqw \+ var\(--sone-text-indent\) \/ 2/);
});

test('nothing frames a block that runs to both edges', () => {
  // A rounded corner or a border tells you where a thing ends. A block reaching
  // both edges has no ends to mark, and the frame reads as a mistake.
  // The list has grown — an image, a viewer, a player, an embedded frame, a
  // table — so the span allows for it rather than assuming one selector.
  assert.match(css, /\[data-width='full'\] img[\s\S]{0,700}border-radius: 0/);
  assert.match(css, /\[data-width='full'\] \.video-player/);
  assert.match(css, /\[data-width='full'\]\.collection-block/);
});

test('the icon picker scrolls in one direction only', () => {
  // Eight fixed columns cannot be narrower than their contents, so the grid
  // overflowed and scrolled sideways as well as down — two directions to search
  // in, when the list only goes one way.
  assert.match(css, /\.entry-icon-grid[^}]*grid-template-columns: repeat\(auto-fill/);
  assert.match(css, /\.entry-icon-grid[^}]*overflow-x: hidden/);
});

test('the colour swatches land in whole rows', () => {
  // Ten of them, in two rows of five. Ten in a line fit only if each is small
  // enough to be an awkward target, and this menu is a sidebar's width.
  assert.match(css, /\.block-menu-swatches[^}]*grid-template-columns: repeat\(5/);
});

test('the gutter gets out of the way of its own menu', () => {
  // The menu sits above it by z-index already, and on a tablet the handle was
  // still drawn over the panel — a control floating on top of the thing it
  // opened, and one that swallows the tap meant for the first entry.
  assert.match(css, /\.block-gutter:has\(\.block-handle\[aria-expanded='true'\]\)[^}]*z-index: 1/);
});

test('a full-width block draws its selection inside itself', () => {
  // The outline sits 2px outside the box, which is right inside the column and
  // wrong at full width: the box is exactly the page, so a 2px offset plus a 2px
  // line hangs four pixels over the edge. That is what "the width goes a bit past
  // the page" was — the frame rather than the block, and `.main` clipping it is
  // why nothing scrolled and it only looked wrong.
  assert.match(
    css,
    /\[data-width='full'\]\.ProseMirror-selectednode[\s\S]{0,200}outline-offset: -2px/,
  );
  // The table's scroller loses its side borders too, for the same two pixels.
  assert.match(css, /\[data-width='full'\] \.collection-scroll/);
});

test('motion is transform and opacity, and nothing that lays the page out', () => {
  // Those two are the only properties a browser animates without recomputing
  // layout (ADR-0042). A height animation on a tree branch is where a stutter
  // would come from, so the branch fades and rises instead.
  assert.match(css, /--motion-press: 90ms/);
  assert.match(css, /@keyframes sone-rise \{[^@]*transform: translateY\(-2px\)/s);
  assert.doesNotMatch(css, /@keyframes sone-rise \{[^@]*height/s);
  // A press is felt: scale while held, and nothing else.
  assert.match(css, /:active \{ transform: scale\(0\.97\); \}/);
  // Off, not shortened, for somebody who asked for less.
  assert.match(
    css,
    /prefers-reduced-motion: reduce\)[^}]*\{[\s\S]{0,300}?transform: none[\s\S]{0,200}?animation: none/,
  );
});

test('the bar at the top has no line until there is something above', () => {
  assert.match(css, /\.topbar \{[^}]*border-block-end: 1px solid transparent/s);
  assert.match(css, /\.main\[data-scrolled='true'\] \.topbar/);
  const app = codeOf(new URL('../src/App.tsx', import.meta.url));
  assert.match(app, /data-scrolled=\{scrolled \? 'true' : undefined\}/);
});

test('both panel toggles are the same shape, mirrored', () => {
  // A chevron means "go", and that one was the only chevron in the interface
  // that did not.
  const icons = codeOf(new URL('../src/components/icons.tsx', import.meta.url));
  assert.match(icons, /export function PanelRightIcon/);
  const panel = codeOf(new URL('../src/components/RightSidebar.tsx', import.meta.url));
  assert.match(panel, /<PanelRightIcon \/>\s*<\/button>/);
});

test('both toggles are rounded like every other button', () => {
  // They set their own size and padding and so did not inherit `.btn`'s radius —
  // which made the two most-hovered controls in the header the only square ones.
  assert.match(css, /\.sidebar-toggle,\s*\n\.panel-toggle \{[^}]*border-radius: var\(--sone-radius\)/s);
  // And the chevron's rotation went with the chevron: a panel icon has a side
  // already, so turning it would say the panel had moved.
  assert.doesNotMatch(css, /\.panel-toggle\[aria-expanded='true'\] svg \{ transform: rotate/);
});

test('a block wears the same mark in both menus', () => {
  // The / menu had a table of marks and the gutter's "Turn into" list had none,
  // so the same ten blocks were pictures in one place and a wall of words in the
  // other. One table now, shared.
  const marks = codeOf(new URL('../src/components/blockMarks.ts', import.meta.url));
  const slash = codeOf(new URL('../src/components/SlashMenu.tsx', import.meta.url));
  const menu = codeOf(new URL('../src/components/BlockMenu.tsx', import.meta.url));
  assert.match(slash, /const MARKS = BLOCK_MARKS;/);
  assert.match(menu, /BLOCK_MARKS\[name\]/);
  // The gutter offers a heading at any level, which the / menu's three ids do
  // not cover — so the shared table carries the bare name too.
  assert.match(marks, /^ {2}heading: HashIcon,/m);
});

test('alignment is four icons, and a row of choices wraps', () => {
  // Four German words in a row overflowed the menu and gave the whole thing a
  // horizontal scrollbar — including the list of block types, which fitted.
  const menu = codeOf(new URL('../src/components/BlockMenu.tsx', import.meta.url));
  assert.match(menu, /Mark: AlignAutoIcon/);
  assert.match(menu, /<choice\.Mark \/>/);
  // The name survives as the title and the label: an icon nobody has met is a
  // guess.
  assert.match(menu, /aria-label=\{t\(choice\.label\)\}/);
  assert.match(css, /\.block-menu-choices \{[^}]*flex-wrap: wrap/s);
});

test('the six block actions are one row, and each keeps its name', () => {
  // Six full-width rows of text were most of the menu's height before anything
  // about the block appeared. Folding them costs nothing only if the word
  // survives where a person can still reach it.
  const menu = codeOf(new URL('../src/components/BlockMenu.tsx', import.meta.url));
  assert.match(menu, /className="block-menu-actions"/);
  assert.match(menu, /title=\{t\(action\.label\)\}/);
  assert.match(menu, /aria-label=\{t\(action\.label\)\}/);
  assert.match(css, /\.block-menu-actions \{[^}]*display: flex/s);

  // And the duplicate "Nesting" section is gone.
  assert.doesNotMatch(menu, /← Out/);
});

test('one rule per class in the block menu', () => {
  // There were two `.block-menu-item` rules three and a half thousand lines
  // apart with different padding — the seventh time this week. This is the
  // assertion that keeps catching it.
  assert.equal([...css.matchAll(/^\.block-menu-item \{/gm)].length, 1);
  assert.equal([...css.matchAll(/^\.block-menu-actions \{/gm)].length, 1);
});

test('a page can ask for the whole width, and says so in its document', () => {
  // The measure stays the default — eighty characters is where reading gets
  // hard — and this is for the pages that are not prose.
  assert.match(css, /\.page-body\[data-width='full'\] \{ max-width: none; \}/);
  const view = codeOf(new URL('../src/components/PageView.tsx', import.meta.url));
  assert.match(view, /data-width=\{width\}/);
  // Read from the document, so it arrives like any other edit rather than by a
  // refetch: widening it on a laptop widens it on the tablet beside it.
  const hook = codeOf(new URL('../src/hooks/usePageWidth.ts', import.meta.url));
  assert.match(hook, /page\.observe\(read\)/);
  assert.match(hook, /page\.unobserve\(read\)/);
  // Anything the stylesheet does not know is the default rather than an error.
  assert.match(hook, /value === 'full' \? 'full' : 'column'/);
});

test('a canvas writes a stroke once, when the pen lifts', () => {
  // Sixty updates a second per stroke is a log that grows forever and a document
  // carrying the history of somebody's wrist (ADR-0043). The stroke in progress
  // is local state; only the finished one is written.
  const canvas = codeOf(new URL('../src/components/CanvasSurface.tsx', import.meta.url));
  const move = canvas.slice(canvas.indexOf('const onSurfaceMove'), canvas.indexOf('const onSurfaceUp'));
  assert.doesNotMatch(move, /addItem/, 'nothing is written while drawing');
  assert.match(move, /setDrawing/);

  // The stroke's own write, past the shape's — both live in the pointer-up
  // handler now, and only one of them is the pen's.
  const up = canvas.slice(canvas.indexOf('const onSurfaceUp'));
  assert.match(up, /addItem\(doc, \{[\s\S]{0,200}kind: 'path'/);
});

test('a canvas is a page, not a screen of its own', () => {
  // It gets the tree, the trash, permissions, sharing and moving by being a
  // page. Only what is under the heading changes.
  const view = codeOf(new URL('../src/components/PageView.tsx', import.meta.url));
  assert.match(view, /isCanvas \? \(\s*<CanvasSurface/);
  assert.match(view, /useEntryKind\(handle\?\.doc \?\? null\) === 'canvas'/);
});

test('a canvas is told apart in the tree, not only on opening it', () => {
  // A list where a drawing and a document look the same is a list you have to
  // click to read.
  const icon = codeOf(new URL('../src/components/EntryIconView.tsx', import.meta.url));
  // A brush, not the pen: the pen is the tool *on* a board, and the board wants
  // a mark of its own — otherwise the thing and the instrument for using it are
  // the same picture.
  assert.match(icon, /kind === 'canvas'\) return <BrushIcon \/>/);
  // And the tree passes the entry's own kind rather than "folder or else page",
  // which is why every board was drawn as a document.
  const sidebar = codeOf(new URL('../src/components/Sidebar.tsx', import.meta.url));
  assert.match(sidebar, /<EntryIconView icon=\{node\.icon\} kind=\{node\.kind\}/);
  assert.match(icon, /'page' \| 'folder' \| 'row' \| 'canvas'/);
});

test('a picture on a canvas is the workspace\u2019s file, not a copy', () => {
  // The same upload every other file uses, served by the same route and counted
  // in the same storage (ADR-0029). A canvas with its own picture store would be
  // a second place for a backup to miss.
  const canvas = codeOf(new URL('../src/components/CanvasSurface.tsx', import.meta.url));
  assert.match(canvas, /api\.uploadFile\(pageId, file\)/);
  assert.match(canvas, /kind: uploaded\.category === 'image' \? 'image' : 'text'/);
  assert.match(canvas, /src=\{`\/api\/files\/\$\{item\.fileId\}`\}/);
});

test('resizing is a corner on the selected item, and it is one write', () => {
  const canvas = codeOf(new URL('../src/components/CanvasSurface.tsx', import.meta.url));
  assert.match(canvas, /selected === item\.id && \(\s*<span\s*className="canvas-size"/s);
  assert.match(canvas, /resizeItem\(doc, size\.id/);
  // The ink is the person's, not the document's: the colour somebody draws in is
  // theirs, and the stroke keeps it once drawn.
  assert.match(canvas, /const \[ink, setInk\]/);
  assert.match(canvas, /colour: ink\.colour,\s*\n\s*width: ink\.width,/);
});

test('the pointer is divided by the zoom, everywhere', () => {
  // The classic canvas bug: things land where you clicked at 100% and nowhere
  // near it at any other size. One division, in one place, because the plane is
  // scaled from its own origin and panning stays the scroller's job.
  const canvas = codeOf(new URL('../src/components/CanvasSurface.tsx', import.meta.url));
  const reader = canvas.slice(canvas.indexOf('const at = useCallback'), canvas.indexOf('const onSurfaceDown'));
  // The pan first, then the zoom — the plane is translated and then scaled from
  // its own origin, so undoing it is subtracting and then dividing.
  assert.match(reader, /- pan\.x\) \/ zoom,/);
  assert.equal([...reader.matchAll(/\/ zoom/g)].length, 2, 'both axes, and only there');
  assert.match(canvas, /translate\(\$\{pan\.x\}px, \$\{pan\.y\}px\) scale\(\$\{zoom\}\)/);
  assert.match(canvas, /transformOrigin: '0 0'/);
});

test('a band catches what it touches, and the eraser takes the topmost', () => {
  const canvas = codeOf(new URL('../src/components/CanvasSurface.tsx', import.meta.url));
  // Touching rather than enclosing: a stroke that starts outside the band is
  // still one somebody meant to catch.
  assert.match(canvas, /function overlaps\(/);
  assert.match(canvas, /items\.filter\(\(item\) => overlaps\(item, band\)\)/);
  // Topmost first, which is the order the eye uses.
  // Topmost first, and never something somebody has pinned down.
  assert.match(
    canvas,
    /\[\.\.\.items\]\.reverse\(\)\.find\(\(item\) => within\(item, point\) && !item\.locked\)/,
  );
  // A stroke has no width and height of its own, so its box is measured.
  assert.match(canvas, /function boxOf\(/);
});

test('a caught group drags as one, by a delta', () => {
  // The offset belongs to the item under the finger; the others have their own.
  // A delta is also what lets two people drag two overlapping groups without
  // arguing about where the shared item is.
  const canvas = codeOf(new URL('../src/components/CanvasSurface.tsx', import.meta.url));
  assert.match(canvas, /const ids = chosen\.has\(item\.id\) \? \[\.\.\.chosen\] : \[item\.id\]/);
  assert.match(canvas, /moveItems\(doc, drag\.ids, point\.x - drag\.last\.x/);
  const core = codeOf(new URL('../../core/src/doc/canvas.ts', import.meta.url));
  assert.match(core, /export function moveItems/);
  assert.match(core, /doc\.transact\(\(\) => \{[\s\S]{0,400}?CANVAS_KEYS\.y, asNumber/);
});

test('panning is reading, so it works without edit rights', () => {
  // Moving the view is not writing, and a board somebody may only read is still
  // a board they have to get around.
  const canvas = codeOf(new URL('../src/components/CanvasSurface.tsx', import.meta.url));
  const down = canvas.slice(canvas.indexOf('const onSurfaceDown'), canvas.indexOf('const onSurfaceMove'));
  assert.ok(
    down.indexOf('panning.current =') < down.indexOf('if (!canEdit) return;'),
    'the pan is set up before the edit check',
  );
  // Space, but not while typing in a note: it is a word separator first.
  assert.match(canvas, /event\.target instanceof HTMLTextAreaElement/);
});

test('a canvas can be started where anything else can', () => {
  // It was reachable only through a *folder's* ⋮ menu, so somebody with no
  // folders — or somebody looking at a page — could not find one at all. A thing
  // you can create has to be offered where creating happens.
  const sidebar = codeOf(new URL('../src/components/Sidebar.tsx', import.meta.url));
  const folder = codeOf(new URL('../src/components/FolderView.tsx', import.meta.url));
  const menu = codeOf(new URL('../src/components/EntryMenu.tsx', import.meta.url));

  // Not at the root: the root holds only folders (ADR-0019), and the server
  // refuses a canvas there — offering something that cannot work is worse than
  // not offering it.
  assert.doesNotMatch(sidebar, /onCreatePage\(null, 'canvas'\)/);
  assert.match(sidebar, /<AddEntryMenu/, 'behind the + on a folder');
  assert.match(folder, /onCreate\(folder\.id, 'canvas'\)/, 'inside a folder being looked at');
  // In the ⋮ menu the kind comes from the list rather than being written three
  // times, so this reads the list.
  assert.match(menu, /onCreate\(node\.id, kind\)/, 'and in the ⋮ menu');
  assert.match(menu, /\['canvas', 'canvas\.new', BrushIcon\]/);
  // The three marks are the ones the tree draws these with: a `+` and a
  // folder-with-a-plus were marks for *adding*, which the row already says.
  assert.match(menu, /\['page', 'entry\.newPage', PageIcon\]/);
  assert.match(menu, /\['folder', 'entry\.newFolder', FolderIcon\]/);

  // The order is how often each is wanted, in both menus: page, canvas, folder.
  const add = codeOf(new URL('../src/components/AddEntryMenu.tsx', import.meta.url));
  assert.ok(add.indexOf("'page'") < add.indexOf("'canvas'"));
  assert.ok(add.indexOf("'canvas'") < add.indexOf("'folder'"));
  // In the ⋮ menu the three are a row of marks under one word now, declared as a
  // list — so the order is the list's rather than the markup's.
  const creates = menu.slice(menu.indexOf('entry-menu-new'));
  assert.ok(creates.indexOf("'page'") < creates.indexOf("'canvas'"));
  assert.ok(creates.indexOf("'canvas'") < creates.indexOf("'folder'"));
});

test('the entry menu is a row of marks and a short list, not twelve rows', () => {
  // Five full-width rows of text — rename, favourite, share, up, down — were
  // most of the menu's height before anything about the entry appeared. Each is
  // a verb with an obvious picture, and the word survives as the tooltip.
  const menu = codeOf(new URL('../src/components/EntryMenu.tsx', import.meta.url));
  assert.match(menu, /className="entry-menu-actions"/);
  assert.match(menu, /title=\{t\('entry\.rename'\)\}/);
  assert.match(menu, /aria-label=\{isFavourite \? t\('entry\.unfavourite'\) : t\('entry\.favourite'\)\}/);
  // The favourite is a checkbox rather than a plain item: it has a state, and a
  // menu item that toggles without saying so is one people press twice.
  assert.match(menu, /role="menuitemcheckbox"\s*\n\s*aria-checked=\{isFavourite\}/);

  // Wider, which is what makes five marks fit — and the width is bought back
  // several times over in height.
  assert.match(css, /\.entry-menu \{[\s\S]{0,600}?inline-size: 232px/);
});

test('the board is endless and has no scrollbars', () => {
  // A scroller needs the plane to have ends, and ends are both a wall somebody
  // eventually hits and two bars reporting a position along a nothing.
  const canvas = codeOf(new URL('../src/components/CanvasSurface.tsx', import.meta.url));
  assert.match(css, /\.canvas-surface \{[^}]*overflow: hidden/s);
  assert.doesNotMatch(canvas, /scrollLeft|scrollTop/, 'nothing reads a scroll position');

  // The wheel moves it and the wheel with a modifier changes how far in, which
  // is what every drawing tool does.
  assert.match(canvas, /const onWheel =/);
  assert.match(canvas, /setPan\(\(current\) => \(\{ x: current\.x - event\.deltaX/);
  // Zooming keeps the point under the pointer still: anchoring to the corner
  // makes zooming feel like the board running away.
  assert.match(canvas, /px - \(\(px - current\.x\) \/ zoom\) \* next/);

  // And the one control that resets, resets both — without scrollbars there is
  // nothing else to say how far somebody has wandered.
  assert.match(canvas, /setZoom\(1\);\s*\n\s*setPan\(\{ x: 0, y: 0 \}\)/);
});

test('a canvas page fills what the topbar leaves', () => {
  // The reading column's 40vh of bottom padding is exactly wrong under a surface
  // that is supposed to be endless.
  assert.match(css, /\.page-body\[data-kind='canvas'\][^}]*padding-block-end: 0/s);
  assert.match(css, /\.page-body\[data-kind='canvas'\][^}]*flex: 1 1 auto/s);
  const view = codeOf(new URL('../src/components/PageView.tsx', import.meta.url));
  assert.match(view, /data-kind=\{isCanvas \? 'canvas' : undefined\}/);
});

test('the plane is a point, so nothing lands off the board', () => {
  // It briefly had a size, which needs a middle — so I shifted it with a
  // negative margin, and an absolutely positioned child is placed against *that*
  // edge. Everything landed eight thousand pixels away: nothing could be drawn
  // and nothing appeared. With no size there is no middle to get wrong.
  assert.match(css, /\.canvas-plane \{[^}]*inline-size: 0;[^}]*block-size: 0;/s);
  assert.doesNotMatch(css, /\.canvas-plane \{[^}]*margin: -/s);

  // The ink layer needs a box, since an SVG cannot be a point — centred on the
  // origin with a viewBox to match, so negative coordinates are on the board.
  const canvas = codeOf(new URL('../src/components/CanvasSurface.tsx', import.meta.url));
  assert.match(canvas, /viewBox="-10000 -10000 20000 20000"/);
  assert.match(css, /\.canvas-ink \{[^}]*inset-inline-start: -10000px/s);
});

test('a note placed with the text tool is ready to type in', () => {
  // Clicking it afterwards is two actions for one intention, and the second is
  // not obvious.
  const canvas = codeOf(new URL('../src/components/CanvasSurface.tsx', import.meta.url));
  assert.match(canvas, /setTyping\(id\)/);
  assert.match(canvas, /if \(field && typing === item\.id\) \{\s*\n\s*field\.focus\(\)/);
});

test('a shape is dragged out, and a tap makes nothing', () => {
  // The same gesture as the band, which needs no second idea. A shape with no
  // size is one nobody can grab to give it one.
  const canvas = codeOf(new URL('../src/components/CanvasSurface.tsx', import.meta.url));
  assert.match(canvas, /if \(box\.w > 4 \|\| box\.h > 4\)/);
  // A line keeps the corners it was drawn between rather than a box, so dragging
  // up-left draws up-left instead of flipping.
  assert.match(canvas, /tool === 'line'\s*\n\s*\? \{ x: drawn\.from\.x, y: drawn\.from\.y/);
  // A drawn thing gets its own SVG at its own box, so the whole board is one
  // stack in one order — ink under everything meant "bring to front" could not
  // cross the layer boundary.
  assert.match(canvas, /className="canvas-drawn"/);
  assert.match(css, /\.canvas-drawn \{[^}]*position: absolute/s);
});

test('a picture can be inserted from a button, not only dropped', () => {
  // The drop was the only way in, which is a way nobody finds who has not been
  // told — and both paths share one upload, so "insert a picture" means one
  // thing however somebody arrived at it.
  const canvas = codeOf(new URL('../src/components/CanvasSurface.tsx', import.meta.url));
  assert.match(canvas, /const pickImage = \(\): void =>/);
  assert.match(canvas, /const place = async \(file: File/);
  assert.equal([...canvas.matchAll(/api\.uploadFile\(/g)].length, 1, 'one upload, two ways to it');
});

test('the board can be dotted, squared, lined or plain', () => {
  assert.match(css, /\[data-ruling='squares'\][^}]*linear-gradient\(to right/s);
  assert.match(css, /\[data-ruling='lines'\][^}]*linear-gradient\(to bottom/s);
  // Plain is no image at all rather than a white one, which would hide the
  // theme's own surface.
  assert.match(css, /\[data-ruling='plain'\] \{ background-image: none; \}/);
});

test('the first swatch is the mark the entry already wears', () => {
  // The swatch that means "no icon of its own" has to show what that default
  // *is*, and for a canvas that is the brush. It read `folder or else page`,
  // which is the same narrowing the tree had — so the one swatch whose job is to
  // show the default showed the wrong one.
  const menu = codeOf(new URL('../src/components/EntryMenu.tsx', import.meta.url));
  assert.match(menu, /<EntryIconView icon=\{null\} kind=\{node\.kind\} \/>/);
  assert.doesNotMatch(menu, /kind=\{node\.kind === 'folder' \? 'folder' : 'page'\}/);

  // Both places that draw an entry's own mark now pass the kind through, which
  // is the assertion that catches the next kind as well as this one.
  const sidebar = codeOf(new URL('../src/components/Sidebar.tsx', import.meta.url));
  assert.match(sidebar, /kind=\{node\.kind\}/);
});

test('the canvas tools are marks, and each still says what it is', () => {
  // Seven labels in a row is most of the bar, and each of these is the thing it
  // makes — a rectangle is a rectangle — which is the condition for dropping the
  // word.
  const canvas = codeOf(new URL('../src/components/CanvasSurface.tsx', import.meta.url));
  assert.match(canvas, /\['rect', RectangleIcon\]/);
  assert.match(canvas, /\['erase', EraserIcon\]/);
  assert.match(canvas, /title=\{t\(`canvas\.tool\.\$\{id\}`/);
  assert.match(canvas, /aria-label=\{t\(`canvas\.tool\.\$\{id\}`/);
});

test('a line is visible while it is being drawn', () => {
  // It had no preview at all: the box preview was suppressed for a line and
  // nothing took its place, so it appeared only once the pointer was released.
  // Drawing something you cannot see until you commit to it is drawing blind.
  const canvas = codeOf(new URL('../src/components/CanvasSurface.tsx', import.meta.url));
  assert.match(canvas, /shape && shaping\.current && tool === 'line'/);
  assert.doesNotMatch(canvas, /shape && tool !== 'line'/);
  // And each preview is drawn the way the finished thing will be, so the result
  // is not a surprise.
  assert.match(canvas, /shape && tool === 'ellipse'/);
  assert.match(canvas, /shape && tool === 'rect'/);
});

test('a picture can be dragged rather than copied', () => {
  // The browser drags a picture by default, and its own drag started before the
  // pointer handler could claim the gesture — so every attempt to move one
  // turned into a copy.
  const canvas = codeOf(new URL('../src/components/CanvasSurface.tsx', import.meta.url));
  assert.match(canvas, /draggable=\{false\}/);
  assert.match(canvas, /onDragStart=\{\(event\) => event\.preventDefault\(\)\}/);
});

test('a stroke or a shape can be picked up, and moves without being rewritten', () => {
  const canvas = codeOf(new URL('../src/components/CanvasSurface.tsx', import.meta.url));
  // They are drawn in the ink layer, so nothing catches the press for them —
  // the surface hit-tests instead, topmost first.
  assert.match(canvas, /item\.kind !== 'text' && item\.kind !== 'image' && within\(item, point\)/);
  // And a stroke is translated by its item rather than having its points
  // rewritten: the points are where the pen went, and moving something should
  // not rewrite the record of how it was drawn.
  assert.match(canvas, /transform=\{`translate\(\$\{item\.x\} \$\{item\.y\}\)`\}/);
});

test('the handle carries the four things done to a thing that exists', () => {
  // Copy it, pin it down, put it in front, remove it. Moving is not among them
  // because moving is dragging — a button that says "move" and then waits for a
  // drag explains a gesture instead of being one.
  const canvas = codeOf(new URL('../src/components/CanvasSurface.tsx', import.meta.url));
  assert.match(canvas, /duplicateItem\(doc, selectedItem\.id, newId\(\)\)/);
  assert.match(canvas, /lockItem\(doc, selectedItem\.id, !selectedItem\.locked\)/);
  assert.match(canvas, /bringToFront\(doc, selectedItem\.id\)/);
  // At its own size whatever the zoom: a control that shrinks with the board is
  // unusable at the size somebody zooms out to in order to see all of it.
  assert.match(canvas, /transform: `scale\(\$\{1 \/ zoom\}\)`/);
});

test('the pen draws in the workspace palette, and in anything else', () => {
  // Five hex values invented here matched nothing: a board sat inside a
  // workspace whose tags, columns and folder icons used a palette somebody had
  // chosen (ADR-0030).
  const canvas = codeOf(new URL('../src/components/CanvasSurface.tsx', import.meta.url));
  assert.match(canvas, /\['currentColor', \.\.\.THEME_COLORS\]/);
  assert.match(canvas, /colorValue\(name\)/);
  assert.doesNotMatch(canvas, /'#c0392b'/, 'no colours invented here');
  // And any colour at all, for the one a palette of eight does not contain.
  assert.match(canvas, /type="color"/);
});

test('a guest appears by name, marked as a guest', () => {
  // The name is what they chose to be called; "guest" is what the page can vouch
  // for, so both are shown rather than one standing in for the other.
  const people = codeOf(new URL('../src/components/Contributors.tsx', import.meta.url));
  assert.match(people, /isGuestKey\(userId\)/);
  assert.match(people, /name: guestName\(userId\), known: true, guest: true/);
  assert.match(people, /person\.guest && <span className="contributor-guest">/);
});

test('the + menu is the same panel as the ⋮ menu', () => {
  // It opened rightward, out of the sidebar and under the content area — which
  // is a stacking context, so it painted over the menu. The ⋮ menu never had
  // that problem because it opens leftward and stays over the sidebar. Two
  // popups a row apart should not differ in width, alignment or direction.
  const add = codeOf(new URL('../src/components/AddEntryMenu.tsx', import.meta.url));
  assert.match(add, /className="entry-menu tree-add-menu"/);
  // Which means it inherits the width and the leftward alignment rather than
  // declaring its own.
  assert.doesNotMatch(css, /\.tree-add-menu \{[^}]*inline-size/s);
  assert.doesNotMatch(css, /\.tree-add-menu \{[^}]*inset-inline-start/s);
});

test('a read-only link does not ask for a name', () => {
  // The name is asked for so other people can see who is editing, which makes it
  // pointless on a link that only reads — and on a page shared with strangers it
  // is a question somebody may not want to answer.
  const app = codeOf(new URL('../src/App.tsx', import.meta.url));
  assert.match(app, /info\.requiresPassword \|\| info\.role !== 'viewer'/);
  assert.match(app, /if \(!joined && canWrite === true\)/);
  // And the form is not shown before the answer is known: showing it and then
  // removing it is worse than a moment's wait.
  assert.match(app, /if \(canWrite === null && !joined\)/);
});

test('the handle keeps its press to itself', () => {
  // It bubbled to the surface, which clears the selection on a press against the
  // empty plane — so the handle unmounted between `pointerdown` and `click`, and
  // the click landed on nothing. The buttons looked dead; they were never
  // reached.
  const canvas = codeOf(new URL('../src/components/CanvasSurface.tsx', import.meta.url));
  const handle = canvas.slice(canvas.indexOf('className="canvas-handle"'));
  assert.match(
    handle.slice(0, 900),
    /onPointerDown=\{\(event\) => event\.stopPropagation\(\)\}/,
  );
});

test('both row menus hang off the row, not off their own buttons', () => {
  // The ⋮ sits at the row's right end, so anchoring to it and anchoring to the
  // row are the same thing. The `+` sits further left, and the same rule sent
  // its menu off the sidebar's other edge — "the same as the ⋮ menu" meant the
  // row all along.
  assert.match(css, /\.tree-row \{[^}]*position: relative/s);
  assert.match(css, /\.tree-add-wrap \{ display: inline-flex; \}/);
  // And the row declares that once: the drop indicator used to set it too.
  assert.doesNotMatch(css, /\.tree-row\[data-drop='before'\],\s*\n\.tree-row\[data-drop='after'\] \{\s*\n\s*position: relative/);
});

test('the board is one stack, so bringing to front works for anything', () => {
  // It was two layers — every stroke in one SVG underneath, every note and
  // picture above — so ink could never be in front of a note however anybody
  // ordered it, and "bring to front" moved an item within a layer it could not
  // leave.
  const canvas = codeOf(new URL('../src/components/CanvasSurface.tsx', import.meta.url));
  // One map over every item, not one per kind.
  assert.match(canvas, /\{items\.map\(\(item\) => \{/);
  assert.doesNotMatch(canvas, /items\s*\n?\s*\.filter\(\(item\) => item\.kind === 'path'/);

  // And with a drawing tool in hand nothing on the board catches the press: a
  // stroke begun over a note went to the note instead of the surface.
  assert.match(canvas, /data-drawing=\{tool !== 'select' \? 'true' : undefined\}/);
  assert.match(css, /\.canvas-plane\[data-drawing='true'\] \.canvas-item \{ pointer-events: none; \}/);
});

test('a stroke that has been moved is where it looks', () => {
  // `boxOf` measured the points and forgot the item's position, so a hit test
  // missed every stroke anybody had dragged — and the handle hung where the
  // stroke used to be.
  const canvas = codeOf(new URL('../src/components/CanvasSurface.tsx', import.meta.url));
  assert.match(canvas, /x: minX \+ item\.x, y: minY \+ item\.y/);
});

test('a picture on a board is in the page’s own list of pictures', () => {
  // The panel walked the block tree and a canvas has no blocks — so a picture
  // placed on a board was uploaded to the page, counted against the page's
  // storage, and then missing from the page's own list of what it holds.
  const assets = codeOf(new URL('../src/hooks/useDocAssets.ts', import.meta.url));
  assert.match(assets, /for \(const item of readCanvas\(doc\)\)/);
  assert.match(assets, /item\.kind !== 'image' \|\| !item\.fileId/);
  assert.match(assets, /onCanvas: true/);

  // It has no block to scroll to, so pressing it opens the file rather than
  // pretending to find it on the page.
  const panel = codeOf(new URL('../src/components/RightSidebar.tsx', import.meta.url));
  assert.match(panel, /if \(image\.onCanvas\) \{\s*\n\s*window\.open/);
});

test('an entry’s kind is narrowed in one place, not at five call sites', () => {
  // `kind === 'folder' ? 'folder' : 'page'` was written out at each call site,
  // which is how a canvas came to be drawn as a document in the tree, then in
  // the icon picker, then on its own heading — three reports for one line of
  // code repeated.
  const icon = codeOf(new URL('../src/components/EntryIconView.tsx', import.meta.url));
  assert.match(icon, /export function entryKind\(/);

  for (const file of ['Search.tsx', 'FolderView.tsx', 'PageView.tsx']) {
    const source = codeOf(new URL(`../src/components/${file}`, import.meta.url));
    assert.doesNotMatch(
      source,
      /kind === 'folder' \? 'folder' : 'page'/,
      `${file} no longer guesses`,
    );
  }
  const view = codeOf(new URL('../src/components/PageView.tsx', import.meta.url));
  assert.match(view, /kind=\{isCanvas \? 'canvas' : 'page'\}/);
});

test('a folder shows everything in it, not everything named page', () => {
  // A canvas is neither a folder nor a 'page', so it appeared in neither list —
  // a folder holding one showed it as missing.
  const folder = codeOf(new URL('../src/components/FolderView.tsx', import.meta.url));
  assert.match(folder, /children\.filter\(\(child\) => child\.kind !== 'folder'\)/);
});

test('a swatch is round on a narrow screen', () => {
  // A flex child shrinks before the row wraps, and on a phone the toolbar is
  // narrower than its contents — so the colours became ovals.
  assert.match(css, /\.canvas-ink-choice \{[^}]*flex: none;[^}]*aspect-ratio: 1/s);
  assert.match(css, /\.canvas-ink-custom \{[^}]*flex: none/s);
  // And the row wraps rather than squeezing: a row that cannot fit and will not
  // wrap deforms whatever is most compressible.
  assert.match(css, /\.canvas-tools \{[^}]*flex-wrap: wrap/s);
});

test('the board can be moved with a finger', () => {
  // Panning was the middle button or a held space, and a phone has neither — so
  // on the device most likely to be drawn on there was no way to move the board.
  const canvas = codeOf(new URL('../src/components/CanvasSurface.tsx', import.meta.url));
  assert.match(canvas, /\['hand', HandIcon\]/);
  assert.match(canvas, /event\.button === 1 \|\| space \|\| tool === 'hand'/);
  // And the cursor says so before the button goes down.
  assert.match(canvas, /data-tool=\{space \|\| tool === 'hand' \? 'pan' : tool\}/);
});

test('the entry menu is ordered by how often and how permanent', () => {
  // Frequent and reversible at the top, rare and consequential at the bottom.
  // The appearance block — a search field, thirty-odd icons, two rows of
  // colours — was in the middle, where anything that big pushes what is below it
  // out of reach: on a phone the trash needed scrolling past the icon grid.
  const menu = codeOf(new URL('../src/components/EntryMenu.tsx', import.meta.url));
  const at = (needle: string): number => menu.indexOf(needle);

  assert.ok(at('entry-menu-actions') < at('entry-menu-new'), 'what it does, then what it makes');
  assert.ok(at('entry-menu-new') < at("t('entry.move')"), 'then where it goes');
  assert.ok(at("t('entry.move')") < at('<EntryAppearance'), 'then how it looks');
  assert.ok(at('<EntryAppearance') < at('entry-menu-item destructive'), 'the trash last');

  // Two lines, not three: the band of controls at the head separates itself by
  // sitting on its own surface, so the rules only fall between the list groups.
  assert.match(menu, /className="entry-menu-band"/);
  assert.match(css, /\.entry-menu-band \{[^}]*background: var\(--surface-sunken\)/s);
  assert.equal([...menu.matchAll(/entry-menu-rule/g)].length, 2);
  // Both move rows are one line tall, so a pair of related choices does not look
  // like two unrelated ones.
  assert.match(css, /\.entry-menu-item \{[^}]*white-space: nowrap/s);
  // "Only a folder offers 'new inside this'" used to be asserted here, as the
  // source reading `{isFolder && (`. It broke when the condition gained a
  // second term and the rule it protected had not changed — which is what a
  // test of *where a condition is written* is worth (ADR-0091). It is asked of
  // the rendered menu in `entryRights.test.tsx` now (ADR-0095).
  // And no colour: colour here means a palette choice or danger, and emphasis
  // with no meaning behind it is how a palette stops meaning anything.
  assert.doesNotMatch(css, /\.entry-menu-band \{[^}]*var\(--accent\)/s);
});

test('one boundary, one line', () => {
  // The appearance block drew its own top border from when it sat in the middle
  // of the menu and nothing else separated groups. With the menu drawing its own
  // boundaries that became a second line a pixel under the first — two rules for
  // one boundary, which is what to look for whenever a divider appears doubled.
  assert.doesNotMatch(css, /\.entry-appearance \{[^}]*border-block-start/s);
});

test('the trash says what it is and how much, not what it does', () => {
  // "Move to the trash, with 2 entries inside" wrapped to two lines on a phone.
  // The count stays — it is what decides whether somebody opens the confirmation
  // at all — and the verb goes, because the mark beside it already says it.
  const en = codeOf(new URL('../src/i18n/messages.en.ts', import.meta.url));
  assert.match(en, /'entry\.delete': 'Trash',/);
  assert.match(en, /'entry\.deleteWithChildren': 'Trash, \{count, plural/);
});

test('a template is offered where a page is started, and only if there are any', () => {
  // A workspace with no templates shows no heading: a feature that advertises
  // its own emptiness teaches people to ignore that part of the menu.
  const add = codeOf(new URL('../src/components/AddEntryMenu.tsx', import.meta.url));
  assert.match(add, /templates\.length > 0 && \(/);
  // After the blank ones, because a blank page is what most presses want.
  assert.ok(add.indexOf("['folder', 'entry.newFolder'") < add.indexOf('template.heading'));
  // Fetched when the menu opens rather than held with the tree: a short list
  // read at the moment of a decision.
  assert.match(add, /if \(!open\) return;[\s\S]{0,200}api\s*\n?\s*\.templates\(workspaceId\)/);
});

test('marking a template is a toggle on the entry itself', () => {
  // Whether this page is a shape to start from is a fact about this page, and
  // it is decided while looking at it (ADR-0045).
  const menu = codeOf(new URL('../src/components/EntryMenu.tsx', import.meta.url));
  assert.match(menu, /role="menuitemcheckbox"\s*\n\s*aria-checked=\{isTemplate\}/);
  assert.match(menu, /setPageTemplate\(node\.id, !isTemplate\)/);
  // "Not offered on a folder: there is no document to copy" moved to
  // `entryRights.test.tsx`, for the same reason as the line above (ADR-0095):
  // it was a test of the source, and it broke on a change that left the rule
  // alone.
});

test('a detached thread keeps its place and its words', () => {
  // Dropping it would mean somebody's objection vanishes when the text they
  // objected to is removed — the case where the objection matters most. So it is
  // its own group, between the open threads and the resolved ones: unfinished
  // business, not a decision.
  const panel = codeOf(new URL('../src/components/CommentsPanel.tsx', import.meta.url));
  assert.ok(
    panel.indexOf("group('comment.open'") < panel.indexOf("group('comment.detachedHeading'"),
  );
  assert.ok(
    panel.indexOf("group('comment.detachedHeading'") <
      panel.indexOf("group('comment.resolvedHeading'"),
  );
  // Marked rather than hidden, and the quotation is not a button when there is
  // nowhere to go.
  // Every one of these gained the item term together: a canvas thread has no
  // range by design, so each place that read `range === null` as "the text is
  // gone" would have said that about every comment on a canvas (ADR-0046).
  assert.match(
    panel,
    /data-detached=\{thread\.item === null && thread\.range === null \? 'true' : undefined\}/,
  );
  // Gained the item term with everything else: a canvas thread has no range by
  // design, so this would have disabled the quotation button on every comment
  // on a canvas (ADR-0046).
  assert.match(panel, /disabled=\{thread\.item === null && thread\.range === null\}/);
  assert.match(css, /\.comment-thread\[data-detached='true'\] \{ border-style: dashed; \}/);
});

test('the page owns the comment list, not the panel', () => {
  // The editor needs the same list to draw its marks, and two readers of one
  // document would disagree about the moment a thread appeared — a mark over the
  // wrong words is the failure this feature exists to avoid.
  const app = codeOf(new URL('../src/App.tsx', import.meta.url));
  assert.match(app, /useComments\(handle\?\.doc \?\? null, session\.user\.id\)/);
  assert.match(app, /comments=\{comments\}/);
  // And the hook watches the document's updates as well as the map: an anchor
  // resolves against the text, so a thread's range moves when the text does even
  // though the thread itself did not change.
  const hook = codeOf(new URL('../src/hooks/useComments.ts', import.meta.url));
  assert.match(hook, /map\.observeDeep\(read\)/);
  assert.match(hook, /doc\.on\('update', read\)/);
});

test('a thread exists once somebody has written something', () => {
  // Pressing Comment holds the anchor and opens the panel; the thread is created
  // on submit. A thread with an empty first message is a highlight over nothing,
  // and it would arrive on somebody else's screen as exactly that (ADR-0046).
  const app = codeOf(new URL('../src/App.tsx', import.meta.url));
  assert.match(app, /setPendingComment\(anchor\);\s*\n\s*setRightOpen\(true\);/);
  const panel = codeOf(new URL('../src/components/CommentsPanel.tsx', import.meta.url));
  /*
   * Through `send`, which calls `startThread` — the one place that decides
   * *which* document a new thread goes into (ADR-0057).
   *
   * It used to match `startThread(draft)` directly. Enter and the button were
   * two copies of the same three lines then, and adding mentions to a comment
   * made that a real bug rather than a duplication: the button cannot see who
   * the composer's `@` picker chose, so it would have sent the sentence without
   * the people named in it (ADR-0085). One function now, called by both.
   *
   * The assertion's subject is unchanged: a thread appears only once something
   * is written.
   */
  assert.match(panel, /startThread\(draft, mentionsInDraft\(draft, picked\)\)/);
  assert.match(panel, /onSend=\{send\}/);
  assert.match(panel, /disabled=\{draft\.trim\(\) === ''\}/);
});

test('the comment button is absent for somebody who may only read', () => {
  /*
   * Absent rather than present and refusing.
   *
   * The condition used to be a spread on the prop — `canEdit ? { onComment }`
   * — inside a block already gated on `canEdit`. The toolbar has since moved
   * out of that block, because a locked page keeps its comments and loses its
   * gutter (ADR-0049), so the rights check is the gate on the toolbar itself
   * and the doubled one is gone.
   *
   * And the right it asks for changed. It was `canEdit`, with a note in the
   * source saying commenting required edit rights "until there is a role that
   * separates them" — so `viewer` and `commenter` were the same thing here, and
   * the level named after commenting could not comment. ADR-0090 separates
   * them: `canComment` is true from `commenter` up, so a reader still gets
   * nothing and the level in between finally means what it says.
   */
  const surface = codeOf(new URL('../src/components/EditorSurface.tsx', import.meta.url));
  assert.match(surface, /\{view && handle\.canComment && \(\s*<SelectionToolbar/s);
  const toolbar = codeOf(new URL('../src/components/SelectionToolbar.tsx', import.meta.url));
  assert.match(toolbar, /\{onComment && \(/);

  // And the ladder underneath it, so this cannot pass with a `canComment` that
  // happens to mean something else.
  const protocol = codeOf(new URL('../../client/src/protocol.ts', import.meta.url));
  assert.match(protocol, /export const canComment = \(role: Role\): boolean =>/);
  assert.match(protocol, /ROLE_ORDER\.indexOf\('commenter'\)/);
});

test('a locked page loses the gutter, not the comments', () => {
  /*
   * Both halves of ADR-0049's "one predicate", after finding that it was one
   * predicate in one place only.
   *
   * `editable` is an EditorView prop and ProseMirror consults it for what the
   * user types. A menu item that dispatches a command is not what the user
   * types, so the gutter's delete changed a locked page — which is how Markus
   * found it. `editGuard` asks the same predicate in `filterTransaction`,
   * where ProseMirror asks about every change.
   *
   * And the interface half: the gutter is not drawn at all, while the
   * selection toolbar stays for the comment button, because a locked page
   * under review is the case comments exist for.
   */
  const guard = codeOf(new URL('../../editor/src/editGuard.ts', import.meta.url));
  assert.match(guard, /filterTransaction/);
  assert.match(guard, /if \(mayEdit\(\)\) return true;/);

  const editor = codeOf(new URL('../../editor/src/editor.ts', import.meta.url));
  // Fed the same function `editable` gets, or the two halves could disagree —
  // which is the whole failure being fixed.
  assert.match(editor, /editGuard\(\(\) => opts\.editable\?\.\(\) !== false\)/);
  assert.match(editor, /editable: \(\) => opts\.editable\?\.\(\) !== false/);

  const surface = codeOf(new URL('../src/components/EditorSurface.tsx', import.meta.url));
  assert.match(surface, /\{view && handle\.canEdit && !locked && \(/);
  // Two reasons the formatting can be gone now: the page is locked, or this
  // person may comment and not edit (ADR-0090). Both are named, rather than
  // the second being folded into the first.
  assert.match(surface, /canFormat=\{!locked && handle\.canEdit\}/);
});

test('the editor resolves an anchor for the page, in one place', () => {
  // The panel knows a thread's id; only the editor can turn its anchor into a
  // position, and the plugin's own loop is not reachable from the application.
  const anchors = codeOf(new URL('../../editor/src/commentAnchors.ts', import.meta.url));
  assert.match(anchors, /export function revealRange/);
  const surface = codeOf(new URL('../src/components/EditorSurface.tsx', import.meta.url));
  assert.match(surface, /revealRange\(view\.state, found\)/);
  // Fed from a ref, because the editor is created once and the threads change
  // constantly — a captured list would be the one that existed on open.
  // Both the threads and the mark style are read on every rebuild rather than
  // captured: the editor is created once and both change while somebody reads.
  assert.match(
    surface,
    /commentMarks\(\(\) => threadsRef\.current, \(\) => markStyleRef\.current\)/,
  );
});

test('marking a commented passage is the reader’s choice', () => {
  // Not a speech bubble in the text: an element in the line reflows every
  // paragraph after it the moment somebody turns the marks off, and a page under
  // review would carry a rash of them (ADR-0046).
  const anchors = codeOf(new URL('../../editor/src/commentAnchors.ts', import.meta.url));
  assert.match(anchors, /if \(style === 'off'\) return DecorationSet\.empty/);
  assert.match(anchors, /sone-commented-\$\{style\}/);
  // The colour itself is asserted in its own test below, which is where the two
  // wrong attempts are recorded.
  assert.match(css, /\.sone-commented-underline \{[^}]*border-block-end/s);

  // A preference, per browser, because how much marking somebody wants depends
  // on the screen they are reading on.
  const hook = codeOf(new URL('../src/hooks/useCommentMarkStyle.ts', import.meta.url));
  assert.match(hook, /localStorage\.setItem\(KEY, next\)/);
  assert.doesNotMatch(hook, /api\./, 'not on the account');
  // One control, not two: a checkbox for "mark passages" and a "not at all"
  // option are the same decision said twice, and they could disagree — which is
  // why the tick appeared to keep coming back.
  assert.doesNotMatch(hook, /hidden/);
  /*
   * Scoped to the marks control, not the whole panel.
   *
   * It read "no checkbox anywhere in this file", which was true when the marks
   * select was the only control here — and then a checkbox arrived for "only
   * for members", which is a genuinely binary question and correctly a
   * checkbox (ADR-0057). The assertion was about *this* decision not being
   * said twice, so it now reads the marks block rather than the file.
   */
  const panel = codeOf(new URL('../src/components/CommentsPanel.tsx', import.meta.url));
  const marks = panel.slice(panel.indexOf("t('comment.marks')"));
  assert.doesNotMatch(marks.slice(0, marks.indexOf('</label>')), /type="checkbox"/);
});

test('a thread is not a bullet, and a filled button keeps its colour', () => {
  // Two things from one screenshot. `list-style: none` was missing, so every
  // thread had a bullet outside its card and an indent to make room for it.
  assert.match(css, /\.comment-list \{[^}]*list-style: none/s);
  // One hover rule for buttons without a colour of their own, and *one*: there
  // were two, twenty lines apart, and patching the second left the first
  // winning — `button.btn:hover` outranks `button.btn.primary`, so a filled
  // button went pale grey with near-white text on it and read as an empty box.
  assert.match(css, /button\.btn:not\(\.primary\):hover:not\(:disabled\)/);
  assert.equal(
    [...css.matchAll(/^button\.btn(?::not\(\.primary\))?:hover/gm)].length,
    1,
    'exactly one hover rule for an uncoloured button',
  );
});

test('the marks are redrawn by whatever noticed the change', () => {
  // Decorations rebuild on a transaction, and neither a ref nor a prop is one.
  // The style is React state, so an effect is right for it. The threads are in
  // the document, and a change there produces no editor transaction at all — so
  // the hook that noticed says so, and the editor listens. Keyed on a prop, a
  // deleted thread kept its highlight until a reload.
  const hook = codeOf(new URL('../src/hooks/useComments.ts', import.meta.url));
  // The announcement carries the list, and that is the whole of it: the hook
  // runs inside the Yjs transaction, before React re-renders, so a prop or a
  // ref read at that moment holds the state from before the change. An empty
  // event made the editor redraw the *previous* list — no highlight at all for
  // the first comment on a page, and one change behind for every later one.
  assert.match(hook, /new CustomEvent\('sone:comments-changed', \{ detail: readThreads\(doc\) \}\)/);

  const surface = codeOf(new URL('../src/components/EditorSurface.tsx', import.meta.url));
  assert.match(surface, /addEventListener\('sone:comments-changed', nudge\)/);
  assert.match(surface, /if \(Array\.isArray\(carried\)\) threadsRef\.current = carried/);
  assert.match(surface, /removeEventListener\('sone:comments-changed', nudge\)/);
  assert.match(surface, /setMeta\(commentMarksKey, true\)/);
  assert.match(surface, /\}, \[markStyle\]\)/);
});

test('a thread folds, and so do all of them', () => {
  const panel = codeOf(new URL('../src/components/CommentsPanel.tsx', import.meta.url));
  // Remembered per page, in the browser: folding is something somebody did on
  // purpose, and a reload undoing it is the application forgetting an
  // instruction. Not in the document — that would fold a thread for everybody.
  const folded = codeOf(new URL('../src/hooks/useFoldedThreads.ts', import.meta.url));
  assert.match(panel, /useFoldedThreads\(\s*\n?\s*pageId,/);
  assert.match(folded, /localStorage\.setItem\(KEY, JSON\.stringify\(all\)\)/);
  // A set of the *closed* ones, so a thread that arrives while nobody is
  // looking is open — a new comment hidden by last week's preference is a
  // comment nobody reads.
  assert.match(folded, /const \[closed, setClosed\] = useState<Set<string>>/);
  // Bounded, or it grows for ever: a deleted page leaves an entry nothing can
  // clean up.
  assert.match(folded, /MAX_PAGES/);
  // Ids for threads that no longer exist are dropped on the next *write* — and
  // never on read: on a reload the document has not arrived, so the thread list
  // is empty, and filtering the stored set against it threw everything away.
  // That is the same mistake as seeding the editor before Yjs had synced.
  assert.match(folded, /setClosed\(new Set\(readAll\(\)\[pageId\] \?\? \[\]\)\)/);
  assert.match(folded, /existing\.length > 0 \? \[\.\.\.next\]\.filter/);
  assert.match(panel, /aria-expanded=\{open\}/);
  // Closed, the first message stays: a thread showing only its quotation says
  // what is being discussed and not what was said about it.
  assert.match(panel, /open \? thread\.messages : thread\.messages\.slice\(0, 1\)/);
  // And the count says whether anybody answered.
  assert.match(panel, /!open && thread\.messages\.length > 1/);
});

test('the highlight is visible against the page', () => {
  // Twice wrong before this: a highlighter yellow that competed with the words,
  // then the surface panels are drawn on — #f7f5f0 against a #ffffff page, a
  // three per cent difference, so the mark disappeared. "Toned down" and
  // "invisible" are not the same thing, and both values were there to compare.
  assert.match(
    css,
    /\.sone-commented-highlight \{[^}]*background: color-mix\(in srgb, var\(--accent\) 16%/s,
  );
  assert.doesNotMatch(css, /\.sone-commented-highlight \{[^}]*var\(--surface-sunken\)/s);
});

test('a reply has a button, not only a shortcut', () => {
  // Enter stays, because a comment is usually one sentence — but a shortcut is
  // the *second* way to do something, never the only one. A box with no button
  // is a box somebody types into and then looks around for what to press.
  const panel = codeOf(new URL('../src/components/CommentsPanel.tsx', import.meta.url));
  const reply = panel.slice(panel.indexOf('className="comment-reply"'));
  assert.match(reply.slice(0, 1600), /t\('comment\.reply'\)/);
  assert.match(reply.slice(0, 1600), /disabled=\{draft\.trim\(\) === ''\}/);
  // And the irreversible one is not beside the one pressed most.
  assert.match(css, /\.comment-destroy \{ margin-inline-start: auto/);
});

test('history says how far back it goes, and that it does not go all the way', () => {
  // Both stated rather than implied (ADR-0047). Every page that existed before
  // versions were kept has one collapsed state and no past, and a list that
  // simply stops looks like a page nobody edited until then.
  const panel = codeOf(new URL('../src/components/HistoryPanel.tsx', import.meta.url));
  assert.match(panel, /t\('history\.retention', \{ days: retentionDays \}\)/);
  assert.match(panel, /t\('history\.incomplete'\)/);
});

test('a past version replaces the body and shows no editor', () => {
  // The point is to read the page as it was, and a page cannot be read in a
  // column beside itself. The editor is not rendered rather than disabled — an
  // editor that refuses keystrokes is an invitation somebody has already
  // accepted by the time it refuses.
  const view = codeOf(new URL('../src/components/PageView.tsx', import.meta.url));
  assert.match(view, /viewingVersion \? \(\s*\n\s*<VersionView/);
  // And it is not in the URL: thinning does not promise a version still exists,
  // so a shared link could show a different past than the one that was shared.
  const app = codeOf(new URL('../src/App.tsx', import.meta.url));
  assert.match(app, /const \[viewingVersion, setViewingVersion\] = useState<string \| null>/);
  assert.doesNotMatch(app, /paths\.version/);
});

test('restoring says what it actually does', () => {
  // "Restore" in most applications means going back and losing what came after.
  // Here it is an edit applied forward, because a CRDT cannot be rewound — and
  // somebody who expects the usual meaning has to be told the truth rather than
  // reassured (ADR-0047).
  const en = codeOf(new URL('../src/i18n/messages.en.ts', import.meta.url));
  assert.match(en, /'history\.restoreMeans':/);
  assert.match(en, /an edit, not a rewind/);
  assert.match(en, /Comments are not touched/);

  // And the server does not touch where the page lives, or restoring an old
  // parent would silently move it.
  const versions = codeOf(new URL('../../server/src/doc/versions.ts', import.meta.url));
  assert.match(versions, /const STRUCTURAL_KEYS = \['kind', 'idx', 'parentPageId', 'collectionId'\]/);
  assert.doesNotMatch(versions, /getMap\('comments'\)/, 'comments are left alone');
});

test('exporting asks one question and downloads by navigating', () => {
  // "With or without attachments" is the difference between an archive somebody
  // can email and one they cannot, and it is not guessable from outside.
  // Everything else about the export is decided, so there is nothing else to
  // ask (ADR-0044).
  const dialog = codeOf(new URL('../src/components/ExportDialog.tsx', import.meta.url));
  assert.match(dialog, /t\('export\.withAttachments'\)/);
  // A navigation rather than a fetch: the response is a file with a
  // Content-Disposition, and fetching it into a blob would hold the archive
  // twice and lose the name the server chose.
  assert.match(dialog, /window\.location\.assign\(/);
  assert.doesNotMatch(dialog, /createObjectURL/);
  // Offered beside the two moves, which are the same family: all three are the
  // page going somewhere.
  const menu = codeOf(new URL('../src/components/EntryMenu.tsx', import.meta.url));
  assert.ok(menu.indexOf("t('entry.moveToWorkspace')") < menu.indexOf("t('entry.export')"));
});

test('a version is drawn with the block names that exist', () => {
  // I wrote this against `heading-1`, `bullet` and `numbered`, none of which
  // exist: the types are `heading` with a `level`, `bulletList` and
  // `numberedList`. Every heading and every list item was drawn as a paragraph.
  const view = codeOf(new URL('../src/components/VersionView.tsx', import.meta.url));
  assert.match(view, /if \(type === 'heading'\)/);
  assert.match(view, /'bulletList' \|\| type === 'numberedList'/);
  assert.doesNotMatch(view, /'heading-1'|'bullet'|'numbered'/);
  // And the level comes from the block's own props, which the server now sends.
  assert.match(view, /Number\(block\.props\?\.\['level'\] \?\? 1\)/);
});

test('every access level the server accepts is offered by a screen', () => {
  // The gap ADR-0046 got wrong: the role existed in the model — `share_role` has
  // been an enum of viewer, commenter, editor, admin since the first migration,
  // and `canComment` sits beside `canEdit` — while no screen offered it. A
  // capability nobody can reach is a capability nobody has.
  //
  // Read from the server's own list rather than a copy typed here, so the next
  // level added there fails this test instead of quietly having no interface.
  const routes = codeOf(
    new URL('../../server/src/pages/permissionRoutes.ts', import.meta.url),
  );
  const match = routes.match(/const LEVELS: readonly PageAccess\[\] = \[([^\]]+)\]/);
  assert.ok(match, "the server's level list was found");
  const levels = [...match[1]!.matchAll(/'([a-z]+)'/g)].map((one) => one[1]);
  assert.deepEqual(levels, ['viewer', 'commenter', 'editor', 'admin']);

  const permissions = codeOf(
    new URL('../src/components/PagePermissions.tsx', import.meta.url),
  );
  for (const level of levels) {
    assert.match(permissions, new RegExp(`id: '${level}'`), `${level} can be granted`);
  }

  // And a share link's roles are keys, not English sentences in a translated
  // interface — which is what they were, in a Record the guard cannot see.
  const share = codeOf(new URL('../src/components/ShareDialog.tsx', import.meta.url));
  assert.match(share, /Record<string, MessageKey>/);
  assert.doesNotMatch(share, /viewer: 'Can read'/);
});

test('both sidebar sections fold, and the tree has a heading of its own', () => {
  // The folders simply began: no heading, so nothing to fold and nothing to hang
  // a `+` on. A heading for each makes the two behave alike, which is the point.
  const sidebar = codeOf(new URL('../src/components/Sidebar.tsx', import.meta.url));
  assert.match(sidebar, /label=\{t\('sidebar\.favourites'\)\}/);
  assert.match(sidebar, /label=\{t\('sidebar\.folders'\)\}/);
  // The whole heading is the control, not a caret somebody has to hit precisely.
  assert.match(sidebar, /className="sidebar-section-toggle"[\s\S]{0,200}aria-expanded=\{open\}/);
  // A rule between sections, so a shortcut list and the tree stop reading as one
  // long list.
  assert.match(css, /\.sidebar-section \+ \.sidebar-section \{[^}]*border-block-start/s);

  // The `+` is always drawn: a control that appears when a pointer is near it
  // does not exist on a phone, and it is now the only way to make a folder.
  assert.match(sidebar, /className="sidebar-section-add"/);
  assert.doesNotMatch(sidebar, /tree-new-folder/);
  assert.doesNotMatch(css, /^\.tree-new-folder \{/m);
  // Which makes the empty case matter: it says where to press.
  assert.match(sidebar, /t\('sidebar\.emptyFolders'\)/);

  // Remembered per browser, for the reason the comment folds are (ADR-0046).
  assert.match(sidebar, /localStorage\.setItem\('sone\.sidebarSections'/);
});

test('an import shows its plan and writes nothing until it is confirmed', () => {
  // The middle state is the feature (ADR-0044): an import that has created two
  // hundred pages by the time somebody notices it mangled the hierarchy is
  // worse than no import, because undoing it is two hundred deletions.
  const dialog = codeOf(new URL('../src/components/ImportDialog.tsx', import.meta.url));
  assert.match(dialog, /import\/plan/);
  assert.ok(
    dialog.indexOf('import/plan') < dialog.indexOf("t('import.confirm')"),
    'the plan is fetched before the confirm button exists',
  );
  // Collisions are shown and named, and there is no "replace" — said rather
  // than left for somebody to look for.
  assert.match(dialog, /t\('import\.noOverwrite'\)/);
  assert.doesNotMatch(dialog, /overwrite=|replace=/);
  // And the files that will not come are stated, because the plan counts them.
  assert.match(dialog, /t\('import\.attachmentsNotYet'/);
});

test('a workspace export is watched, not waited for', () => {
  // Packing a large workspace takes minutes, and a spinner somebody has to keep
  // a tab open for is a request they cannot walk away from (ADR-0044).
  const panel = codeOf(new URL('../src/components/WorkspaceExport.tsx', import.meta.url));
  assert.match(panel, /setTimeout\(\(\) => void tick\(\), 2000\)/);
  // Polled only while something is running: a page that keeps asking about jobs
  // that finished yesterday costs something to leave open.
  assert.match(panel, /rows\.some\(\(job\) => job\.state === 'queued' \|\| job\.state === 'running'\)/);
  // Progress is the job's own sentence, never a fraction.
  assert.match(panel, /job\.progress \?\? t\('workspace\.export\.waiting'\)/);
  assert.doesNotMatch(panel, /percent|%\}/);
  // And what an archive contains is said before it is asked for.
  assert.match(panel, /t\('workspace\.export\.rights'\)/);
});

test('the workspace export lives in the workspace settings', () => {
  // Where the record put it: it belongs to the workspace, not to a page's ⋮ menu
  // and not to the administration area — it is not a backup (ADR-0044).
  const screen = codeOf(
    new URL('../src/components/WorkspaceSettingsScreen.tsx', import.meta.url),
  );
  assert.match(screen, /\{ id: 'export', label: 'workspace\.export'/);
  assert.match(screen, /current === 'export' && <WorkspaceExport/);
});

test('a PDF is drawn by us, not by the browser', () => {
  // The embed was a real viewer on Chromium and a picture of page one on iOS, so
  // the same document was readable at a desk and not on a phone. Replaced rather
  // than worked around: the platform check and the "open all pages" note it
  // needed are gone with it (ADR-0048).
  const view = codeOf(new URL('../src/components/FileNodeView.ts', import.meta.url));
  assert.match(view, /display === 'full' && category === 'pdf'/);
  assert.match(view, /mountPdfViewer\(host, url, this\.labels\.pdf\)/);
  assert.doesNotMatch(view, /onlyFirstPageInline|maxTouchPoints/);
});

test('the PDF engine is loaded only when a PDF is opened', () => {
  // The whole reason the dependency is acceptable (ADR-0048): 448 kB of engine
  // and 1.3 MB of worker must not land on somebody who never opens a PDF. A
  // static import would add half a megabyte to every first load, which is
  // exactly the kind of regression nobody notices.
  const viewer = codeOf(new URL('../src/components/pdfViewer.ts', import.meta.url));
  assert.match(viewer, /await Promise\.all\(\[\s*\n?\s*import\('pdfjs-dist'\)/);
  assert.doesNotMatch(viewer, /^import .*pdfjs-dist/m, 'never a static import');
  // The worker comes from the build, so it is served from our own origin: a CDN
  // here would be a third party learning who reads which document.
  assert.match(viewer, /pdfjs-dist\/build\/pdf\.worker\.min\.mjs\?url/);

  // And no other file may pull it in statically either.
  for (const file of ['FileNodeView.ts', 'EditorSurface.tsx', 'CollectionNodeView.tsx']) {
    const source = codeOf(new URL(`../src/components/${file}`, import.meta.url));
    assert.doesNotMatch(source, /from 'pdfjs-dist/, `${file} does not import the engine`);
  }
});

test('a PDF viewer releases what it holds', () => {
  // It holds a worker, an open document and an observer, and a node view is
  // destroyed and recreated as somebody edits around it — so without this,
  // scrolling past a PDF while typing leaves a worker per recreation.
  const view = codeOf(new URL('../src/components/FileNodeView.ts', import.meta.url));
  assert.match(view, /destroy\(\): void \{\s*\n\s*this\.pdf\?\.destroy\(\)/);
  const viewer = codeOf(new URL('../src/components/pdfViewer.ts', import.meta.url));
  assert.match(viewer, /observer\?\.disconnect\(\)/);
  // The loading task is destroyed, not the document proxy — which has no such
  // method, as the compiler pointed out before a leak could.
  assert.match(viewer, /cleanups\.push\(\(\) => void task\.destroy\(\)\)/);
  // A page far out of view is released, or a hundred-page document read to the
  // end holds a hundred canvases.
  assert.match(viewer, /Math\.abs\(number - current\) > 4/);
});

test('a locked page goes through the one predicate the editor already had', () => {
  // `if (locked)` in fifteen commands is fifteen chances for one to be
  // forgotten, and the one forgotten is a hole nobody finds until a locked page
  // changes. ProseMirror asks `editable` for typing, pasting, dragging and every
  // command, so one place covers all of them (ADR-0049).
  const surface = codeOf(new URL('../src/components/EditorSurface.tsx', import.meta.url));
  assert.match(surface, /editable: \(\) => canEditRef\.current && !lockedRef\.current/);
  // And re-evaluated when the lock changes, or a page stays editable until the
  // next transaction — one keystroke too many.
  assert.match(surface, /\}, \[handle\.canEdit, locked\]\)/);

  // Read from the document, because a lock has to reach an editor that is
  // already open — which is exactly when the accident happens.
  const hook = codeOf(new URL('../src/hooks/usePageWidth.ts', import.meta.url));
  assert.match(hook, /export function usePageLocked/);
  assert.match(hook, /page\.get\(PAGE_KEYS\.locked\) === true/);
});

test('a lock does not read like a permission', () => {
  // Anybody who may edit may lift it. Saying "protected" would invite somebody
  // to lock a page and believe it is safe from a colleague; what restricts other
  // people is a permission (ADR-0026, ADR-0049).
  const en = codeOf(new URL('../src/i18n/messages.en.ts', import.meta.url));
  // A short verb in the menu, with the sentence as its hint: `white-space:
  // nowrap` on a menu item means a long label does not wrap, it leaves the
  // panel — which is what the first wording did.
  assert.match(en, /'entry\.lock': 'Lock',/);
  assert.match(en, /'entry\.lock\.hint': 'Lock against accidental changes/);
  assert.doesNotMatch(en, /'entry\.lock[^']*': '[^']*[Pp]rotect/);
  // And no label can leave the panel again.
  assert.match(css, /\.entry-menu-item \{[^}]*text-overflow: ellipsis/s);
  // The padlock in the tree is grey and small rather than a warning colour.
  assert.match(css, /\.tree-locked \{[^}]*color: var\(--sone-text-muted\)/s);
  // And no banner across the page: a locked page is still a page to read.
  assert.doesNotMatch(css, /\.locked-banner/);
});

test('a workspace tint is mixed into the ramp, not set per surface', () => {
  // The surfaces are a ramp of one warm grey (ADR-0028). Letting a workspace set
  // each separately would let it set them inconsistently — a sidebar that no
  // longer belongs to the panel beside it — so one tint is mixed into all of
  // them, with the proportions here where the ramp's relationships are readable.
  // Every surface, counted rather than remembered.
  //
  // I tinted a list I had typed from memory and missed `--surface-chrome` — the
  // token the sidebar actually sits on — so a workspace set to blue got a blue
  // menu highlight and a beige sidebar. This enumerates the declarations in each
  // theme block and asserts that none is left untinted, which is a test about
  // completeness rather than about the seven names I happen to know today.
  for (const block of ['light', 'dark']) {
    const start =
      block === 'light' ? css.indexOf(":root,\n[data-theme='light'] {") : css.indexOf("[data-theme='dark'] {");
    assert.ok(start > -1, `${block} theme block found`);
    const body = css.slice(start, css.indexOf('--text-primary', start));
    const surfaces = [...body.matchAll(/^\s+(--surface[a-z-]*): (.+);$/gm)];
    assert.ok(surfaces.length >= 7, `${block} declares its surfaces`);
    for (const [, name, value] of surfaces) {
      // The fallback is the surface's own base rather than `transparent`, which
      // is a correctness fix and not a style one: `transparent` is
      // rgb(0 0 0 / 0), so an untinted workspace was mixing in 16% of nothing
      // at all and every surface came out see-through. brand.test.ts holds the
      // rule; this one only cares that the mix is there at all.
      assert.match(value, /color-mix\(in srgb, var\(--sone-theme-tint,/, `${name} in ${block}`);
    }
  }
  // The chrome takes the most, because it is what somebody means by "the colour
  // of the interface"; the page almost none.
  assert.match(css, /--surface-chrome: color-mix\(in srgb, var\(--sone-theme-tint, [^)]*\)? ?\)? 16%/);
  // A fallback at every use rather than a default declared once, which is the
  // rule this stylesheet already follows — `clearTheme` removes these from the
  // root, and a value living in a rule would survive its own deletion.
  assert.doesNotMatch(css, /--sone-theme-tint:/);
});

test('the gutter cannot start a text selection', () => {
  // It had `touch-action` and nothing else — half the treatment the menu items
  // above it got. `touch-action` stops scrolling and zooming from a touch; it
  // does nothing about selection, which is why reaching for the handle on a
  // tablet marked the text beside it.
  // One rule for the element, not two: this test first found an earlier
  // `.block-gutter` rule that set only its position, which is the same
  // two-rules-for-one-thing fragility that put a pale hover on filled buttons
  // twice this week. They are merged.
  assert.equal([...css.matchAll(/^\.block-gutter \{/gm)].length, 1);
  const gutter = css.slice(css.indexOf('.block-gutter {'));
  const rule = gutter.slice(0, gutter.indexOf('}'));
  assert.match(rule, /user-select: none/);
  assert.match(rule, /-webkit-touch-callout: none/);
  // `manipulation` rather than `none`: a finger landing in the gutter and moving
  // up the page should still scroll it.
  assert.match(rule, /touch-action: manipulation/);
});

test('a single block can be locked, from where its other settings are', () => {
  // The case the page lock cannot serve: working notes with one table of figures
  // that must not move (ADR-0049). In the gutter menu, beside duplicate and
  // before delete — not a floating padlock over the content, which would cover
  // the thing it acts on.
  const menu = codeOf(new URL('../src/components/BlockMenu.tsx', import.meta.url));
  assert.match(menu, /label: lockedHere \? 'block\.unlock' : 'block\.lock'/);
  assert.ok(menu.indexOf("id: 'lock'") < menu.indexOf("id: 'delete'"));

  // One filter, not a guard per command — the same reasoning as the page lock's
  // single `editable` predicate.
  const lock = codeOf(new URL('../../editor/src/blockLock.ts', import.meta.url));
  assert.match(lock, /filterTransaction:/);
  // The lock's own change is announced, because `setNodeMarkup` is a
  // ReplaceAroundStep: without this, locking a block locked away the unlock.
  assert.match(lock, /if \(tr\.getMeta\(blockLockKey\) === 'set'\) return true/);
  // Another client's edit is never refused: rejecting it would make this
  // document differ from everybody else's (ADR-0002).
  assert.match(lock, /tr\.getMeta\('y-sync\$'\)/);
  // And a locked block is visibly locked, by a decoration rather than by an
  // attribute written into everybody's document.
  assert.match(lock, /Decoration\.node\(pos, pos \+ node\.nodeSize, \{ 'data-locked': 'true' \}\)/);
  assert.match(css, /\.ProseMirror \[data-locked='true'\]/);
});

test('the chips show what the server used, not what the client guessed', () => {
  // Both parse the query — the client has to, to decide whether to search at
  // all — but the chips come from the response, because that is the version
  // that was actually applied (ADR-0050).
  const screen = codeOf(new URL('../src/components/Search.tsx', import.meta.url));
  assert.match(screen, /setApplied\(response\.filters \?\? null\)/);
  // A filter alone is enough to search, so the two-character gate is replaced
  // by the shared predicate rather than sitting beside it.
  assert.match(screen, /if \(!hasSearchCriteria\(parseSearchQuery\(query\)\)\)/);
  assert.doesNotMatch(screen, /query\.trim\(\)\.length >= 2/);
  assert.doesNotMatch(screen, /query\.trim\(\)\.length < 2/);
  // An unreadable filter is struck through rather than hidden.
  assert.match(screen, /className="search-chip unreadable"/);
  assert.match(css, /\.search-chip\.unreadable \{[^}]*text-decoration: line-through/s);
  // And the syntax is said once, under an empty field, rather than in a help
  // page somebody has to find.
  assert.match(screen, /query === '' && <p className="settings-note">\{t\('search\.syntax'\)\}/);
});

test('a correction is offered as a search, and keeps the filters', () => {
  // The point of correcting the word rather than matching the text (ADR-0051):
  // pressing it runs the *ordinary* ranked search, with the same weighting and
  // snippets as any other — not a second ranking by string similarity.
  const screen = codeOf(new URL('../src/components/Search.tsx', import.meta.url));
  assert.match(screen, /setQuery\(withWord\(query, word\)\)/);
  // And only the misspelt word is replaced: throwing away a `tag:` somebody
  // typed to accept a spelling would be a strange trade.
  assert.match(screen, /function withWord\(query: string, word: string\)/);
  assert.match(screen, /query\.replace\(parsed\.text, word\)/);
});

test('the count is on the bell, and it comes from the list', () => {
  /*
   * This test used to say the opposite, and both halves of what it said were
   * wrong (ADR-0092).
   *
   * It asserted that the count is `AccountMenu`'s own business, fetched by its
   * own `GET /api/inbox/count`, "once per mount, which is once per navigation".
   * Routing here is `pushState` and the menu is mounted once, so that was once
   * per **full page load** — reported as "die Zahl aktualisiert sich erst nach
   * reload". And it put the badge on the face, which opens a menu that does not
   * hold the notifications: "Die Glocke sollte dann die Zahl haben".
   *
   * So: one number, counted from the list the inbox already has, drawn on the
   * bell. A second request cannot disagree with a list it never sees, and
   * marking something read now moves both because there is only one.
   */
  const menu = codeOf(new URL('../src/components/AccountMenu.tsx', import.meta.url));
  assert.doesNotMatch(menu, /inboxCount/, 'no second request for the same number');
  assert.doesNotMatch(menu, /sidebar-unread"/, 'and no badge on the face');

  const hook = codeOf(new URL('../src/hooks/useInbox.ts', import.meta.url));
  assert.match(hook, /const unread = \(items \?\? \[\]\)\.filter\(/);
  // Read again when somebody comes back to the window — the same pair
  // `usePages` uses. Not a timer: a notification is wanted when it is looked
  // for, and polling costs every open tab.
  assert.match(hook, /addEventListener\('focus', again\)/);
  assert.match(hook, /addEventListener\('visibilitychange', again\)/);
  assert.doesNotMatch(hook, /setInterval/);

  const rail = codeOf(new URL('../src/components/IconRail.tsx', import.meta.url));
  assert.match(rail, /className="sidebar-unread"/);
});

test('an inbox spans workspaces, so its route carries none', () => {
  // The whole point is being told about a question asked somewhere other than
  // where somebody is standing, so a path with a workspace in it would be a lie
  // about what the screen shows.
  const paths = codeOf(new URL('../src/routes/paths.ts', import.meta.url));
  assert.match(paths, /inbox: \(\) => '\/inbox'/);
  const app = codeOf(new URL('../src/App.tsx', import.meta.url));
  // The screen takes the filtered list and no workspace: the filtering is the
  // panel's view (ADR-0069), and the scope is deliberately absent.
  assert.match(app, /route\.kind === 'inbox' && \(/);
  assert.match(app, /items=\{inbox\.items\}/);
  assert.doesNotMatch(app, /<InboxScreen[^>]*workspaceId/);

  const screen = codeOf(new URL('../src/components/InboxScreen.tsx', import.meta.url));
  /*
   * Read on opening, not on looking: an inbox that empties itself when glanced
   * at is one that loses things.
   *
   * The call goes through the shell's hook — one fetch and one truth for the
   * menu's counts and the list alike — and it now settles the whole
   * conversation, because a row is a conversation (ADR-0071). The moment is
   * unchanged, which is what this asserts.
   */
  assert.match(screen, /if \(group\.unread > 0\) onRead\(group\.items\.map/);
  // And it says there is no email, rather than letting somebody assume one.
  assert.match(screen, /t\('inbox\.noEmail'\)/);
});

test('a share link says what it gives away, with the count', () => {
  // The moment a link is handed out, every comment on the page is visible to
  // whoever holds it. ADR-0046 required the dialog to say so, with the number,
  // where the link is made — the same argument as the trash button carrying its
  // count: the fact that changes the decision belongs where the decision is.
  const dialog = codeOf(new URL('../src/components/ShareDialog.tsx', import.meta.url));
  assert.match(dialog, /threadCount > 0 && \(/);
  assert.match(dialog, /t\('share\.commentsVisible', \{ count: threadCount \}\)/);
  // Only when there are comments: a warning that appears every time is a
  // warning nobody reads.
  const en = codeOf(new URL('../src/i18n/messages.en.ts', import.meta.url));
  assert.match(en, /'share\.commentsVisible':/);
});

test('a diff is inline, tells added from removed without colour, and states its limits', () => {
  // Inline rather than side by side: two columns on a phone is one column
  // (ADR-0053).
  const view = codeOf(new URL('../src/components/VersionDiff.tsx', import.meta.url));
  assert.doesNotMatch(view, /side-by-side|column-left|diff-columns/);
  // Underline and strike-through as well as colour, so the two are told apart
  // without seeing colour.
  assert.match(css, /\.diff-word\.added \{[^}]*text-decoration: underline/s);
  assert.match(css, /\.diff-word\.removed \{[^}]*text-decoration: line-through/s);
  // A bar in the margin rather than a background behind the prose, which would
  // make the prose harder to read and defeat the purpose of showing it.
  assert.match(css, /\.diff-block \{[^}]*border-inline-start: 3px solid/s);

  // Both limits said where the comparison is, not in a document to be found.
  assert.match(view, /t\('diff\.noFormatting'\)/);
  assert.match(view, /unmatched > 0 &&/);

  // Reading a version and comparing it are two states, not one with a mode.
  const app = codeOf(new URL('../src/App.tsx', import.meta.url));
  assert.match(app, /setComparingVersion\(id\);\s*\n\s*setViewingVersion\(null\);/);
});

test('the stream player is loaded only when a stream needs it, and released', () => {
  // The same bargain as the PDF renderer: 113 kB over the wire, in its own
  // chunk, so a page with no stream downloads none of it (ADR-0037).
  const view = codeOf(new URL('../src/components/VideoNodeView.ts', import.meta.url));
  assert.match(view, /await import\('hls\.js\/light'\)/);
  // Through the package's documented entry point rather than a path into its
  // dist folder, which has no types and breaks when a file is renamed.
  assert.doesNotMatch(view, /hls\.js\/dist\//);
  // Native first: Safari's own player is better than a library reimplementing
  // it, and it is the one that gets AirPlay right.
  assert.match(view, /read\.kind === 'hls' && !playsHlsNatively\(\)/);
  // And released with the node view, which holds a worker and an open
  // connection — the leak the PDF viewer had before it got a destroy.
  assert.match(view, /destroy\(\): void \{\s*\n\s*this\.hls\?\.destroy\(\)/);
  // The words are translated now; they were English in a translated interface.
  assert.match(view, /this\.labels\.dashOnly/);
  assert.doesNotMatch(view, /'DASH streams play only/);
});

test('a page shows where it sits only while the sidebar is away', () => {
  // The sidebar is the trail when it is there, and two of them is one too many.
  // With it hidden — on a phone, or by choice — a page gives no clue where it
  // is, which is worst for a collection's row: it opens as a page with a name
  // and no visible parent at all.
  const app = codeOf(new URL('../src/App.tsx', import.meta.url));
  assert.match(app, /trail=\{sidebarVisible \? \[\] : ancestorNodes\(tree, selected\?\.id \?\? ''\)\}/);

  // The same markup a folder's own trail uses, and now the same rules: they
  // were scoped to `.folder-view`, so a page would have shown an unstyled one.
  assert.match(css, /^\.breadcrumb \{/m);
  assert.doesNotMatch(css, /\.folder-view \.breadcrumb/);
});

test('a canvas item can be commented on, from its own menu', () => {
  // ADR-0046 deferred this saying the anchor "is an item id, which is a far
  // simpler thing" — no relative position, no mapping, no quotation needed to
  // survive a rewrite.
  const canvas = codeOf(new URL('../src/components/CanvasSurface.tsx', import.meta.url));
  assert.match(canvas, /onCommentItem\(selectedItem\.id\)/);
  // The icon the comments tab already uses, not a second speech bubble.
  assert.match(canvas, /<MessageIcon \/>/);

  // One anchor type from either surface: a second would make the panel decide
  // which of two shapes it has before it can do anything.
  const panel = codeOf(new URL('../src/components/CommentsPanel.tsx', import.meta.url));
  assert.match(panel, /pending\.item \? t\('comment\.aboutItem'\) : pending\.quote/);
  // An item has no words to quote, so the panel says which kind of thing it is
  // rather than showing an empty line where a quotation belongs.
  assert.match(panel, /thread\.item !== null \? t\('comment\.aboutItem'\) : thread\.quote/);
  // And it is never "detached": `range === null` means the text a comment
  // pointed at is gone, while an item comment has no range by design — the same
  // test would have struck through every canvas thread.
  assert.match(panel, /disabled=\{thread\.item === null && thread\.range === null\}/);
});

test('a relation asks where it points, in a second step', () => {
  // The type list is one decision per row, so a type that quietly needed a
  // second answer would be the one entry behaving differently from the other
  // ten (ADR-0054).
  const table = codeOf(new URL('../src/components/CollectionTable.tsx', import.meta.url));
  // The cell itself moved to CollectionCell.tsx so a row's own page can draw it
  // too; the column-creation steps stayed with the table.
  const cellFile = codeOf(new URL('../src/components/CollectionCell.tsx', import.meta.url));
  assert.match(table, /if \(fieldType === 'relation' && !target\) \{/);
  assert.match(table, /setChoosingRelation\(true\)/);

  // Built like every other dialog here. I wrote `dialog-backdrop` first, which
  // exists nowhere — the same invented name that once opened the export window
  // at the foot of a menu.
  assert.match(table, /className="dialog-scrim"/);
  assert.doesNotMatch(table, /dialog-backdrop/);

  // Asked from the collection, not from the workspace: the table is rendered
  // from a node view and does not know its workspace id, and the question is
  // "what could a relation from *here* point at" anyway.
  assert.match(table, /\.relationTargets\(collectionId\)/);

  // That the cell links to the other row is asserted where it can be seen:
  // `shareLinks.test.tsx` mounts this cell and reads the href off the anchor.
  // It was a source match for `paths.page(...)` here, which broke the moment
  // the call was renamed and could never have said whether the URL was right —
  // the sixth of these to move for exactly that reason (ADR-0113).
  // And an empty relation is no value, the shape every other cell uses.
  assert.match(cellFile, /next\.length > 0 \? \{ kind: 'relation', pageIds: next \} : null/);
});

test('a derived cell cannot be typed into, and says when it is partial', () => {
  // An editable cell whose value the server computes would be a lie the moment
  // somebody typed in it (ADR-0054). So the derived branch comes first, before
  // the dispatch that is about stored kinds.
  // In CollectionCell.tsx now: the four renderers moved out of the table when a
  // row's own page needed them (ADR-0054).
  const table = codeOf(new URL('../src/components/CollectionCell.tsx', import.meta.url));
  const cell = table.slice(table.indexOf('function Cell({'));
  const derivedAt = cell.indexOf("field.fieldType === 'rollup'");
  const storedAt = cell.indexOf("field.fieldType === 'files'");
  assert.ok(derivedAt > -1 && derivedAt < storedAt, 'the derived branch is first');
  // The rollup branch itself, not everything up to the next landmark: my first
  // version sliced as far as the files branch, which spans the *relation*
  // branch — and that one is editable, so the assertion failed on a cell it was
  // never about.
  const branch = cell.slice(derivedAt, cell.indexOf("field.fieldType === 'relation'"));
  assert.doesNotMatch(branch, /onChange/);

  // Two people seeing different numbers on one page is correct, and looks like
  // a fault when nothing explains it. In the cell module with the cell.
  assert.match(table, /derived\.partial && \(/);
  assert.match(table, /t\('rollup\.partial'\)/);

  // A rollup is built on a relation that points *here*, which is the only thing
  // it can be built on — so the dialog offers those and nothing else. That
  // dialog stayed with the table, which is what creates columns.
  const owner = codeOf(new URL('../src/components/CollectionTable.tsx', import.meta.url));
  assert.match(owner, /\.incomingRelations\(collectionId\)/);
  assert.match(owner, /t\('rollup\.nothingPointsHere'\)/);
});

test('a rollup can be changed to sum, min or max — the capability is reachable', () => {
  // The server has been able to do these since the derived side was built.
  // Shipping the capability with no control would have been a feature only its
  // author could use (ADR-0054).
  const table = codeOf(new URL('../src/components/CollectionTable.tsx', import.meta.url));
  assert.match(table, /\['rows', 'count', 'lookup', 'sum', 'min', 'max'\] as const/);
  // An aggregate that needs a field gets a second select beside it, because the
  // server refuses the half of the decision that names none — and a control
  // that earns a 422 reads as broken rather than as unfinished.
  assert.match(table, /needsField\(String\(field\.config\?\.\['aggregate'\] \?\? 'count'\)\)/);
  // And switching to one that needs none clears the field, so switching back
  // does not silently reuse a field chosen for a different question.
  assert.match(table, /\{ fieldId: chosen \} : \{ fieldId: null \}/);

  // The whole config goes back, not a patch of it: `viaFieldId` is what the
  // rollup is built on, and the server replaces the object rather than merging
  // — so omitting it would clear the relation the column reads. It carries the
  // aggregate's field too now, which is why this reads the two lines rather
  // than one literal object.
  assert.match(table, /\.\.\.field\?\.config,\s*\n\s*viaFieldId: via,\s*\n\s*aggregate,/);
});

test('a gallery card can show a rollup, which lives outside row.values', () => {
  // Without this a rollup could never appear on a card: `chipsOf` reads
  // `row.values`, and a derived value is in `row.derived`. A column that works
  // in the table and is invisible in the gallery is exactly the half-state this
  // session keeps finding (ADR-0054).
  const gallery = codeOf(new URL('../src/components/CollectionGallery.tsx', import.meta.url));
  assert.match(gallery, /const derived = row\.derived\?\.\[field\.id\]/);
  // The derived branch is first, because the value is not in `values` to find.
  assert.ok(gallery.indexOf('row.derived?.[field.id]') < gallery.indexOf("value.kind === 'text'"));
  // A relation is counted rather than named: a card has ids and no titles, and
  // fetching one title per card is a request per row for one word.
  assert.match(gallery, /value\.pageIds\.length\}`\)/);

  // The board shows only titles, for every type — consistent rather than a gap,
  // so nothing was added there.
  const board = codeOf(new URL('../src/components/CollectionBoard.tsx', import.meta.url));
  assert.doesNotMatch(board, /row\.derived/);
});

test("a row's page shows its own fields, with the table's renderer", () => {
  // A row opened as a page that said nothing about the row it is — the gap
  // ADR-0054 recorded and this closes.
  const panel = codeOf(new URL('../src/components/RightSidebar.tsx', import.meta.url));
  assert.match(panel, /\.rowProperties\(pageId\)/);
  // The same renderer the table uses, which is why it moved into its own
  // module: two of them would drift, and the one that drifted would be this.
  assert.match(panel, /import \{ Cell \} from '\.\/CollectionCell\.tsx'/);
  // Above the page's kind and dates: on a row page these *are* the page.
  assert.ok(panel.indexOf('row.fields.map') < panel.indexOf("t('panel.kind')"));
  // Optimistic, like the table's cells: a value that waits for a round trip
  // reads as a control that did not take.
  assert.match(panel, /values: \{ \.\.\.current\.values, \[field\.id\]: value \?\? undefined \}/);
});

test('a collection loads a page at a time, forwards only', () => {
  // The read route had no limit: every row with every cell on every load, which
  // measured at 7.1 MB of JSON for twenty thousand rows (ADR-0055).
  const table = codeOf(new URL('../src/components/CollectionTable.tsx', import.meta.url));
  assert.match(table, /const cursor = data\?\.nextCursor;/);
  // Appended, not replacing: a table that scrolls is one list somebody is
  // reading, so there is no "previous" — scrolling up is already that.
  assert.match(table, /rows: \[\.\.\.current\.rows, \.\.\.next\.rows\]/);
  assert.doesNotMatch(table, /previousCursor|prevCursor/);

  // A button rather than a scroll observer: an observer inside a horizontally
  // scrolling table fires on the wrong axis and loads pages nobody asked for.
  assert.match(table, /onClick=\{\(\) => void loadMore\(\)\}/);

  // And a view that had to read everything to sort says so, rather than being
  // quietly slower than its neighbours.
  assert.match(table, /data\.sortedInMemory && <p className="settings-note">/);
});

test('the row count is of the filtered set, and vague above the ceiling', () => {
  // "1–50 of 12 431" has to mean the set being paged, or it is a different
  // number in the same place (ADR-0055).
  const table = codeOf(new URL('../src/components/CollectionTable.tsx', import.meta.url));
  assert.match(table, /data\.totalIsExact === false/);
  assert.match(table, /t\('table\.countMany'/);
  // Only when there is more than is showing: "7 of 7 rows" is noise.
  assert.match(table, /data\.total > data\.rows\.length/);

  // Counted inside a LIMIT, so the cost is bounded whatever the collection's
  // size — the count is either exact or "at least ten thousand".
  const routes = codeOf(new URL('../../server/src/http/collections.ts', import.meta.url));
  assert.match(routes, /LIMIT \$\{COUNT_CEILING \+ 1\}/);
  // With the filters and no sorts: a sort binds a parameter that appears in
  // ORDER BY and not in WHERE, and reusing the row query's parameters made
  // Postgres refuse the count outright.
  assert.match(routes, /const countQuery = buildViewQuery\(\s*\n\s*chosen \?/);
});

test('a board column does not understate its cards in silence', () => {
  // A board groups the rows it is given, which is now one page: a column
  // counting its cards counted the loaded ones — "Done: 4" while three hundred
  // exist — and an empty column said "nothing here yet" when the truth was
  // "nothing here yet of the first fifty" (ADR-0055).
  const board = codeOf(new URL('../src/components/CollectionBoard.tsx', import.meta.url));
  assert.match(board, /complete \? entries\.length : `\$\{entries\.length\}\+`/);
  assert.match(board, /!complete\s*\n?\s*\? t\('board\.noneLoaded'\)/);
  // And those three sentences were English in the JSX until now.
  assert.doesNotMatch(board, /'Nothing here yet\.'/);

  const table = codeOf(new URL('../src/components/CollectionTable.tsx', import.meta.url));
  assert.match(table, /complete=\{!data\.nextCursor\}/);

  // The gallery needed nothing: its empty state only shows when the *first*
  // page is empty, and an empty first page means an empty set.
  const gallery = codeOf(new URL('../src/components/CollectionGallery.tsx', import.meta.url));
  assert.match(gallery, /rows\.length === 0/);
  assert.doesNotMatch(gallery, /complete/);
});

test('a formula is written in a dialog, validated once, and its errors read', () => {
  // The server parses, resolves the names and refuses a formula that reads
  // another formula (ADR-0056). So the dialog does not pre-validate: one
  // validator, on the side that stores it, rather than two that can disagree
  // about what is allowed.
  const table = codeOf(new URL('../src/components/CollectionTable.tsx', import.meta.url));
  assert.match(table, /config: \{ formula: text \}/);
  // Kept open with the reason: a dialog that closes on a rejected formula loses
  // what somebody typed, and they retype it wrong the same way.
  assert.match(table, /setFormulaError\(err instanceof ApiError \? err\.code : 'network_error'\)/);
  assert.doesNotMatch(table, /parseFormula/);

  // Every code the server can answer with has a message, or `messageFor` shows
  // "unknown error" — which was true of the relation and rollup codes too until
  // this commit.
  const en = codeOf(new URL('../src/i18n/messages.en.ts', import.meta.url));
  for (const code of [
    'formula_invalid',
    'formula_unknown_field',
    'formula_reads_formula',
    'relation_without_target',
    'not_a_stored_field',
    'rollup_needs_a_field',
  ]) {
    assert.match(en, new RegExp(`'error\\.${code}':`), `${code} has a message`);
  }

  // One branch draws both kinds of derived cell: two would be the beginning of
  // a rollup that looks different from a formula for no stateable reason.
  const cell = codeOf(new URL('../src/components/CollectionCell.tsx', import.meta.url));
  assert.match(cell, /fieldType === 'rollup' \|\| field\.fieldType === 'formula'/);
  assert.match(cell, /t\(`formula\.error\.\$\{derived\.error\}` as MessageKey\)/);
});

test('a formula can be edited, in the dialog that writes one', () => {
  // Until this the column had to be removed and made again (ADR-0056). One
  // dialog for both, because they are the same decision typed into the same
  // field — two would drift the moment one gained the column list.
  const table = codeOf(new URL('../src/components/CollectionTable.tsx', import.meta.url));
  assert.match(table, /useState<'new' \| string \| null>\(null\)/);
  assert.match(table, /writingFormula && writingFormula !== 'new'/);
  // And it says which of the two it is, in the title and on the button.
  assert.match(table, /writingFormula === 'new' \? t\('formula\.write'\) : t\('formula\.edit'\)/);

  // The server re-checks on the way in, or the rule that forbids a formula
  // reading a formula would hold only when a column was created — the hole the
  // rollup rule had.
  const routes = codeOf(new URL('../../server/src/http/collections.ts', import.meta.url));
  assert.match(routes, /existing\?\.field_type === 'formula' &&\s*\n\s*!\(await formulaIsUsable/);
});

test('a search can be kept, and lives where searches are run', () => {
  // Under the empty field rather than in the sidebar: this is where somebody is
  // when they want to run one again, and a third sidebar section is a decision
  // about the sidebar rather than about searches (ADR-0050).
  const screen = codeOf(new URL('../src/components/Search.tsx', import.meta.url));
  assert.match(screen, /query === '' && saved\.length > 0 &&/);
  // Both the name and the query: a name is memorable and a query is readable,
  // and neither substitutes for the other.
  assert.match(screen, /className="saved-search-name"/);
  assert.match(screen, /className="saved-search-query"/);
  // Offered only when there is something to keep.
  assert.match(screen, /hasSearchCriteria\(parsed\) && !naming &&/);

  // Per person, and scoped to the workspace whose tags and people the filters
  // name.
  const migration = codeOf(new URL('../../../db/migrations/0042_saved_searches.sql', import.meta.url));
  assert.match(migration, /UNIQUE \(user_id, workspace_id, name\)/);
});

test('internal threads are one list with a word, and a reply goes to their own document', () => {
  // Not two tabs: somebody discussing a paragraph wants the discussion, and
  // splitting it by audience makes them look in two places for one
  // conversation (ADR-0057).
  const panel = codeOf(new URL('../src/components/CommentsPanel.tsx', import.meta.url));
  assert.match(panel, /internal && group\('comment\.open', internal\.open, internal, true\)/);
  assert.doesNotMatch(panel, /role="tablist"/);

  // The group carries the document a thread came from, because a reply to an
  // internal thread has to be written into the internal one — passing the
  // wrong set would write it where everybody can read it.
  assert.match(panel, /comments=\{source\}/);
  // Marked by a word, not a colour: a colour is a convention nobody has learnt
  // yet, and this is the one distinction here where being wrong is a
  // disclosure.
  assert.match(panel, /t\('comment\.internal'\)/);

  // Asked for only by a member: the server refuses a share session that room,
  // and asking anyway is an error frame on every page a guest opens.
  const app = codeOf(new URL('../src/App.tsx', import.meta.url));
  assert.match(app, /const canSeeInternal = !session\.user\.isGuest/);
  assert.match(app, /asInternalRequest\(pageId\)/);
});

test('a thread is internal or not when it is started, and never moved after', () => {
  // Moving one means copying it into the other document and deleting it here,
  // and the copy cannot take back what the guests who already synced the page
  // have. A control that appears to make a discussion private after the fact is
  // the most dangerous thing this feature could offer (ADR-0057).
  const panel = codeOf(new URL('../src/components/CommentsPanel.tsx', import.meta.url));
  assert.match(panel, /const into = startInternal && internal \? internal : comments;/);
  // No such control on an existing thread.
  assert.doesNotMatch(panel, /makeInternal|moveToInternal/);
  // Offered only when there is a document to write into: a choice with one
  // option teaches somebody the wrong thing about what they have.
  assert.match(panel, /\{internal && \(\s*\n\s*<label className="checkbox comment-internal-choice">/);
  // And forgotten when the page changes, rather than carried to another page.
  assert.match(panel, /setStartInternal\(false\);\s*\n\s*\}, \[pageId\]\)/);
});

test('the mail server is set in the administration area, and the password is not', () => {
  // The settings keys existed and the route accepted them, and no screen drew
  // them — so from an administrator's side they were environment-only whatever
  // the code said (ADR-0058).
  const admin = codeOf(new URL('../src/components/Admin.tsx', import.meta.url));
  for (const key of ['smtpHost', 'smtpPort', 'smtpSecurity', 'smtpUser', 'smtpFrom', 'emailDetail']) {
    assert.match(admin, new RegExp(`settings\\.${key}`), `${key} is on the screen`);
  }
  // Each says where its value came from, so an administrator can tell a value
  // they typed from one the environment set.
  assert.match(admin, /settingSources\['smtpHost'\]/);

  // The password is not there and must not become a setting: a secret in a
  // table is a secret in every backup (ADR-0024). The hint says where it lives
  // instead, because an administrator looking for the field deserves an answer
  // rather than an absence.
  assert.doesNotMatch(admin, /smtpPassword/);
  const en = codeOf(new URL('../src/i18n/messages.en.ts', import.meta.url));
  assert.match(en, /SONE_SMTP_PASSWORD/);

  // An empty host means no email, and the hint says so: a normal instance, not
  // a broken one, and nobody should learn that by watching a queue.
  assert.match(en, /'admin\.smtpHost\.hint':\s*\n?\s*'Empty means no email/);
});

test('the settings section the mail links to exists', () => {
  // The unsubscribe line in every notification email is
  // `/settings/notifications`, and I wrote that before there was a section
  // behind it — a link in a message that cannot be recalled, pointing at
  // nothing (ADR-0058).
  const settings = codeOf(new URL('../src/components/Settings.tsx', import.meta.url));
  assert.match(settings, /\{ id: 'notifications', label: 'you\.notifications'/);
  assert.match(settings, /current === 'notifications' && <NotificationSettings/);

  const mail = codeOf(new URL('../../server/src/mail/compose.ts', import.meta.url));
  assert.match(mail, /\/settings\/notifications/);

  // Saved on change rather than behind a button: a tick that needs confirming
  // is a tick somebody leaves half-set.
  /*
   * That the screen actually offers control over those mails — the *promise*,
   * not the widget.
   *
   * This asserted `save({ emailMentions: event.target.checked })` and failed
   * when the three ticks and the separate schedule became one select per kind
   * (ADR-0061 amendment). It was right to fail: it was pinning a shape rather
   * than a guarantee, which is a test that makes an improvement look like a
   * regression.
   */
  assert.match(settings, /save\(\{ \[field\]: chosen \}\)/);
  for (const field of ['mentionsWhen', 'assignmentsWhen', 'repliesWhen']) {
    assert.match(settings, new RegExp(`'${field}'`), `${field} is on the screen`);
  }

  // And the screen says what a mail contains, which is what somebody deciding
  // this wants to know and which nothing else tells them.
  assert.match(settings, /t\('you\.notifications\.contents'\)/);
});

test('a failed send counts against the all-clear', () => {
  // A panel that says "nothing is wrong" while mail is failing teaches an
  // operator not to read it (ADR-0058).
  const admin = codeOf(new URL('../src/components/Admin.tsx', import.meta.url));
  assert.match(admin, /\(counts\.failedMail \?\? 0\) === 0/);
  assert.match(admin, /t\('admin\.anomaly\.mail'\)/);

  // And the explanation names the likely cause and says the notifications
  // themselves are not lost — which is the fact that stops somebody hunting.
  const en = codeOf(new URL('../src/i18n/messages.en.ts', import.meta.url));
  assert.match(en, /'admin\.anomaly\.mail\.explain':[\s\S]{0,400}wrong password/);
  assert.match(en, /'admin\.anomaly\.mail\.explain':[\s\S]{0,400}still have their notifications/);
});

test('a commented canvas item is marked, and an internal one says so in words', () => {
  // The canvas received no threads at all, so a commented item looked exactly
  // like an uncommented one and the only way to find a discussion was the
  // panel. That is a gap in ADR-0046, and it is why ADR-0057 could defer "the
  // canvas draws its own marks" — there were none.
  const canvas = codeOf(new URL('../src/components/CanvasSurface.tsx', import.meta.url));
  assert.match(canvas, /className="canvas-comment-mark"/);
  // The count of internal ones is in the label, not only in a colour: the same
  // rule as the panel, and for the same reason.
  assert.match(canvas, /t\('canvas\.commentedInternal'/);
  assert.match(canvas, /aria-label=\{/);
  // And the internal variant differs by more than colour, so it is not a
  // convention somebody has to have learnt.
  assert.match(css, /\.canvas-comment-mark\[data-internal='true'\] \{[^}]*box-shadow/s);

  // Counted in one place from both documents: handing the canvas two lists to
  // reconcile would put the distinction in a third.
  const view = codeOf(new URL('../src/components/PageView.tsx', import.meta.url));
  assert.match(view, /add\(itemThreads \?\? \[\], false\);\s*\n\s*add\(internalItemThreads \?\? \[\], true\);/);
  // Resolved threads carry no mark: a settled discussion is not a task.
  assert.match(view, /if \(!thread\.item \|\| thread\.resolved\) continue;/);
});

test('the formula field completes names, and Escape does not lose the formula', () => {
  const table = codeOf(new URL('../src/components/CollectionTable.tsx', import.meta.url));

  // The list comes from core beside the parser, and from this collection's own
  // stored columns — so a suggestion cannot be something the server would
  // refuse, like another formula (ADR-0056).
  assert.match(table, /import \{ applyCompletion, completions \} from '@sone\/core'/);
  assert.match(table, /\.filter\(\(one\) => one\.fieldType !== 'formula'\)/);

  // Two Escape stages: one that closed the list and the dialog together would
  // lose a typed formula because a suggestion happened to be open.
  assert.match(table, /if \(event\.key === 'Escape'\) \{[\s\S]{0,300}setSuggestion\(-1\);/);

  // Enter accepts a suggestion only while the list is open, so the key that
  // finishes a formula does not depend on what happens to be showing.
  assert.match(table, /event\.key === 'Enter' && suggestion > -1/);

  // Mouse *down*, because a click would move focus out of the field and the
  // list would be gone before it fired.
  assert.match(table, /onMouseDown=\{\(event\) => \{/);

  /*
   * There is no assertion here about the absence of syntax highlighting.
   *
   * I wrote one against the comment that explains it, and `codeOf` strips
   * comments by design — these guards read code, not prose. A test that asserts
   * a comment's wording is a test that fails when somebody rewords it, which
   * teaches people not to improve comments. The decision lives in ADR-0056.
   */
});

test('the mail settings are their own section, with a test that names the relay´s answer', () => {
  const admin = codeOf(new URL('../src/components/Admin.tsx', import.meta.url));

  // Its own section: the six mail fields arrived in the middle of the general
  // settings and read as a continuation of "who may sign up" (ADR-0058).
  assert.match(admin, /<h2>\{t\('admin\.mail'\)\}<\/h2>/);
  // And the mail fields are inside it rather than above it.
  assert.ok(
    admin.indexOf("t('admin.mail')") < admin.indexOf("settings.smtpHost"),
    'the heading comes before the fields it heads',
  );

  // The relay's own words, not a paraphrase: "535 authentication failed" is the
  // answer and "sending failed" costs somebody an hour.
  assert.match(admin, /className="mail-test-reason">\{state\.why\}/);

  // To the administrator's own address, with no field for another: a form that
  // mails an arbitrary address is an open relay with a sign-in.
  const routes = codeOf(new URL('../../server/src/admin/routes.ts', import.meta.url));
  assert.match(routes, /SELECT email, display_name FROM users WHERE id = \$1/);
  assert.doesNotMatch(admin, /name="testAddress"|placeholder=\{t\('admin\.mail\.testTo'\)\}/);
});

test('the reset screen shows one answer, and its link appears only with a relay', () => {
  const auth = codeOf(new URL('../src/components/Auth.tsx', import.meta.url));

  // The same next screen whichever way the request went, including a network
  // failure: a screen that said "we sent you a mail" only for real addresses
  // would put back the oracle the route removed (ADR-0059).
  assert.match(auth, /\.then\(\(\) => setAsked\(true\)\)\s*\n?\s*(?:\/\/[^\n]*\n\s*)*\.catch\(\(\) => setAsked\(true\)\)/);

  // And the link is absent without a relay, because the reset is absent — a
  // link to a form that can only ever promise a mail nobody will send teaches
  // somebody to wait.
  assert.match(auth, /instance\.canResetPassword === true &&/);

  // The token lands before the sign-in screen: somebody arriving from a mail
  // must not be shown a form for the password they are replacing.
  const app = codeOf(new URL('../src/App.tsx', import.meta.url));
  assert.ok(
    app.indexOf("route.kind === 'reset'") < app.indexOf('<LoginScreen'),
    'the reset route is checked first',
  );
});

test('a comment that arrived by email says so, beside its author', () => {
  // Quote trimming is guesswork, so a reader should be able to tell that a
  // machine cut a reply rather than that a colleague wrote something strange
  // (ADR-0060).
  const panel = codeOf(new URL('../src/components/CommentsPanel.tsx', import.meta.url));
  assert.match(panel, /message\.via === 'email' &&/);
  // Beside the name, not under the text: it is a fact about the message and not
  // part of what was said.
  assert.ok(
    panel.indexOf("t('comment.viaEmail')") < panel.indexOf('className="comment-text"'),
    'the mark sits in the author line',
  );
  // And the extra marks appear only when they are true, or "trimmed" would be
  // on every emailed reply and stop meaning anything.
  assert.match(panel, /message\.trimmed === true &&/);
  assert.match(panel, /message\.hadAttachments === true &&/);

  // The reply settings sit under the mail ones, in the section that already
  // exists rather than a screen of their own.
  const admin = codeOf(new URL('../src/components/Admin.tsx', import.meta.url));
  assert.match(admin, /t\('admin\.replies'\)/);
  for (const key of ['imapHost', 'imapPort', 'imapUser', 'replyMailbox']) {
    assert.match(admin, new RegExp(`settings\\.${key}`), `${key} is on the screen`);
  }
  // The IMAP password is not a setting and must not become one.
  assert.doesNotMatch(admin, /imapPassword/);
  const en = codeOf(new URL('../src/i18n/messages.en.ts', import.meta.url));
  assert.match(en, /SONE_IMAP_PASSWORD/);
});

test('the QR code encodes the enrolment URI, and the drawing is ours', async () => {
  /*
   * Against the library's own encoder rather than against a snapshot: what
   * matters is that the modules drawn are the modules for *this* URI, and a
   * snapshot would pass just as happily for the wrong string (ADR-0063).
   */
  const { default: qr } = await import('qrcode-generator');
  const uri =
    'otpauth://totp/SONE:anna@example.org?secret=JBSWY3DPEHPK3PXP&issuer=SONE' +
    '&algorithm=SHA1&digits=6&period=30';
  const code = qr(0, 'M');
  code.addData(uri);
  code.make();

  // A real code has its finder pattern: a 7×7 square in the top-left corner.
  assert.equal(code.getModuleCount() >= 21, true);
  for (let at = 0; at < 7; at += 1) {
    assert.equal(code.isDark(0, at), true, 'the finder pattern is solid');
  }

  const settings = codeOf(new URL('../src/components/Settings.tsx', import.meta.url));
  // Ours, so the colours are the theme's and no credential screen carries
  // `dangerouslySetInnerHTML`.
  assert.match(settings, /code\.isDark\(row, column\)/);
  assert.doesNotMatch(settings, /createSvgTag|dangerouslySetInnerHTML/);
  // White in the SVG rather than left to the theme: a dark-mode code with
  // inverted colours is one many scanners refuse.
  assert.match(settings, /fill="#fff"/);
  // And the quiet zone the specification requires.
  assert.match(settings, /const quiet = 4;/);

  // The typed secret stays, because a QR that fails to render must not be the
  // only way in.
  assert.match(settings, /className="totp-secret"/);
});

test('the bell sits beside the star and is not the same act', () => {
  /*
   * The decision ADR-0064 turns on: a favourite is "I come here often",
   * watching is "tell me when this changes". They sit together because they are
   * the same shape of mark, and their titles are what keep them apart —
   * somebody who wanted a bookmark must not end up with mail.
   */
  const menu = codeOf(new URL('../src/components/EntryMenu.tsx', import.meta.url));
  assert.match(menu, /t\('entry\.watch'\)/);
  assert.match(menu, /t\('entry\.unwatch'\)/);
  // Two separate handlers, so no click can mean both.
  assert.match(menu, /onToggleFavourite\(node\.id, !isFavourite\)/);
  assert.match(menu, /onToggleWatch\(node\.id, isWatched !== true\)/);

  // Separate state too, rather than one hook answering two questions.
  const app = codeOf(new URL('../src/App.tsx', import.meta.url));
  assert.match(app, /useWatching\(workspaceId\)/);
  assert.match(app, /useFavourites\(workspaceId\)/);

  // The scope control only appears when the mail is on: a scope for a mail
  // nobody receives is a question about nothing.
  const settings = codeOf(new URL('../src/components/Settings.tsx', import.meta.url));
  assert.match(settings, /activity !== 'off' &&/);
  assert.match(settings, /save\(\{ digestScope: chosen \}\)/);
});

test('several files are packed into one archive, so one plan is confirmed', () => {
  /*
   * The dialog shows one plan, and that shape is what makes the confirmation
   * mean something. Four files become one upload rather than four plans to
   * approve — and rather than a multipart parser on the server.
   */
  const dialog = codeOf(new URL('../src/components/ImportDialog.tsx', import.meta.url));
  assert.match(dialog, /packStored\(entries\)/);
  assert.match(dialog, /multiple/);

  // A ZIP among several is refused rather than nested: an archive inside an
  // archive is not something the import unpacks, and dropping it quietly would
  // be worse than saying so.
  assert.match(dialog, /one_archive_at_a_time/);

  // And the packing is in core, where both sides can see it — the server's own
  // unzip is what reads it, and that round trip has its own test.
  assert.match(dialog, /from '@sone\/core'/);
});

test('the sidebar can be made wider, and remembers it', () => {
  /*
   * Because the tree's problem is space, not text. A title like
   * "02.03.2026 - 09:05 - Notiz" needs about 200px of label, and three levels
   * of nesting inside a 260px sidebar leave it 180.
   *
   * The clever alternatives are all worse and the reasons are in the hook: a
   * middle ellipsis throws away the date, which for date-prefixed titles is the
   * half that matters; wrapping doubles the height of a list of thirty of them;
   * and less indent per level makes the nesting unreadable, which is why the
   * notes are in a folder at all.
   */
  const hook = codeOf(new URL('../src/hooks/useSidebarWidth.ts', import.meta.url));
  assert.match(hook, /sone\.sidebarWidth/);
  // Bounded, and a stored value outside them is clamped rather than honoured.
  assert.match(hook, /MIN_SIDEBAR = 200/);
  assert.match(hook, /MAX_SIDEBAR = 520/);
  assert.match(hook, /clamp\(stored\)/);
  // Storage that refuses must not stop the sidebar rendering.
  assert.match(hook, /catch \{[\s\S]{0,200}return DEFAULT_SIDEBAR/);

  // The width is a variable the grid reads, with the default as its fallback.
  // The rail's fixed track sits before it in the template; what this checks is
  // that the sidebar's own track is still the variable and not the number.
  assert.match(
    css,
    /grid-template-columns:\s*var\(--rail-width\) var\(--sidebar-width, 260px\)/,
  );

  // The handle is a button, so it can be focused, and double-click resets —
  // which is what somebody will try.
  const sidebar = codeOf(new URL('../src/components/Sidebar.tsx', import.meta.url));
  assert.match(sidebar, /className="sidebar-resize"/);
  assert.match(sidebar, /onDoubleClick=\{resetWidth\}/);
  // And it is absent where the sidebar is an overlay rather than a column.
  assert.match(css, /@media \(max-width: 799px\) \{\s*\.sidebar-resize \{ display: none; \}/);
});

test('the workspace list is one list, and the server decides its length', () => {
  /*
   * The list lived inside the administration, which is why a member had no
   * list at all and could edit only the workspace they happened to be looking
   * at (ADR-0067).
   */
  const menu = codeOf(new URL('../src/components/AccountMenu.tsx', import.meta.url));
  const list = codeOf(new URL('../src/components/WorkspaceListScreen.tsx', import.meta.url));
  const admin = codeOf(new URL('../src/components/AdminScreen.tsx', import.meta.url));

  // Reachable without any right — as one entry, now among the places rather
  // than in the account menu (ADR-0068). The right it does not need is what
  // this asserts; which list it is in is not the point.
  const places = codeOf(new URL('../src/components/modes.tsx', import.meta.url));
  assert.match(places, /href: paths\.workspaces\(\)/);
  assert.doesNotMatch(menu, /href=\{paths\.workspaces\(\)\}/);
  /*
   * And *not* also as a second entry for the current one.
   *
   * I wrote the opposite assertion yesterday, on the strength of the record
   * saying the shortcut stays. Both entries at once made the menu worse rather
   * than better, which is what the report said — so the shortcut is the first
   * row of the list instead, and the record is amended.
   */
  assert.doesNotMatch(menu, /href=\{paths\.workspaceSettings\(\)\}/);

  // The list opens a workspace, and the administration no longer holds one.
  assert.match(list, /paths\.workspaceSettings\('general', id\)/);
  assert.doesNotMatch(admin, /WorkspaceList/);

  /*
   * Sections carry the workspace. Without this, opening somebody else's and
   * clicking a section would quietly jump to your own.
   *
   * The menu that draws them has moved twice: into the shell (ADR-0069), and
   * then out of the settings list into the Workspaces mode, where the chooser
   * above it says which workspace the rows are about (ADR-0070). The guarantee
   * is the same one either way, so it is asserted where the rows are built.
   */
  const panel = codeOf(new URL('../src/components/WorkspacePanel.tsx', import.meta.url));
  assert.match(panel, /paths\.workspaceSettings\(section, workspaceId\)/);
  // And never the id-less form, which means "whichever one I am in" — a row
  // whose destination changes under it.
  assert.doesNotMatch(panel, /paths\.workspaceSettings\(\)/);
});

test('the workspace screen has a name for a workspace the session does not carry', () => {
  /*
   * Before, a foreign one read "Untitled" with everything greyed out. The list
   * route is scoped by the same rights, so asking it asks the one source that
   * already knows.
   *
   * **The strictness half of this test has moved** to
   * `workspaceRights.test.ts` (ADR-0102). It asserted the source read
   * `const canEdit = … || manages;`, and that line is now a call to
   * `mayEditWorkspace` — the rule came out into a module of its own the way
   * `entryRights.ts` did, because the browser had to start asking for a named
   * right rather than comparing a word.
   *
   * Which is the third time a source-text assertion here has broken on a change
   * that left its subject intact (ADR-0095 moved two). A test of the source
   * checks *where* a rule is written; the rule is what anybody cares about.
   * Kept here only for this one, which is genuinely about a call being made at
   * all rather than about what it decides.
   */
  const screen = codeOf(
    new URL('../src/components/WorkspaceSettingsScreen.tsx', import.meta.url),
  );
  assert.match(screen, /api\s*\n?\s*\.adminWorkspaces\(\)/);
});
