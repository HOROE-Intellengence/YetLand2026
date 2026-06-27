-- 0001_init.sql — 第一版完整 schema
-- 同步自 infra/db/schema.sql。后续结构变更不要改本文件，新建 0002+ 迁移
-- 所有 CREATE 用 IF NOT EXISTS 保证可重入

BEGIN;

-- ─── users / auth ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id              text PRIMARY KEY,
  phone           text UNIQUE NOT NULL,
  age_verified    boolean NOT NULL DEFAULT false,
  narrative_boundary smallint NOT NULL DEFAULT 2,
  if_unlocked     boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_flags (
  user_id         text PRIMARY KEY REFERENCES users(id),
  if_unlocked     boolean NOT NULL DEFAULT false,
  if_unlocked_at  timestamptz,
  if_source       text,
  admin_note      text
);

-- ─── billing ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS subscriptions (
  id              text PRIMARY KEY,
  user_id         text NOT NULL REFERENCES users(id),
  plan            text NOT NULL CHECK (plan IN ('moonlight','milkyway','eternal')),
  cycle           text NOT NULL CHECK (cycle IN ('week','month')),
  status          text NOT NULL CHECK (status IN ('active','canceled','past_due','grace')),
  current_period_end timestamptz NOT NULL,
  gateway_subscription_id text,
  gateway_event_id text UNIQUE
);

CREATE TABLE IF NOT EXISTS candle_balance (
  user_id         text PRIMARY KEY REFERENCES users(id),
  balance         integer NOT NULL DEFAULT 0,
  last_topup_at   timestamptz
);

CREATE TABLE IF NOT EXISTS candle_ledger (
  id              text PRIMARY KEY,
  user_id         text NOT NULL REFERENCES users(id),
  delta           integer NOT NULL,
  reason          text NOT NULL,
  ref_id          text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, reason, ref_id)
);

CREATE TABLE IF NOT EXISTS conversation_quota (
  user_id         text NOT NULL REFERENCES users(id),
  date            date NOT NULL,
  free_round_limit integer NOT NULL DEFAULT 20,
  free_round_used integer NOT NULL DEFAULT 0,
  bonus_round_limit integer NOT NULL DEFAULT 0,
  bonus_round_used integer NOT NULL DEFAULT 0,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, date)
);

CREATE TABLE IF NOT EXISTS quota_ledger (
  id              text PRIMARY KEY,
  user_id         text NOT NULL REFERENCES users(id),
  delta_rounds    integer NOT NULL,
  reason          text NOT NULL,
  ref_id          text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, reason, ref_id)
);

-- ─── characters / sessions ───────────────────────────────
CREATE TABLE IF NOT EXISTS characters (
  id              text PRIMARY KEY,
  slug            text UNIQUE NOT NULL,
  name            text NOT NULL,
  rarity          text NOT NULL CHECK (rarity IN ('free','paid','hidden')),
  price_candle    integer NOT NULL DEFAULT 0,
  prompt_card_key text NOT NULL,
  style_tags      text[] NOT NULL DEFAULT '{}',
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_character_unlocks (
  user_id         text NOT NULL REFERENCES users(id),
  character_id    text NOT NULL REFERENCES characters(id),
  source          text NOT NULL CHECK (source IN ('default','candle','achievement','if_unlock','admin')),
  unlocked_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, character_id)
);

