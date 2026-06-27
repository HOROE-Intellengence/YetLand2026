-- 0006_character_profile_sections.sql -- private prompt-only character profile sections
BEGIN;

ALTER TABLE characters
  ADD COLUMN IF NOT EXISTS profile_sections jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMIT;
