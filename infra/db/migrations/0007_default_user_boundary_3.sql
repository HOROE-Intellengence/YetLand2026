-- 0007_default_user_boundary_3.sql
-- 新用户默认叙事边界从 B2 调整为 B3；既有用户保留原值。

BEGIN;

ALTER TABLE users
  ALTER COLUMN narrative_boundary SET DEFAULT 3;

COMMIT;
