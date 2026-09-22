# ADR-0193: Looking at one picture, and watching the bytes go

## Status

Accepted. Built.

## Context

Three reports on one afternoon, all about the same block from different sides.

> Ich habe gerade ein Bild in den Editor hinzugefügt über das /-Menü. Wir hatten
> doch schon eingebaut, dass Bilder in einem Modal aufgehen. Das geht jetzt in
> einem neuen Fenster auf.

**There was never a modal.** `FileNodeView.link()` has set `target="_blank"` since
it was written, and its own comment says why: "a new tab rather than the same
one: this is a page somebody is writing in, and navigating away from it to look
at an attachment is a way to lose your place." That reasoning is right about the
problem and wrong about the answer — a new tab *is* navigating away, just in a
second window, and it arrives with no name, no size and no way back except
closing it. The memory of a modal was a memory of the PDF viewer (ADR-0048),
which is the one thing here that already refused to hand a file to the browser.

> Außerdem erscheint es nicht in der Seitenleiste. Zumindest wenn ich es als
> Karte oder Zeile einbinde. Wenn ich es als richtiges Bild einbinde sehe ich es
> auch in der Leiste. Das ist für mich ein Bug.

It is. Choosing "card" or "line" for an image **converts the block** — that is
ADR-0159's arrangement, and a good one: an image is a file with a special way of
being looked at, so the three layouts are the file block's rather than drawn
twice. But `readDocAssets` collected images by `block.type === 'image'`. So the
same upload, shown smaller, left the picture list. The list had already learnt
this lesson once, for a picture on a board: *"a panel that omits something the
page is carrying reads as a broken panel."* It was applied to the canvas and not
to the block next door.

> Ich habe gerade ein MP4 Video hochgeladen, da tut sich einfach nichts und auf
> einmal ist dann der Player erschienen. Da brauchen wir auch einen Ladebalken.

A sentence *was* set — `setNotice('Uploading …')`, added the last time this was
reported. It is drawn in `.editor-notice`, above the editor. A page is written at
its bottom, so the message was two screens up. And it carried no number, because
`fetch` with a `File` body reports nothing at all until it is finished.

## Decision

**One modal for one picture or one video**, in `mediaModal.ts`: a native
`<dialog>` appended to `document.body`, with the file's name, a download and a
close in a bar over it. `showModal()` gives the backdrop, the focus trap, Escape
and inertness — four things that were each a bug waiting in a hand-built overlay,
and the reason this does not reuse the React `.dialog-scrim`.

It opens from an image shown as a card or a line, and from an **uploaded** video
shown as a card or a line. Not from an embed's card: that goes to the provider's
page, because the provider's player is the only thing allowed to play it, and not
from a stream, which has no card at all (ADR-0037).

**The address stays on the link; only the default is prevented.** ⌘-click,
middle-click and "open in new tab" go on working, and a reader who wants the file
itself still has it. Dropping the `href` would have been one line shorter and
would have taken those three with it.

**A picture held as a file block is in the picture list**, with `asFile` saying
so. The flag is not decoration: for these the panel *opens* the picture instead
of scrolling to it, because there is a block to jump to and nothing to look at
once you are there — the page holds a card naming the file. A row that promises
"show me where" and delivers a filename is the same broken promise as omitting it.
A picture still uploading has no address and stays out of the grid; it is in the
files list, where "uploading" is already said.

**The upload reports its progress, which makes it an `XMLHttpRequest`.** One
request in `client.ts` is now written unlike every other, and the comment there
says why: streaming request bodies exist but need HTTP/2, a duplex flag and a
fallback for the browsers without them — three moving parts to learn what
`upload.onprogress` has said everywhere for fifteen years. The strip that shows it
is **sticky under the topbar**, reading `--topbar-block-size` rather than
repeating 52 (ADR-0163), and it is indeterminate until the first event: a bar at
zero claims to know that nothing has gone out yet, and we do not know that. When
the bytes are gone it goes to 100% rather than sitting at 98% while the server
thinks — a bar frozen short of the end reads as a stall. It is cleared in a
`finally`, because a strip left under an error claims the upload is still running.

## Consequences

- Two node views now import a module that touches `document.body`. Both were
  already building DOM by hand (ADR-0041), so this adds no new kind of coupling —
  but it is the first thing a node view puts *outside* its own element.
