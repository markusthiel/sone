-- SONE 0074 — light and dark belong to a person, not to a browser.
--
-- Asked for with the branding step: *„hell/dunkel Standard, überschreibbar pro
-- Workspace und pro Nutzer"* — and the middle of those three already exists as
-- of ADR-0123, because a theme layers instance under workspace. What was
-- missing is the top: the person's own answer lived in `localStorage`, so
-- somebody who chose dark on their laptop signed in on their phone and got
-- light.
--
-- ## Why the column is nullable, and why 'system' is not the same as NULL
--
-- Four states are needed and only three are values:
--
--   NULL      whatever the workspace (and under it the instance) says
--   'system'  this device decides — a *choice*, and one that overrides a
--             workspace saying dark
--   'light'   / 'dark'
--
-- Collapsing NULL and 'system' costs exactly the case this is for. A workspace
-- set to dark, and somebody in it who wants their laptop's own setting to rule:
-- with three states they could only pick light or dark by hand, and would then
-- be wrong twice a day — which is what 'system' exists to avoid.
--
-- The same distinction `workspace_landing.mode` grew in 0073, for the same
-- reason: a per-person row is an override, and "no override" has to be sayable.
--
-- ## No default, and no backfill
--
-- Every existing account gets NULL, which resolves to 'system' where no
-- workspace and no instance has said otherwise — exactly what everybody has
-- today. Nothing anybody chose in a browser is read across: those values are in
-- `localStorage` on their own machines, and this migration cannot see them. The
-- interface keeps using the stored value as the answer for the first paint
-- until the account's own is known, so the change is invisible to somebody who
-- had already chosen.
--
-- The text scales stay in `localStorage` and get no column. The reasoning in
-- `useAppearance.ts` is right about them and wrong about the scheme: a text
-- size that suits a phone is wrong on a 27-inch monitor, while a preference for
-- dark follows a person between the two.

BEGIN;

ALTER TABLE users
  ADD COLUMN color_scheme text,
  -- Checked here as well as in the route, because this is the value the
  -- interface paints the whole screen from: a word from a future release stored
  -- by a client that guessed would be an account that cannot decide what colour
  -- it is.
  ADD CONSTRAINT users_color_scheme_known
    CHECK (color_scheme IS NULL OR color_scheme IN ('light', 'dark', 'system'));

COMMENT ON COLUMN users.color_scheme IS
  'light | dark | system, or NULL for "as the workspace says" (ADR-0124).';

INSERT INTO schema_migrations (version) VALUES ('0074_light_and_dark_belong_to_a_person');

COMMIT;
