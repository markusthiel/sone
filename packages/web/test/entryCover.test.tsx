/**
 * A cover above the heading (ADR-0117).
 *
 * Asked for as a header picture on a page and on a folder, *„nur eigene Bilder,
 * kein Unsplash"*, with a colour or a gradient as the alternative and the
 * control appearing *„beim Drüberfahren"*.
 *
 * Mounted, because the three things that could quietly go wrong are all about
 * what is on the screen: that somebody who may not edit is offered nothing,
 * that the control is reachable without a pointer, and that a picture is an
 * `<img>` rather than a CSS background built out of a document value. A source
 * assertion can see each of those written down and none of them happening.
 *
 * What a cover may *be* is decided in `@sone/core`'s `cover.test.ts`, and the
 * route half is in `api.db.test.ts`.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { JSDOM } from 'jsdom';

import { codeOf, stylesOf } from './helpers/source.ts';

let dom: JSDOM;
let act: <T>(fn: () => T | Promise<T>) => Promise<void>;
let container: HTMLElement;
let render: (element: unknown) => Promise<void>;
let cleanup: () => void;

const GLOBALS = [
  'window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement',
  'DocumentFragment', 'Range', 'getComputedStyle', 'MutationObserver',
  'Event', 'MouseEvent', 'PointerEvent', 'KeyboardEvent', 'TouchEvent',
  'requestAnimationFrame', 'cancelAnimationFrame',
] as const;

const FILE = '/api/files/6f1c9e2a-0000-4000-8000-00000000abcd';

/** Every cover the picker asked for. */
let chosen: Array<unknown> = [];

