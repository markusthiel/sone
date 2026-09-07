# ADR-0141: Every filter that is on has a control

## Status

Accepted. Built. Closes *„Mehr zeigen bei vielen Schlagwörtern"*, named as a gap
in ADR-0127 and left open since ADR-0120. Fixes a live fault in the folder
chooser that the same rule found one section down.

## Context

The search panel edits filters; the field edits a string; they are the same
search. Its own note says how the two meet:

> The filters are how somebody who does not know the syntax narrows a search;
> the field is how somebody who does types one in one go, and **pressing a
> control shows them what it would have looked like.**

That sentence has a reverse, and the panel did not keep it: **typing a filter
in did not show it as a control.** Which was invisible while every value the
panel knew about had a button — and stopped being invisible the moment a cut was
needed.

### The tag facet was every tag, as a button

Fine at ten. A wall at two hundred, which is the sentence ADR-0120 already wrote
one section down, about the member list:

> Every member was a row, which is fine at four and unusable at forty —
> *„die wird sonst irgendwann zu groß"*. A field that filters as you type has
> the same first keystroke either way and does not grow.

### And a cut, done plainly, breaks something

Two things, and neither is about length.

**The list arrives ordered by name.** `ORDER BY t.tag_key` — for a good reason
that is written down at the query: the first label in the sorted order becomes
the spelling shown, so the answer is stable rather than whichever row the
planner reached first. Taking the first twelve of *that* hides the tag on four
hundred pages for starting with a W.

**And a chosen tag can fall outside the cut.** The panel had already written the
rule, about people: *a filter you cannot see is a filter you cannot take off.*
The chip beside the results would still say the filter is on. A chip cannot
switch it off.

### The rule, applied backwards, found a fault that was already live

If what is on must have a control, then a filter the panel's list does not hold
must have one too. Three ways that happens for a tag: typed into the field; kept
in a saved search that outlived the tag, since a tag exists only because a page
carries it (ADR-0020); or carried only by pages this reader cannot see, since
the list is counted per caller. In all three the facet drew nothing.

Then the same question, asked of the folder chooser, and the answer was worse.

**Choosing "Finanzen" made the chooser say "Anywhere".** `in:` is a
case-insensitive name match, so the filter is stored lowercased — and the
options were spelt as the titles. `value="finanzen"` matched no option, and a
`<select>` with an unmatched value falls to its first entry. Measured, not
reasoned about: rendered with `in:finanzen` and a folder called Finanzen, the
chooser reports `selectedIndex: 0`, *"Anywhere"*.

So on the ordinary path — pick a folder from the chooser — the panel said the
search was not in a folder while the results beside it were, and while the chip
above them said which folder. **Two columns about one filter, disagreeing**,
which is how ADR-0139's inbox was found.

## Decisions

### What is on is drawn out of the query; the list decides only what else is offered

One sentence, and it is what all four fixes are.

The chosen tags come from `filters.tags`, resolved against the list where it
knows them and standing on their own where it does not. The folder chooser gets
an option for the name it is holding when no folder answers to it. The list is
consulted for what to *offer*, never for what to *show*.

### Twelve, by use, read alphabetically

**Which twelve is a question about use**; the counts are already on the wire.
**The order they are read in is a question about names**, so the twelve are
sorted back to alphabetical for drawing. Choosing by rank and reading by name
also keeps the list from reshuffling under somebody's eyes every time a page is
tagged.

### The rest are found by typing, not unfolded

The named gap said *„Mehr zeigen"*. A field is the better half of it: it answers
at three hundred tags the same way it answers at thirty, where "show more"
unfolds three hundred buttons into a sidebar. Two characters before anything is
offered, exactly as the people field does it and for its reason — *one letter
matching half a vocabulary is a list again* — and at most twelve offered, which
is **the facet's one number used twice**: how many short words can be read at a
glance is the same judgement whether they were chosen by use or by typing.

The field appears only when there is something behind it. Over two tags it would
be a control whose only purpose is to hide one of them.

### A tag the list does not hold has a name and no count

The count means *pages you can see carrying this*. For a tag the list does not
hold, that number is not zero — it is absent, and a zero would be an answer
where what we have is the lack of one. It keeps its colour, derived the way
`TagEditor` already derives one for a tag typed a moment ago, so the same word is
the same colour in both places.

### An untitled folder is not offered

`in:` narrows by name. The option for a folder with no name wrote an empty
filter, which the chooser reads as "Anywhere" — a third entry in the list that
did what the first one did.

## Consequences

**Eight tests. Six failed on the old code**, and four of those six report a
fault somebody could have hit: the twelve are the wrong twelve, the rest cannot
be reached, a tag the list has never heard of has no control, and the chooser
answers "Anywhere" about a search that is in a folder. The fifth and sixth are
the folder round trip re-asserted through the option's new value, and a name no
folder answers to.

**Two could not fail before, and stay.** *A handful of tags are all shown, and
nothing asks to be searched* — the shape the panel already had, which the cut
must not take away from the workspaces it was right for. And *a chosen tag is
shown whether or not it is one of the twelve*, which was free when everything
was shown and is the assertion the cut has to keep buying.

**The three folder tests were not part of the plan.** They are the rule turned
on its neighbour, and they found the only fault here that was live on a path
somebody uses daily.

**The fixture's counts rise as its names do**, so the alphabet and use disagree
in it. A fixture where they agree cannot tell a cut by use from a cut by
whatever arrived first.

**One class was proposed and removed.** The tag field was given
`search-facet-tag-find` so the tests could tell the two fields apart;
`stylesheet.test.ts` refused it, because a class in the markup with no rule
behind it is a hook pretending to be a style. The fields are told apart by what
they say they are — `aria-label` — which is what a screen reader uses too.

**Not done:** the panel still holds `filters.in[0]` and ignores a second `in:`.
The syntax allows two and the chooser is one control; making it several is a
different question from this one, and nothing here made it worse.

## Alternatives considered

**"Show more", as the gap was named.** Reveals the vocabulary, which a field
does not — and at three hundred tags it reveals three hundred buttons in a
column eight centimetres wide. The twelve most-used *are* the vocabulary in
practice, and the field's matches carry counts, so exploring by prefix still
works.

**Sort by count and leave it sorted.** The list would reorder itself between
visits as pages are tagged, and a control that moves is a control you have to
read every time.

**Order the tags by count on the server.** It would break the reason the current
order exists — the sorted key order is what makes the shown spelling stable — to
serve one of three readers. Display order is the client's question.

**Let the cut hide a chosen tag and rely on the chip.** The chip says a filter is
on and cannot take it off, so the panel would be sending people to the search
field to delete a word.

**Fix the folder chooser by lowercasing the title in the option's label.** The
label is what a person reads; the value is what the query stores. Making the two
the same string is what caused this.

**Leave the folder chooser out of this round.** It is one line of the same rule,
it is live on the ordinary path, and a record that found it and left it would be
the kind of record ADR-0139 had to go back and correct.
