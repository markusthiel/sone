-- Which of the two requirement mails somebody has had (ADR-0065).
--
-- Recorded rather than inferred from dates: a sweep that runs twice in an hour,
-- or after a clock change, must not send twice. Two mails and not five is a
-- decision, and it only holds if "already sent" is a fact rather than an
-- estimate.
BEGIN;

CREATE TABLE IF NOT EXISTS requirement_mails (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- 'announced' when the requirement appeared, 'warned' three days before the
  -- deadline.
  stage   text NOT NULL CHECK (stage IN ('announced', 'warned')),
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, stage)
);

INSERT INTO schema_migrations (version) VALUES ('0054_requirement_mails')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