describe('the cover above a heading', () => {
  before(async () => {
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
      pretendToBeVisual: true,
      url: 'http://localhost/',
    });
    const win = dom.window as unknown as Record<string, unknown>;
    if (!win['PointerEvent']) win['PointerEvent'] = win['MouseEvent'];
    for (const key of GLOBALS) {
      const value = win[key];
      if (value === undefined) continue;
      try {
        Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
      } catch {
        // Some globals are getter-only on the Node global.
      }
    }
    (globalThis as Record<string, unknown>)['IS_REACT_ACT_ENVIRONMENT'] = true;

    const { createRoot } = await import('react-dom/client');
    const react = await import('react');
    act = react.act as never;
    container = dom.window.document.getElementById('root') as unknown as HTMLElement;
    const root = createRoot(container);
    render = async (element) => {
      await act(async () => {
        root.render(element as never);
      });
    };
    cleanup = () => root.unmount();
  });

  after(() => {
    cleanup?.();
    dom?.window.close();
  });

  async function mount(cover: unknown, { mayEdit = true } = {}): Promise<void> {
    chosen = [];
    const { createElement } = await import('react');
    const { EntryCoverHead } = await import('../src/components/EntryCover.tsx');
    // Unmounted first: the picker's open state lives in the component, so a
    // second mount over a live one would inherit the previous test's.
    await render(null);
    await render(
      createElement(
        EntryCoverHead as never,
        {
          cover,
          pageId: 'p1',
          ...(mayEdit ? { onChange: (next: unknown) => chosen.push(next) } : {}),
        },
        createElement('h1', { className: 'page-title' }, 'Konzept'),
      ),
    );
  }

  const buttonSaying = (text: string): HTMLButtonElement | undefined =>
    [...container.querySelectorAll('button')].find(
      (one) => (one.textContent ?? '').trim() === text,
    ) as HTMLButtonElement | undefined;

  const click = async (element: Element): Promise<void> => {
    await act(async () => {
      element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });
  };

  test('a page with no cover keeps its heading, and offers one', async () => {
    // „Standard bleibt wie bisher, wenn nichts gesetzt ist." Nothing is drawn
    // above the heading until somebody chooses something.
    await mount(null);

    assert.equal(container.querySelector('.entry-cover'), null, 'no band');
    assert.ok(container.querySelector('.page-title'), 'and the heading is still there');
    assert.ok(buttonSaying('Cover'), 'with a way to add one');
  });

  test('somebody who may only read is offered nothing at all', async () => {
    /*
     * The rule the folder view already states about its rename field and its
     * three create buttons: a caller with nothing to offer passes no handler,
     * so there is nothing on screen to press. A share-link visitor is the case
     * this protects — and the one that produced „der Ordner wird als Seite
     * dargestellt auf die man schreiben kann" the last time it was missed.
     */
    await mount({ kind: 'color', color: 'blue' }, { mayEdit: false });

    assert.ok(container.querySelector('.entry-cover'), 'the cover is still drawn');
    assert.equal(container.querySelectorAll('button').length, 0);
  });

  test('the controls are in the document rather than summoned by a pointer', async () => {
    /*
     * They are revealed by opacity, not by mounting on hover. jsdom has no
     * hover and no stylesheet, so what is asserted is the half that matters
     * for a keyboard: the buttons exist and can be reached by Tab. A control
     * that is mounted on `onMouseEnter` cannot be, and removing a cover would
     * then be impossible without a mouse.
     */
    await mount({ kind: 'color', color: 'blue' });

    const buttons = [...container.querySelectorAll('.entry-cover-actions button')];
    assert.equal(buttons.length, 2, 'change and remove');
    for (const button of buttons) {
      assert.notEqual(
        (button as HTMLElement).tabIndex,
        -1,
        'reachable by Tab, not skipped',
      );
    }
  });

  test('a picture is an img, not a background built from the document', async () => {
    // `background-image: url(…)` means assembling CSS out of a value a client
    // wrote. An `<img src>` is escaped by React and can carry alternative text.
    await mount({ kind: 'image', url: FILE });

    const image = container.querySelector('img.entry-cover-image') as HTMLImageElement | null;
    assert.ok(image, 'drawn as an image');
    assert.equal(image.getAttribute('src'), FILE);
    const band = container.querySelector('.entry-cover') as HTMLElement;
    assert.doesNotMatch(band.getAttribute('style') ?? '', /url\(/);
  });

  test('a colour and a gradient are painted, and say which they are', async () => {
    await mount({ kind: 'color', color: '#112233' });
    let band = container.querySelector('.entry-cover') as HTMLElement;
    assert.equal(band.dataset['kind'], 'color');
    assert.match(band.getAttribute('style') ?? '', /#112233|rgb\(17, 34, 51\)/);

    await mount({ kind: 'gradient', from: 'blue', to: 'purple' });
    band = container.querySelector('.entry-cover') as HTMLElement;
    assert.equal(band.dataset['kind'], 'gradient');
    assert.match(band.getAttribute('style') ?? '', /linear-gradient/);
  });

  test('choosing a colour reports the cover, not a class name', async () => {
    await mount(null);
    await click(buttonSaying('Cover')!);

    const swatches = container.querySelectorAll('.entry-cover-swatch');
    assert.ok(swatches.length >= 8, 'the workspace palette, and gradients under it');
    await click(swatches[0]!);

    assert.deepEqual(chosen, [{ kind: 'color', color: 'grey' }]);
    assert.equal(container.querySelector('.entry-cover-picker'), null, 'and it closes');
  });

  test('and there is a way back to no cover at all', async () => {
    // There was none for a long time in the inbox, for the same shape of
    // reason: every state was reachable except the one somebody starts in.
    await mount({ kind: 'color', color: 'blue' });
    await click(buttonSaying('Remove')!);

    assert.deepEqual(chosen, [null]);
  });

  /*
   * How wide it runs and how tall it is (ADR-0162).
   *
   * *„Ich könnte mir zb vorstellen dass das Titelbild auch über die ganze
   * breite geht. Und vielleicht noch 3 Möglichkeiten was die Höhe angeht."*
   *
   * Mounted for the same reason the rest of this file is: what is asserted is
   * that a choice reaches the document unchanged and that the default leaves
   * nothing behind — a source test would see both spellings written down.
   */
  test('a cover nobody has adjusted says nothing about its shape', async () => {
    await mount({ kind: 'image', url: FILE });
    const band = container.querySelector('.entry-cover') as HTMLElement;
    assert.equal(band.dataset['width'], undefined, 'no width attribute');
    assert.equal(band.dataset['height'], undefined, 'no height attribute');
  });

  test('and one that has, carries both on the band', async () => {
    // On the band rather than in a style attribute: the sizes are a decision
    // the stylesheet makes, and three heights spelled out in a component are
    // three numbers nobody can find from the CSS.
    await mount({ kind: 'image', url: FILE, width: 'full', height: 'tall' });
    const band = container.querySelector('.entry-cover') as HTMLElement;
    assert.equal(band.dataset['width'], 'full');
    assert.equal(band.dataset['height'], 'tall');
  });

  test('the two rows are offered once there is a cover, and not before', async () => {
    // The width of nothing is nothing. On a page with no cover the picker is
    // how one is chosen, and two rows of shape settings above that are two
    // questions about a thing that does not exist yet.
    await mount(null);
    await click(buttonSaying('Cover')!);
    assert.equal(container.querySelector('.entry-cover-shape'), null);

    await mount({ kind: 'color', color: 'blue' });
    await click(buttonSaying('Change cover')!);
    assert.equal(container.querySelectorAll('.entry-cover-shape').length, 2, 'width and height');
  });

  test('choosing a width keeps the cover it is the width of', async () => {
    await mount({ kind: 'image', url: FILE });
    await click(buttonSaying('Change cover')!);
    await click(buttonSaying('Full page')!);

    assert.deepEqual(chosen, [{ kind: 'image', url: FILE, width: 'full' }]);
  });

  test('the width row is three steps, widest last (ADR-0163)', async () => {
    // Column, the page, and the page including the strip the bar sits on. One
    // row rather than a second setting: „bis oben" is the widest of three
    // steps, not a second question about the same picture.
    await mount({ kind: 'image', url: FILE });
    await click(buttonSaying('Change cover')!);

    const row = container.querySelectorAll('.entry-cover-shape')[0];
    assert.deepEqual(
      [...(row?.querySelectorAll('button') ?? [])].map((b) => (b.textContent ?? '').trim()),
      ['Column', 'Full page', 'Edge to edge'],
    );

    await click(buttonSaying('Edge to edge')!);
    assert.deepEqual(chosen, [{ kind: 'image', url: FILE, width: 'bleed' }]);
  });

  test('and choosing the default takes the field back out', async () => {
    /*
     * Absent rather than `width: 'column'`, which is how `template` and
     * `locked` say the same thing. A value written in for the default is a
     * cover that claims a decision nobody made — and it would make every cover
     * on the instance differ from every cover written before this round.
     */
    await mount({ kind: 'image', url: FILE, width: 'full', height: 'tall' });
    await click(buttonSaying('Change cover')!);
    await click(buttonSaying('Column')!);

    assert.deepEqual(chosen, [{ kind: 'image', url: FILE, height: 'tall' }]);
  });

  test('the current choice says it is the current one', async () => {
    // `aria-checked` on a radio, the shape the block menu's own width row uses.
    // A row of buttons where the chosen one is only a shade darker is a row a
    // screen reader reads as four identical buttons.
    await mount({ kind: 'image', url: FILE, height: 'slim' });
    await click(buttonSaying('Change cover')!);

    assert.equal(buttonSaying('Slim')?.getAttribute('aria-checked'), 'true');
    assert.equal(buttonSaying('Medium')?.getAttribute('aria-checked'), 'false');
  });

  test('Escape closes the picker without choosing anything', async () => {
    // A panel that only closes by choosing something is a panel somebody has to
    // choose their way out of.
    await mount(null);
    await click(buttonSaying('Cover')!);
    assert.ok(container.querySelector('.entry-cover-picker'));

    await act(async () => {
      dom.window.document.dispatchEvent(
        new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    });

    assert.equal(container.querySelector('.entry-cover-picker'), null);
    assert.deepEqual(chosen, []);
  });
});

/*
 * The sizes themselves, read from the stylesheet (ADR-0162).
 *
 * jsdom applies no stylesheet, so the mounted tests above can only say that the
 * band carries the right attribute. What that attribute *does* is here, and the
 * measurement that neither can make is in the ADR: a full-width cover was drawn
 * in Chromium and its edges compared with the page's.
 */
describe('what the shape settings draw', () => {
  const css = stylesOf(new URL('../src/styles.css', import.meta.url));

  test('three heights, and three different ones', () => {
    // Read as a custom property since ADR-0163: a band that runs up under the
    // bar has to add the bar's height to its own, and `calc()` cannot add to a
    // value it has to re-derive from a selector.
    const heights = ['slim', 'medium', 'tall'].map((name) => {
      const rule = new RegExp(`\\.entry-cover\\[data-height='${name}'\\][^{]*\\{([^}]*)\\}`).exec(css);
      assert.ok(rule, `${name} has a rule`);
      const size = /--cover-block-size:([^;]+);/.exec(rule[1] ?? '');
      assert.ok(size, `${name} sets a height`);
      return (size[1] ?? '').trim();
    });
    assert.equal(new Set(heights).size, 3, 'three names, three heights');
  });

  test('and the middle one is what a cover has always been', () => {
    // „Wenn nichts gesetzt ist, soll alles so aussehen wie bisher" is the
    // sentence this feature was built under (ADR-0117), and it now has to hold
    // across a round that gives the band a setting. So the unset band and the
    // one that says `medium` are the same clamp, written once.
    assert.match(
      css,
      /\.entry-cover,\s*\n\.entry-cover\[data-height='medium'\] \{[^}]*--cover-block-size: clamp\(120px, 20vh, 210px\)/s,
    );
  });

  test('full width is measured against the page, not the window', () => {
    /*
     * `100cqw` against `.main`'s container, the arithmetic a full-width block
     * already uses. `100vw` is the *window* — sidebar included — which is how a
     * full-width block once pushed the whole page sideways.
     *
     * And no text-indent correction here: that half-indent belongs to the
     * editor's own left padding, and a cover sits in a symmetrically padded
     * page body. Copying it would push the band half an indent off centre.
     */
    const rule = /\.entry-cover\[data-width='full'\],\n\.entry-cover\[data-width='bleed'\] \{([^}]*)\}/.exec(css);
    assert.ok(rule, 'there is a rule');
    assert.match(rule[1] ?? '', /margin-inline: calc\(50% - 50cqw\)/);
    assert.match(rule[1] ?? '', /inline-size: 100cqw/);
    assert.doesNotMatch(rule[1] ?? '', /text-indent/);
  });

  test('and a band with no ends does not draw any', () => {
    // The rule a full-width block states about itself: a rounded corner or a
    // border is what tells you where a thing ends, and a band running to both
    // edges of the page has no ends to mark.
    const rule = /\.entry-cover\[data-width='full'\],\n\.entry-cover\[data-width='bleed'\] \{([^}]*)\}/.exec(css);
    assert.match(rule?.[1] ?? '', /border-radius: 0/);
    assert.match(rule?.[1] ?? '', /box-shadow: none/);
  });

  test('nothing breaks out on a narrow screen', () => {
    // There is no margin to break into, and doing it anyway pushes the page
    // sideways — the same clause the blocks have, for the same reason.
    assert.match(
      css,
      /@media \(max-width: 720px\) \{[^}]*\.entry-cover\[data-width='full'\],\n\s*\.entry-cover\[data-width='bleed'\] \{[^}]*margin-inline: 0/s,
    );
  });
});

