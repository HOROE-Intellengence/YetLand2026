-- 夜阑 · Postgres Schema（开发文档 §三.3 + §四.1/.3/.4/.5/.6 整合）
-- 真实迁移使用 infra/db/migrations/NNNN_*.sql；本文件是当前 schema 的"快照"
-- 用 `schema.sql` 给新人快速看全貌，不直接 apply

-- ─── users / auth ─────────────────────────────────────────
CREATE TABLE users (
  id              text PRIMARY KEY,
  phone           text UNIQUE NOT NULL,
  age_verified    boolean NOT NULL DEFAULT false,  -- Phase 1 不验证，字段保留
  narrative_boundary smallint NOT NULL DEFAULT 3,
  if_unlocked     boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_flags (
  user_id         text PRIMARY KEY REFERENCES users(id),
  if_unlocked     boolean NOT NULL DEFAULT false,
  if_unlocked_at  timestamptz,
  if_source       text,
  admin_note      text
);

-- ─── billing ──────────────────────────────────────────────
CREATE TABLE subscriptions (
  id              text PRIMARY KEY,
  user_id         text NOT NULL REFERENCES users(id),
  plan            text NOT NULL CHECK (plan IN ('moonlight','milkyway','eternal')),
  cycle           text NOT NULL CHECK (cycle IN ('week','month')),
  status          text NOT NULL CHECK (status IN ('active','canceled','past_due','grace')),
  current_period_end timestamptz NOT NULL,
  gateway_subscription_id text,
  gateway_event_id text UNIQUE  -- 幂等键
);

CREATE TABLE candle_balance (
  user_id         text PRIMARY KEY REFERENCES users(id),
  balance         integer NOT NULL DEFAULT 0,
  last_topup_at   timestamptz
);

CREATE TABLE candle_ledger (
  id              text PRIMARY KEY,
  user_id         text NOT NULL REFERENCES users(id),
  delta           integer NOT NULL,
  reason          text NOT NULL,
  ref_id          text NOT NULL,  -- 幂等键的一部分
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, reason, ref_id)
);

CREATE TABLE conversation_quota (
  user_id         text NOT NULL REFERENCES users(id),
  date            date NOT NULL,
  free_round_limit integer NOT NULL DEFAULT 20,
  free_round_used integer NOT NULL DEFAULT 0,
  bonus_round_limit integer NOT NULL DEFAULT 0,
  bonus_round_used integer NOT NULL DEFAULT 0,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, date)
);

CREATE TABLE quota_ledger (
  id              text PRIMARY KEY,
  user_id         text NOT NULL REFERENCES users(id),
  delta_rounds    integer NOT NULL,
  reason          text NOT NULL,
  ref_id          text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, reason, ref_id)
);

-- ─── characters / sessions ───────────────────────────────
CREATE TABLE characters (
  id              text PRIMARY KEY,
  slug            text UNIQUE NOT NULL,
  name            text NOT NULL,
  rarity          text NOT NULL CHECK (rarity IN ('free','paid','hidden')),
  price_candle    integer NOT NULL DEFAULT 0,
  prompt_card_key text,                                  -- 可空：DB 化后角色卡不强依赖 yaml
  style_tags      text[] NOT NULL DEFAULT '{}',
  is_active       boolean NOT NULL DEFAULT true,
  -- 0002_characters.sql 增补 — 运营在 #characters 面板可编辑
  opening_first_visit  text NOT NULL DEFAULT '',
  opening_return_visit text NOT NULL DEFAULT '',
  boundary_default     smallint NOT NULL DEFAULT 2 CHECK (boundary_default BETWEEN 1 AND 5),
  forbidden_phrases    text[] NOT NULL DEFAULT '{}',
  description          text NOT NULL DEFAULT '',
  profile_sections     jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_character_unlocks (
  user_id         text NOT NULL REFERENCES users(id),
  character_id    text NOT NULL REFERENCES characters(id),
  source          text NOT NULL CHECK (source IN ('default','candle','achievement','if_unlock','admin')),
  unlocked_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, character_id)
);

CREATE TABLE conversation_sessions (
  id              text PRIMARY KEY,
  user_id         text NOT NULL REFERENCES users(id),
  character_id    text NOT NULL REFERENCES characters(id),
  mode            text NOT NULL CHECK (mode IN ('main','if')),
  stage           text NOT NULL DEFAULT 'daily',
  last_message_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ─── achievements ─────────────────────────────────────────
CREATE TABLE achievements (
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

CREATE TABLE user_achievements (
  user_id         text NOT NULL REFERENCES users(id),
  achievement_id  text NOT NULL REFERENCES achievements(id),
  session_id      text,
  trigger_message_id text,
  reward_ledger_id text,
  unlocked_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, achievement_id)
);

-- ─── surveys ──────────────────────────────────────────────
CREATE TABLE surveys (
  id              text PRIMARY KEY,
  title           text NOT NULL,
  reward_candle   integer NOT NULL DEFAULT 0,
  status          text NOT NULL CHECK (status IN ('active','inactive')),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE survey_questions (
  id              text PRIMARY KEY,
  survey_id       text NOT NULL REFERENCES surveys(id),
  type            text NOT NULL,
  title           text NOT NULL,
  options         jsonb,
  min_seconds     integer NOT NULL DEFAULT 5
);

CREATE TABLE survey_answers (
  id              text PRIMARY KEY,
  survey_id       text NOT NULL REFERENCES surveys(id),
  question_id     text NOT NULL REFERENCES survey_questions(id),
  user_id         text NOT NULL REFERENCES users(id),
  answer          jsonb NOT NULL,
  dwell_ms        integer NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE survey_completions (
  survey_id       text NOT NULL REFERENCES surveys(id),
  user_id         text NOT NULL REFERENCES users(id),
  reward_ledger_id text,
  completed_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (survey_id, user_id)
);

-- ─── if codes ─────────────────────────────────────────────
CREATE TABLE if_codes (
  id              text PRIMARY KEY,
  code_hash       text UNIQUE NOT NULL,
  batch           text,
  source          text,
  max_redemptions integer,  -- NULL 表示不限制
  redeemed_count  integer NOT NULL DEFAULT 0,
  valid_until     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE if_unlocks (
  user_id         text NOT NULL REFERENCES users(id),
  character_id    text NOT NULL REFERENCES characters(id),
  state           text NOT NULL,
  source          text NOT NULL CHECK (source IN ('code','natural','admin')),
  code_id         text REFERENCES if_codes(id),
  entered_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, character_id)
);

-- ─── conversation logs (服务质量改进) ────────────────────
CREATE TABLE conversation_logs (
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
CREATE INDEX ON conversation_logs (user_id, created_at);
CREATE INDEX ON conversation_logs (session_id);

-- ─── 成本（熔断的前提） ───────────────────────────────────
CREATE TABLE cost_records (
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
CREATE INDEX ON cost_records (user_id, created_at);

-- ─── growth / 归因 ────────────────────────────────────────
CREATE TABLE growth_sources (
  id              text PRIMARY KEY,
  type            text NOT NULL CHECK (type IN ('koc','private_group','manual')),
  name            text NOT NULL,
  owner           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE invite_codes (
  id              text PRIMARY KEY,
  code_hash       text UNIQUE NOT NULL,
  source_id       text REFERENCES growth_sources(id),
  purpose         text NOT NULL CHECK (purpose IN ('beta','if_code','survey')),
  max_redemptions integer,
  redeemed_count  integer NOT NULL DEFAULT 0,
  valid_until     timestamptz
);
