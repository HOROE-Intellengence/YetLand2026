-- 0008_user_preference_category.sql - classify preference rows for deterministic consolidation.
BEGIN;

ALTER TABLE user_preferences
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'other';

DO $$
BEGIN
  ALTER TABLE user_preferences
    ADD CONSTRAINT user_preferences_category_chk
    CHECK (category IN ('address', 'boundary', 'preference', 'fact', 'relationship', 'other'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS user_preferences_user_category_updated_idx
  ON user_preferences (user_id, category, updated_at);

COMMIT;