/*
 * And up under the top bar (ADR-0163).
 *
 * *„Eine weitere Einstellung dass das Titelbild bis oben zum Seitenrand läuft.
 * Das hat zur Folge das die buttons für die Seitenleisten und das Synced und die
 * User-Kürzel dann im Bild stehen. Die könnte man dann abheben mit den selben
 * Flächen, die man beim Hover auf der schmalen Leiste hat."*
 *
 * All of it is in the stylesheet and none of it in a component: the bar is
 * rendered by `App` and the cover by `PageView`, two siblings that would
 * otherwise have to agree about a value one of them owns. `:has()` reads the
 * live document instead, which cannot go stale.
 */
describe('a cover that runs to the top edge', () => {
  const css = stylesOf(new URL('../src/styles.css', import.meta.url));

  test('the bar declares a height instead of happening to have one', () => {
    // The band is pulled up by exactly this, so it cannot be a number somebody
    // measured once: the next control added to the bar would make the offset
    // silently wrong. Declared, and enforced on the bar itself.
    assert.match(css, /--topbar-block-size:\s*\d+px/);
    assert.match(css, /\.topbar \{[^}]*min-block-size: var\(--topbar-block-size\)/s);
  });

  test('the band grows by what it swallows, so nothing below it moves', () => {
    /*
     * Up by the bar *and* the page body's own top padding, and taller by the
     * same two — otherwise the heading under the picture jumps up when the
     * setting is turned on, which is a setting that moves the text somebody
     * was reading.
     */
    const rule =
      /\.topbar \+ \.page-body > \.entry-head:first-child \.entry-cover\[data-width='bleed'\] \{([^}]*)\}/.exec(
        css,
      );
    assert.ok(rule, 'there is a rule');
    assert.match(
      rule[1] ?? '',
      /margin-block-start: calc\(\(var\(--topbar-block-size\) \+ var\(--page-body-block-start\)\) \* -1\)/,
    );
    assert.match(
      rule[1] ?? '',
      /block-size: calc\(var\(--cover-block-size\) \+ var\(--topbar-block-size\) \+ var\(--page-body-block-start\)\)/,
    );
  });

  test('and only when nothing stands between the bar and the page', () => {
    /*
     * `.topbar + .page-body`, so a banner — a stale bundle, a two-factor
     * deadline — takes the bleed off by existing. A picture reaching the window
     * edge is worth less than a sentence saying your browser is running an old
     * build, and no component has to know about the other for this to be true.
     */
    assert.match(css, /\.topbar \+ \.page-body > \.entry-head:first-child/);
    assert.doesNotMatch(css, /\.main \.entry-cover\[data-width='bleed'\] \{/);
  });

  test('the bar goes transparent over it, and fills again on the first scroll', () => {
    // The behaviour the bar has had since ADR-0042 — no fill until something is
    // above the fold — doing exactly the right thing here for free.
    assert.match(
      css,
      /\.main:not\(\[data-scrolled='true'\]\):has\(\s*\.topbar \+ \.page-body > \.entry-head:first-child \.entry-cover\[data-width='bleed'\]\s*\)\s*\.topbar \{[^}]*background: transparent/s,
    );
  });

  test('the picture is only pulled up when it is the first thing in the body', () => {
    /*
     * Reported: *„wenn die linke seitenleiste ausgeblendet wird, das bild nicht
     * mehr bis ganz zum oberen rand geht. Es entsteht ein Abstand."*
     *
     * Hiding the sidebar makes a page draw its breadcrumb, which was the page
     * body's first child — so the band started a breadcrumb's height too low,
     * because the arithmetic that pulls it up is only true when nothing is
     * above it. The trail moved under the cover (ADR-0164); this is the guard
     * that says so, for whatever somebody puts there next.
     */
    assert.match(
      css,
      /\.topbar \+ \.page-body > \.entry-head:first-child \.entry-cover\[data-width='bleed'\]/,
    );
  });

  test('and every control in it brings its own ground', () => {
    /*
     * The half that is not decoration. `readableInk` decides ink against a
     * known ground, and a photograph has none — it is dark on one side and
     * light on the other. An opaque chip under each control puts a known ground
     * back, which is the same pairing `contrast.test.ts` already governs
     * everywhere else.
     */
    const rule =
      /:has\(\s*\.topbar \+ \.page-body > \.entry-head:first-child \.entry-cover\[data-width='bleed'\]\s*\)\s*\.topbar\s*:where\([^)]*\)\s*\{([^}]*)\}/.exec(
        css,
      );
    assert.ok(rule, 'the controls get a surface');
    assert.match(rule[1] ?? '', /background: var\(--surface-hover\)/);
    assert.match(rule[1] ?? '', /color: var\(--text-primary\)/);
  });
});

