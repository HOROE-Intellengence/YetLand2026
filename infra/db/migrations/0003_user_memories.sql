-- 0003_user_memories.sql — BE-102 长期记忆上服务器
-- 浏览器 Dexie 只做缓存；服务端记录偏好 / 事件及 tombstone 删除状态。

BEGIN;

CREATE TABLE IF NOT EXISTS user_preferences (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  character_id text NOT NULL,
  mode text NOT NULL DEFAULT 'main',
  text text NOT NULL,
  embedding double precision[],
  weight double precision NOT NULL DEFAULT 1,
  last_used_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  tombstone boolean NOT NULL DEFAULT false,
  CONSTRAINT user_preferences_mode_chk CHECK (mode IN ('main', 'if'))
);

CREATE INDEX IF NOT EXISTS user_preferences_user_updated_idx
  ON user_preferences (user_id, updated_at);

CREATE TABLE IF NOT EXISTS user_events (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  character_id text NOT NULL,
  mode text NOT NULL DEFAULT 'main',
  date text NOT NULL,
  text text NOT NULL,
  embedding double precision[],
  emotion text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  tombstone boolean NOT NULL DEFAULT false,
  CONSTRAINT user_events_mode_chk CHECK (mode IN ('main', 'if'))
);

CREATE INDEX IF NOT EXISTS user_events_user_updated_idx
  ON user_events (user_id, updated_at);

COMMIT;
