# ADR-0147: An invitation says what it is

## Status

Accepted. Built. Closes the second half of the iPad report; the first half is
ADR-0146.

## Context

> Bei Einladungen stehen auch die verbrauchten drin, macht das Sinn? Auch die
> Anzahl macht momentan keinen Sinn glaube ich, aber das kann man eventuell noch
> gebrauchen wenn man zb beim erstellen der Einladung auch eine maximale Anzahl
> an Nutzungen vergibt? Wenn ich nur einen Link anlege mit Einladung kommt
> übrigens 25 als zahl. Das lässt sich noch nicht einstellen.

Three observations, and the last one explains the other two.

`createInvitation` read `Math.max(1, input.maxUses ?? 25)`. **Nobody chose
twenty-five.** There is exactly one caller of that function in the product — the
route behind this screen — and it passed nothing, so every link invitation ever
made on this instance was a link for twenty-five people, and the row printed
that figure as though somebody had typed it.

That is why the count reads as noise: it is a fact about a decision that was
never made. And it is why "0 of 25" on a link meant for one colleague is not a
cosmetic wrong — it is the screen reporting a capability the person did not
ask for and cannot see anywhere else.

The used-up rows are the other half, and the code had already written down the
right answer twice. `listInvitations`' own comment says the list is *"what
somebody can still act on"*; the panel's docstring calls itself *"invitations
that have been sent and not yet used up"*. Neither was true. `inspectInvitation`
has refused a spent invitation since it was written, so a listed one was never a
way in — it was a row saying otherwise.

## Decisions

### Used up is not outstanding

`listInvitations` takes a third condition beside revoked and expired. The
sentence was already there; this is the query catching up with it.

### One is the default, and anything else is a decision

`createInvitation` defaults `maxUses` to **1**. An invitation is for somebody;
a link for a group is a real and useful thing, and it is now said out loud
rather than assumed on everybody's behalf.

The form asks — a number beside the address field, offered **only when there is
no address**, because an addressed invitation is bound to that address and used
once whatever anybody sends. A control that cannot change anything is one
somebody sets and then wonders about, which is the argument ADR-0027 made about
the administrator checkbox and this screen had not been asked.

### The number is refused, not mended

`Math.max(1, …)` turned nonsense into one, a typo into a link for a thousand
people, and silence into twenty-five — three answers to a question nobody asked
twice. One predicate, `isUseCount`, is used by the route to refuse a request and
by the function to refuse a call, so the rule has one home rather than living in
a caller's head (ADR-0110).

`MAX_LINK_USES` is 1000: a bound rather than an opinion. A link is a credential
that can be forwarded, and a number nobody reads back is a crowd on a screen
that says nothing is wrong.

### The count is shown where it is a fact

With used-up ones gone, an invitation that may be used once is unused by
definition, so its cell is empty. Above one, the row says `2 of 5`, which is
what the reporter suggested the number could be for, and now is.

### And the panel stops denying a letter it just sent

> Copy it now … Send it to the person yourself; **this instance does not send
> mail.**

Printed unconditionally, on a route that has sent that invitation since ADR-0121
and **reports `mailed` for exactly this purpose** — a field the client's type
dropped. So on every instance with a relay, this screen denied a letter that had
just gone out.

**This is ADR-0139 again, one round after it was written down**, and found the
same way: by reading what the screen claims and asking who told it. The panel
says what happened now — the address it went to, or the sentence about copying
the link, with no claim about the instance either way.

## Consequences

**Fourteen tests, eleven red first.** Five on the screen (the field, its absence
for an address, the count, the German row, the mail sentence), six on the route
and the listing, and three on accepting.

**Two could not fail before and stay:** a partly used link is still listed, and
an addressed invitation is for one person whatever the form sends. They are what
this change could have broken.

### The twenty-five was hiding a bug

Changing the default to one turned an existing test red:

> accepting twice arrives rather than refusing

`acceptInvitation` has a branch for *already a member*, with a comment saying
somebody clicking their own link twice should arrive rather than be refused. On
a **single-use** link that branch cannot be reached: the lookup that guards it
does not find a spent invitation, so the second click answered "invalid or
expired" for an invitation that had worked perfectly. It only ever passed
because every link was silently made for twenty-five people. **Accidentally
right is not right** — ADR-0144's sentence, one round later, from the other
side.

So `inspectInvitation` can now be asked for a spent one (`spent: 'allow'`), and
`acceptInvitation` decides what that means: a spent link inserts nobody, and
answers *arrive* only for somebody who is already a member. Anybody else is
refused, and that refusal has its own test, **proved to bite** by removing it
and watching the test go red.

**Nine messages in both catalogues**, including the two English strings this
screen still had in its markup — the column heading `For` and the withdraw
button's label — which the guard misses for the reason ADR-0146 records.

## Alternatives considered

**Leave used-up ones in, greyed out.** The listing's own comment already
rejected that for withdrawn ones: a row that cannot be acted on invites the
question of whether it still works.

**Drop the count instead of making it mean something.** It is the answer to
"how many of the club have joined", which is the only question a multi-use link
raises. Dropping it would have removed the report's own suggestion.

**Keep a large default and let people lower it.** A default of twenty-five is a
decision about somebody else's instance, made by whoever typed `?? 25`.

**Clamp a bad number instead of refusing.** Silently giving somebody a link for
one person when they asked for a thousand, or for a thousand when they typed a
comma, is worse than an error — neither is visible afterwards.

**Ask `canSendMail` for the sentence about mail.** It is the right fact for a
screen that has not sent anything yet; here the request itself came back with
the answer for this particular invitation, which is narrower and truer.
