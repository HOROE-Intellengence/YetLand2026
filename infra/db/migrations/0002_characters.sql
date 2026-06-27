-- 0002_characters.sql — 角色卡 DB 化（BE-101）
-- 0001_init.sql 里已有 characters 基础字段（id/slug/name/rarity/price_candle/prompt_card_key/style_tags/is_active）
-- 这里补齐运营要在 #characters 面板里能改的字段：开场白 / 默认 boundary / 禁用语 / 描述 / updated_at
-- 同时把 prompt_card_key 改成可空（DB 化之后角色卡不再强依赖 yaml 文件）

BEGIN;

ALTER TABLE characters
  ADD COLUMN IF NOT EXISTS opening_first_visit  text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS opening_return_visit text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS boundary_default     smallint NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS forbidden_phrases    text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS description          text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS updated_at           timestamptz NOT NULL DEFAULT now();

ALTER TABLE characters
  ALTER COLUMN prompt_card_key DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'characters_boundary_default_chk'
  ) THEN
    ALTER TABLE characters
      ADD CONSTRAINT characters_boundary_default_chk
        CHECK (boundary_default BETWEEN 1 AND 5);
  END IF;
END $$;

COMMIT;
