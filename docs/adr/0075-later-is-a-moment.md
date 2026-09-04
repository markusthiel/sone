# ADR-0075: Later is a moment

## Status

Accepted. Stage four of ADR-0069, second half. The other half of that stage —
answering a notification without leaving the inbox — is not here; the last
section says why.

## Context

The inbox had two answers to a row: open it, or mark it read. Neither is what
somebody means about half of what arrives. "Not now" is the commonest reaction
to a notification, and with no way to say it the only ways to act on one are to
deal with it immediately or to leave it sitting there unread — which is how an
inbox becomes a list of things nobody reads any more, and how the count on the
account becomes a number people stop believing.

## Decision

**Asleep is a moment, not a flag.** `notifications.snoozed_until` holds a
timestamp; a notification is asleep while that moment is in the future. Nothing
wakes it — the clock passing the moment is the entire mechanism. There is no job
to run, nothing to miss a tick, and no stored state that can be out of step with
the time.

**The browser decides when "later" is.** "Tomorrow morning" is a question about
the clock on somebody's desk, and the browser is standing next to it. The server
would have to reconstruct the same answer from a stored timezone that can be
wrong, absent, or a week out of date because somebody travelled. So the client
computes an absolute moment and sends it whole; the server checks only that it
is in the future and at most a year away — a year is where "put this aside"
stops meaning that and starts meaning "delete it without saying so".

**Three times, and each one shows its date.** In three hours, tomorrow morning,
next week. Three hours rather than "this evening", because somebody clearing an
inbox at nine at night does not mean eight tonight and a choice that lands in
the past for half the day has to be explained. Tomorrow is always tomorrow, even
at two in the morning: "tomorrow" said at 02:00 means the day that has not
started yet in every sense except the calendar's. Next week is the Monday after
this one, never today, because the point of the choice is that the week in front
of you is spoken for. Each choice shows the moment it means, because "tomorrow
morning" is a promise and the date is what makes it one somebody can check.

**One rule for where a sleeping row appears**, stated once in the function the
menu and the list share: absent from every view except "Später", which lists
them, and "Alles", which is called Alles. It is out of the account's count for
the same reason — a badge that keeps counting what somebody deliberately put
aside is a badge they stop believing, and that is the one thing this number must
not become.

**A sleeping row offers one act: waking it.** Reading or unreading something you
put off until Tuesday is a decision about a row you deliberately stopped looking
at. It says when it comes back in place of when it arrived, because that is what
it is about now.

`s` on the keyboard takes tomorrow morning — the commonest of the three — rather
than opening the menu. A shortcut that opens a menu has saved nobody anything,
and the other two times are one click away on the same row.

## Consequences

`useDismiss` came out of this. The snooze menu would have been the third copy of
"close on an outside press or Escape, and put the focus back", and a fourth copy
is where one of them quietly loses the Escape key and nobody notices for a
month — which is exactly what the sidebar's old account menu had done. The
account menu and the workspace switcher use the hook now too.

### What is not here: answering from the inbox

Comments live in the page's Yjs document, not in a table. Replying from the
inbox therefore means writing into a document from outside its sync room, and
the server can do that — `applyToDocument` already does it when an entry is
restored. But a room loads its document once and tracks its own sequence; it
does not learn about appends made outside it. Restoring works because an
archived page has no room open. A reply does not have that luxury: the page is
very often open somewhere, and the reply would land in the store and not appear
until somebody reloaded.

So the first thing an inline reply needs is not a reply endpoint. It is for a
room to notice that its document was written to from outside — and that is a
decision about the sync layer, with its own consequences for every other
server-side write, so it gets its own record rather than being smuggled in under
a text box.
