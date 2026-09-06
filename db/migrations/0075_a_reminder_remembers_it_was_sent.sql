-- SONE 0075 — a reminder remembers that it was sent.
--
-- Three of the six mails proposed beside ADR-0121 are not sent when something
-- happens; they are sent when something has *failed* to happen for long enough:
--
--   an invitation nobody redeemed
--   a guest link about to expire
--   a run of mail that did not go out
--
-- The maintenance job runs every five minutes (ADR-0005), so each of them is
-- true for days at a stretch. Without somewhere to record that a letter has
-- already gone, "an invitation nobody redeemed after three days" is a letter
-- every five minutes for as long as nobody redeems it.
--
-- ## One table rather than a column per kind
--
-- `invitations.reminded_at` and `share_tokens.expiry_warned_at` would each be a
-- column on a table that is otherwise about something else, and the third has no
-- row of its own to hang a column on at all. A reminder is its own fact — this
-- was said, about that, once — and the fourth one will not need a migration.
--
-- ## Claimed before the send, not after
--
-- The insert happens first and the letter goes out only if it inserted. A send
-- that then fails is not retried, and that is the right way round: at most once
-- beats possibly for ever, and the thing being missed is a reminder rather than
-- the event it is about. The alternative — send, then record — turns one relay
-- timeout into a mail every five minutes until it stops timing out.
--
-- ## `subject_id` is a uuid and not a foreign key
--
-- It names an invitation, a share token, or — for the run of failed mail — the
-- newest failed job the report covered, which is what makes a *later* outage a
-- different subject. Three parents cannot be one reference, and a row left
-- behind by a deleted subject is harmless: it says a letter was sent, which
-- stays true.

BEGIN;

CREATE TABLE reminders (
  kind        text        NOT NULL,
  subject_id  uuid        NOT NULL,
  sent_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, subject_id)
);

COMMENT ON TABLE reminders IS
  'One row per reminder already sent, claimed before the send (ADR-0129).';

INSERT INTO schema_migrations (version) VALUES ('0075_a_reminder_remembers_it_was_sent');

COMMIT;