/*
 * The two buttons on the picture (ADR-0164).
 *
 * Reported together with the gap above: *„Außerdem lässt sich der Titelbild
 * ändern Button und der daneben zum entfernen nicht mehr korrekt anklicken. Es
 * scheint vor allem verschoben zu sein."* Both halves were true, and the
 * clicking half was true whether or not the sidebar was showing — toggling it
 * only moved them far enough to notice.
 */
describe('the controls on a cover that left the column', () => {
  const css = stylesOf(new URL('../src/styles.css', import.meta.url));

  test('they follow the picture rather than the reading column', () => {
    // They are positioned against `.entry-head`, which *is* the column, so on a
    // band running to the page's edges they sat ten pixels inside the column's
    // right edge — in the middle of the picture. The same breakout the band
    // uses puts them back on its corner.
    assert.match(
      css,
      /\.entry-cover\[data-width='full'\] ~ \.entry-cover-actions\[data-over='cover'\] \{[^}]*inset-inline-end: calc\(10px \+ 50% - 50cqw\)/s,
    );
  });

  test('and they sit below the bar, which owns that strip', () => {
    /*
     * The bar is a full-width sticky element at `z-index: 5`. A bleeding band
     * starts underneath it, so the buttons at ten pixels from the top were
     * inside the bar's box: visible, and every click landing on the bar.
     *
     * Moved rather than raised above it — lifting them would put them over the
     * bar's own controls in the same corner, and the answer to who owns the top
     * strip is the bar.
     */
    assert.match(
      css,
      /\.entry-cover\[data-width='bleed'\] ~ \.entry-cover-actions\[data-over='cover'\] \{[^}]*inset-block-start: calc\(var\(--topbar-block-size\) \+ 10px\)/s,
    );
  });
});