CREATE TABLE IF NOT EXISTS conversation_sessions (
  id              text PRIMARY KEY,
  user_id         text NOT NULL REFERENCES users(id),
  character_id    text NOT NULL REFERENCES characters(id),
  mode            text NOT NULL CHECK (mode IN ('main','if')),
  stage           text NOT NULL DEFAULT 'daily',
  last_message_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ─── achievements ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS achievements (
  id              text PRIMARY KEY,
  slug            text UNIQUE NOT NULL,
  name            text NOT NULL,
  trigger_type    text NOT NULL,
  reward_candle   integer NOT NULL DEFAULT 0,
  unlock_character_id text,
  narrative_template_key text,
  cooldown_days   integer,
  is_active       boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS user_achievements (
  user_id         text NOT NULL REFERENCES users(id),
  achievement_id  text NOT NULL REFERENCES achievements(id),
  session_id      text,
  trigger_message_id text,
  reward_ledger_id text,
  unlocked_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, achievement_id)
);

-- ─── surveys ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS surveys (
  id              text PRIMARY KEY,
  title           text NOT NULL,
  reward_candle   integer NOT NULL DEFAULT 0,
  status          text NOT NULL CHECK (status IN ('active','inactive')),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS survey_questions (
  id              text PRIMARY KEY,
  survey_id       text NOT NULL REFERENCES surveys(id),
  type            text NOT NULL,
  title           text NOT NULL,
  options         jsonb,
  min_seconds     integer NOT NULL DEFAULT 5
);

CREATE TABLE IF NOT EXISTS survey_answers (
  id              text PRIMARY KEY,
  survey_id       text NOT NULL REFERENCES surveys(id),
  question_id     text NOT NULL REFERENCES survey_questions(id),
  user_id         text NOT NULL REFERENCES users(id),
  answer          jsonb NOT NULL,
  dwell_ms        integer NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS survey_completions (
  survey_id       text NOT NULL REFERENCES surveys(id),
  user_id         text NOT NULL REFERENCES users(id),
  reward_ledger_id text,
  completed_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (survey_id, user_id)
);

-- ─── if codes ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS if_codes (
  id              text PRIMARY KEY,
  code_hash       text UNIQUE NOT NULL,
  batch           text,
  source          text,
  max_redemptions integer,
  redeemed_count  integer NOT NULL DEFAULT 0,
  valid_until     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS if_unlocks (
  user_id         text NOT NULL REFERENCES users(id),
  character_id    text NOT NULL REFERENCES characters(id),
  state           text NOT NULL,
  source          text NOT NULL CHECK (source IN ('code','natural','admin')),
  code_id         text REFERENCES if_codes(id),
  entered_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, character_id)
);

-- ─── conversation logs ────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversation_logs (
  id              bigserial PRIMARY KEY,
  user_id         text NOT NULL REFERENCES users(id),
  session_id      text NOT NULL,
  character_id    text NOT NULL,
  mode            text NOT NULL CHECK (mode IN ('main','if')),
  stage           text NOT NULL,
  role            text NOT NULL CHECK (role IN ('user','assistant','system')),
  content         text NOT NULL,
  token_count     integer NOT NULL DEFAULT 0,
  model           text,
  cost_decimal    numeric(10,6),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS conversation_logs_user_idx ON conversation_logs (user_id, created_at);
CREATE INDEX IF NOT EXISTS conversation_logs_session_idx ON conversation_logs (session_id);

-- ─── cost ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cost_records (
  id              bigserial PRIMARY KEY,
  user_id         text NOT NULL,
  session_id      text NOT NULL,
  provider        text NOT NULL,
  model           text NOT NULL,
  input_tokens    integer NOT NULL,
  output_tokens   integer NOT NULL,
  cost_usd        numeric(10,6) NOT NULL,
  stage           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cost_records_user_idx ON cost_records (user_id, created_at);

-- ─── growth ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS growth_sources (
  id              text PRIMARY KEY,
  type            text NOT NULL CHECK (type IN ('koc','private_group','manual')),
  name            text NOT NULL,
  owner           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invite_codes (
  id              text PRIMARY KEY,
  code_hash       text UNIQUE NOT NULL,
  source_id       text REFERENCES growth_sources(id),
  purpose         text NOT NULL CHECK (purpose IN ('beta','if_code','survey')),
  max_redemptions integer,
  redeemed_count  integer NOT NULL DEFAULT 0,
  valid_until     timestamptz
);

COMMIT;