- jsdom has no `<dialog>`: no `showModal`, no `close`, no backdrop. The module
  falls back to setting `open` rather than throwing, which is honest about the
  environment and keeps a `TypeError` out of a click handler inside the editor —
  the failure mode that takes React's boundary and the whole surface with it.
- The picture list can now contain two rows for one upload if somebody attaches
  the same file twice in two shapes. That is two blocks, so two rows is right.
- `uploadFile` no longer goes through `fetch`, so anything stubbing `fetch` in a
  test of an upload stubs the wrong thing. One test had to learn this, and its
  replacement drives the progress events instead — which is the part worth
  driving.

## What was not done

**A gallery.** Arrow keys between the pictures of a page, from inside the modal,
is the obvious next thing and is a different feature: it needs an order, and the
order of pictures in a document that has a canvas is not obvious.

**The image block itself.** Clicking a picture that is shown *as* a picture still
does nothing, and opening the modal there would be a second meaning for a click
that currently selects the block (ADR-0171). Worth doing; not worth deciding
alongside three bug reports.

---

## Nachtrag: „irgendwie fehlt da optisch was" (dieselbe Runde, eine Stunde später)

Es ging auf, und es sah nach nichts aus. Drei Fehler, alle im Aufbau, keiner in
der Mechanik.

**Der Dialog ist der ganze Bildschirm.** Leiste und Bild lagen direkt darin, also
stand der Dateiname in der äußersten linken oberen Ecke, Herunterladen und
Schließen in der rechten, und das Bild schwebte irgendwo dazwischen — drei Dinge
auf dunklem Grund statt eines Gegenstands.

`inline-size: fit-content` auf einer Hülle darum ist die naheliegende Reparatur
und **tut es nicht**: ein Hochformat wird von der Höhe unter der Leiste
beschränkt, nicht von seiner eigenen Breite, also maß die Hülle 900px um ein
Bild, das 459px breit gezeichnet wurde. Gemessen in Chromium, 1400 × 900:

| | Leiste | Bild |
|---|---|---|
| `fit-content`, Hochformat | 569 … 831 | 700 … 700 *(0 breit, Messfehler)* |
| `fit-content`, Hochformat, geladen | 250 … 1150 | 467 … 933 |
| **Band, Hochformat** | **100 … 1300** | 471 … 930 |
| **Band, Querformat** | **100 … 1300** | **100 … 1300** |

Die letzte Zeile ist das Argument: bei einem Querformat liegen Leiste und Bild
exakt übereinander, weil beide dieselbe Spalte von `min(1200px, 100%)` nehmen.
Bei einem Hochformat ist die Leiste breiter — aber ein Band liest sich als
Werkzeugleiste, und eine Leiste von willkürlicher dritter Breite liest sich als
Fehler.

**Die Knöpfe waren keine.** `.btn` steht im Stylesheet als `button.btn`, also bekam
das Herunterladen — ein `<a>` — den Zeiger und sonst nichts: ein blanker blauer
Link neben einem Kasten. Und beide stehen auf fast schwarzem Grund, wo die
Knopffarben der Seite in beiden Themes die falschen sind. Eigene Regel,
durchscheinendes Weiß.

**Der Fokus saß auf dem Herunterladen.** Ein modaler Dialog schiebt den Fokus auf
das erste bedienbare Element darin; beim Öffnen lag also ein Ring um
„Herunterladen", als sei der Knopf im Begriff gedrückt zu werden. Jetzt trägt die
Hülle `tabindex="-1"` und `autofocus` — als Attribut, nicht als Eigenschaft: die
spiegelt nur in neueren Engines und tut sonst stillschweigend nichts.

**Und das Bild hat eine Kante.** Ein dunkles Foto auf dunklem Grund hörte
nirgends sichtbar auf. Ein Haarstrich Licht per `outline` (kein `border`, der
rechnet mit; kein zweiter `box-shadow`, den gehört der Schattentoken, ADR-0132).

Zwei Wächter haben dabei mitentschieden, beide zu Recht: Schatten sind Token,
keine Literale — und eine zweite Regel für `.media-modal-body video` ist derselbe
Selektor zweimal, also hat der Player jetzt eine eigene Klasse statt eines
Nachtrags.
