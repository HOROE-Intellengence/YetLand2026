import type { Env } from '../types/bindings';
import type { SurveySubmission } from '@yelan/shared';

export interface ActiveSurvey {
  id: string;
  title: string;
  rewardCandle: number;
  questions: Array<{
    id: string;
    type: 'single' | 'multi' | 'text' | 'scale';
    title: string;
    options?: { value: string; label: string }[];
    minSeconds: number;
  }>;
}

export async function getActiveSurvey(env: Env, _userId: string): Promise<ActiveSurvey | null> {
  if (!env.DB) return null;
  const row = await env.DB.prepare(
    `SELECT id, title, reward_candle FROM surveys WHERE status = 'active' LIMIT 1`,
  ).first<{ id: string; title: string; reward_candle: number }>();
  if (!row) return null;

  const questions = await env.DB.prepare(
    `SELECT id, type, title, options, min_seconds FROM survey_questions WHERE survey_id = ?1`,
  ).bind(row.id).all<{ id: string; type: string; title: string; options: string; min_seconds: number }>();

  return {
    id: row.id,
    title: row.title,
    rewardCandle: row.reward_candle,
    questions: (questions.results ?? []).map((q: { id: string; type: string; title: string; options: string; min_seconds: number }) => ({
      id: q.id,
      type: q.type as ActiveSurvey['questions'][0]['type'],
      title: q.title,
      options: q.options ? JSON.parse(q.options) : undefined,
      minSeconds: q.min_seconds,
    })),
  };
}

export async function submitSurvey(
  _env: Env,
  _userId: string,
  _surveyId: string,
  _body: SurveySubmission,
): Promise<{ rewarded: number }> {
  // TODO: 校验 dwell_ms ≥ min_seconds * 1000 → 幂等写 survey_completions + candle_ledger
  return { rewarded: 0 };
}
