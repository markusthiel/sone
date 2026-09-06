# ADR-0132: The mark, in a mail

## Status

Accepted. Built. Asked for. Closes the item ADR-0121 opened and ADR-0123 was
supposed to enable; merges the brand package that had been sitting on a branch.

## Context

> Wir haben jetzt übrigens eine Menge Grafik und Logo Dateien. Sind die schon
> eingebaut? Auch in die Mails sollte das Logo rein. […] Diese Instanz, bei den
> Settings, Da kann das volle Logo rein. Sämtliche Mails.

**They were not.** `brand/` — the lockups, the signet, the icon set, the social
cards, the print files, the office templates, and the generator that produces all
of them from `Logo.tsx` and `styles.css` — sat on a branch one commit ahead of
main and sixty-four behind. Nothing in the running product used any of it, and
the icon set in `public/` was still the four files hand-written before it
existed.

And ADR-0121, on its own wordmark:

> The wordmark is text until an instance has a logo of its own to inline — which
> is the branding step in the concept, and this is what it will hook into.

ADR-0123 built that logo. The hook was never made.

## Decisions

### The brand package is merged, not re-created

One merge, and nothing in it is maintained by hand: the generator reads the
mark's geometry out of the component that draws it and the colours out of the
token table, so the package cannot drift from the interface. Changing the mark
means regenerating, never redrawing.

### `cid:`, and the rule that made it wait

ADR-0121 refused remote images and refuses them still: one tells the sender when
a mail was opened and roughly from where, and this project does not measure that
(ADR-0058). A `cid:` names an attachment travelling in the same message —
nothing is fetched, and nobody learns anything.

**The nesting is the decision.** `multipart/related` holds the message *and the
pictures it names*; `multipart/alternative` holds the two renderings of the
message. They go that way round: the alternatives are alternatives to each
other, and the picture is an alternative to nothing. Inside out, a client offers
the logo as a second version of the mail.

Two boundaries, both random and distinct — a part ends at *its own* boundary, and
a shared string would end both at once.

A mail with no picture keeps exactly the shape it had. An attachment nobody
refers to shows up in some clients as a paperclip and a file to download.

### On a pale chip

A client in dark mode darkens the paper by the `prefers-color-scheme` block and
**cannot recolour a picture**. So the mark sits on a pale chip that stays pale in
both, and the light build — dark bars, the accent green — is legible either way.

### The bytes are a module, not a file

`tsc` emits JavaScript and copies nothing, so a PNG beside the source would exist
in the repository and not in the image. A path that resolves in development and
not in the container is the kind of failure that reaches production, and a mail
is where it would be noticed last. Six kilobytes of PNG, base64 in a module,
generated and never edited.

### One `deliver`, because there were four copies

Four call sites built the same four lines, and the picture would have been four
more — with a letter carrying a mark from three senders and not the fourth,
which is exactly the drift ADR-0121 built one structure to prevent.

The instance's own logo where it has one, SONE's otherwise, read per send. **A
failure to read it is not a failure to send**: the mark is decoration and the
letter is the message, and a storage hiccup must not swallow somebody's password
reset.

### The lockup is set, not drawn

On the instance's own administration screen, where the subject *is* this
software, the full horizontal lockup: the mark plus the wordmark in Archivo at
600 with the brand package's tracking.

Set rather than drawn as paths. The delivered files convert the wordmark to
outlines because **a file cannot assume a font**; inside the application the font
is one of the two this instance serves itself (ADR-0068), so setting it is the
same wordmark and not a second drawing of it — and it follows the theme, which a
path cannot.

An instance with a logo of its own gets that logo and **its own name**. Putting
"SONE" beside somebody else's mark would be this software signing their
letterhead.

## Consequences

**Three send tests, one letter test, two web tests**, plus the icon test the
merge brought with it.

**Every mail this instance sends now carries a mark** — the sixteen letters built
between ADR-0058 and ADR-0130, without one of them changing, because they are all
one structure.

**`favicon.ico`, the maskable icons and an OG image exist now.** A bookmark bar
asks for `/favicon.ico` by path whether it is declared or not, and a 404 there is
a blank page icon.

**Still open:** the letters are English only, which is now the last thing left
over from the whole run of mail work.

## Alternatives considered

**A remote image.** One line, no MIME, and every reader of every mail reported to
whoever hosts it. Refused for notifications in ADR-0058 and nothing about a logo
changes the argument.

**Read the PNG from disk at send time.** Natural, and it works until the first
container build.

**Draw the wordmark as paths in the component.** It would match the delivered
files exactly and stop following the theme — a black wordmark on a dark screen —
and it would be the one thing in this whole package that *was* redrawn by hand.

**Put the lockup in the rail.** The rail is 56px of column and the mark alone is
what fits; a wordmark there is a wordmark cropped.

**Send both a light and a dark logo and let the client choose.** Mail clients do
not honour `<picture>` or `prefers-color-scheme` on an image. The chip is the
version that works everywhere.
