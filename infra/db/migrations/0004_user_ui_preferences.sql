-- 0004_user_ui_preferences.sql — BE-103 UI 偏好上服务器

BEGIN;

CREATE TABLE IF NOT EXISTS user_ui_preferences (
  user_id text PRIMARY KEY,
  theme text NOT NULL DEFAULT 'dark',
  font_scale double precision NOT NULL DEFAULT 1,
  locale text NOT NULL DEFAULT 'zh-CN',
  stage_layout_overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_ui_preferences_theme_chk CHECK (theme IN ('dark', 'light')),
  CONSTRAINT user_ui_preferences_font_scale_chk CHECK (font_scale BETWEEN 0.85 AND 1.25)
);

COMMIT;
