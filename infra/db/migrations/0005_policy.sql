-- 0005_policy.sql — BE-104 用量规则中央化
-- apps/api 当前落 state.json；真实 PG 路线接入时使用本表作为 policy_kv 真理源。

BEGIN;

CREATE TABLE IF NOT EXISTS policy_kv (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO policy_kv (key, value, updated_by)
VALUES
  ('DAILY_FREE_ROUND_LIMIT', '20'::jsonb, 'system'),
  ('REGISTER_CANDLE_GRANT', '100'::jsonb, 'system'),
  ('SURVEY_MIN_DWELL_SECONDS', '5'::jsonb, 'system'),
  ('CONTEXT_COMPRESS_TOKEN_LIMIT', '8000'::jsonb, 'system'),
  ('KEY_SENTENCE_PAUSE_MS', '700'::jsonb, 'system'),
  ('IF_DAILY_REDEEM_LIMIT', '3'::jsonb, 'system')
ON CONFLICT (key) DO NOTHING;

COMMIT;