/*
 * Where the trail sits (ADR-0164).
 *
 * A source test, for the one thing a source test is right for: *where*
 * something is written. What it does is measured in a browser — the ADR has the
 * numbers.
 */
describe('the breadcrumb, and the cover above it', () => {
  const page = codeOf(new URL('../src/components/PageView.tsx', import.meta.url));
  const folder = codeOf(new URL('../src/components/FolderView.tsx', import.meta.url));

  test('there is one breadcrumb, not one per screen', () => {
    // The older copy said so itself: „the same markup a folder's own trail
    // uses, so the two do not drift apart". They drifted the moment the trail
    // had to move, because moving it meant moving it twice.
    for (const [name, source] of [['PageView', page], ['FolderView', folder]] as const) {
      assert.doesNotMatch(source, /className="breadcrumb"/, `${name} draws its own`);
      assert.match(source, /<Breadcrumb trail=\{trail\} \/>/, `${name} uses the one`);
    }
  });

  test('and it is inside the heading region, under the cover', () => {
    // Above it, the trail was the page body's first child and pushed a
    // bleeding cover down by its own height.
    for (const [name, source] of [['PageView', page], ['FolderView', folder]] as const) {
      const head = source.indexOf('<EntryCoverHead');
      const crumb = source.indexOf('<Breadcrumb');
      assert.ok(head > 0 && crumb > head, `${name}: the trail is inside the head`);
    }
  });
});
