# ADR-0200: The menu is asked first, and puts the caret down

## Status

Accepted. Built. Corrects the plugin order ADR-0085 and ADR-0173 were arranged
under, and a gap in `runSlashItem`.

## Context

Both of these came back from SOTE, which carries a copy of `packages/editor` and
found them there. That is worth naming at the top: the copy is three days old
and has already been the more careful of the two.

**The `/` menu never got Enter.** It was registered *after* `soneKeymap`, with a
comment saying that is what lets its `handleKeyDown` see Enter and the arrows
"first". The opposite is true. `EditorView.someProp` walks
`state.plugins` in array order and returns at the first plugin whose prop
answers, so a plugin at the back of the array is asked *last*:

```js
for (let i = 0; i < plugins.length; i++) {
  let prop = plugins[i].props[propName];
  if (prop != null && (value = f ? f(prop) : prop)) return value;
}
```

The arrows worked, which is why this survived: the keymap binds no arrow key, so
nothing ahead of the menu claimed them. Enter it does bind. So with the menu
open and an item highlighted, Enter split the block, the item was never run, and
the typed `/tabelle` stayed in the text as four ordinary words.

The report SOTE got was not "Enter does nothing" — it was *„da steht ein Text
hochkant"*, the placeholder of the paragraph the split had just created. A
keyboard fault arriving as a layout complaint is the normal case, not the
exception.

**An inserted block left the caret behind.** `runSlashItem` has three branches.
The two that convert a block both set a selection; the one that *inserts* — a
table, a divider — set none. So a table appeared and the next keystroke went
wherever the caret happened to be, which in testing was the bottom-right cell.
There is no reasoning recorded for the asymmetry, and its two neighbours
disagree with it, so it reads as an omission rather than a decision.

## Decision

**`slashMenu`, `mentionMenu` and `pageLinkMenu` move ahead of
`keymap(tableKeymap)` and `soneKeymap`.** While one of them is open it answers
Enter, Tab, the arrows and Escape; closed, it returns false in one comparison
and everything behind it is reached as before.

Tab now reaches the slash menu before the table keymap does. That is wanted: a
menu open inside a table cell should pick an item, not jump to the next cell,
and the menu answers Tab only while it is open.

**The insert branch sets the caret** with `TextSelection.near` from inside the
new node — the first cell of a table, the line after a divider.

**`continueAfterSote` keeps precedence** for an embedded SOTE block: it puts the
caret on the blank line *after* the block, which is the point of that
continuation and not where `near` would land. It already returns whether it
acted, so the new line is only taken when it did not.

## Consequences

- Any plugin added after this that wants a key while a menu is open has to be
  placed ahead of the menus. That is now the rule the order expresses, and the
  comment says which way round it runs, with the loop quoted.
- The comment that was wrong was wrong for months and read as authoritative,
  because it explained itself. A comment that gives a reason is trusted more
  than one that does not — so the reason has to be checked, not admired.

## What was not done

**The copy.** These two fixes, and `autoLink` going the other way, all had to be
carried by hand between two copies of the same package, of which 18 of 22 files
differ only in an import path. Nothing here fixes that; the shape of it is
written down in `claude/editor-kopie-sone-sote.md`.
