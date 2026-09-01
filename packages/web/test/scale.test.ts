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

  const up = canvas.slice(canvas.indexOf('const onSurfaceUp'));
  // The write is now multi-line because the stroke carries the chosen ink, so
  // this reads the call across lines rather than as one.
  assert.match(up.slice(0, 800), /addItem\(doc, \{[\s\S]{0,120}kind: 'path'/);
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
  assert.match(icon, /kind === 'canvas'\) return <PenIcon \/>/);
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
  assert.match(canvas, /\[\.\.\.items\]\.reverse\(\)\.find\(\(item\) => within\(item, point\)\)/);
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
  assert.match(menu, /\['canvas', 'canvas\.new', PenIcon\]/);

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
