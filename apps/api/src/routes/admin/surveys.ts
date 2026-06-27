import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { randomUUID } from 'node:crypto';
import { AdminSurveyCreateSchema, AdminSurveyPatchSchema, AdminSurveyToggleSchema } from '@yelan/shared';
import { store } from '../../store/persistence';
import { surveyRepo } from '../../store/repositories';
import { audit } from './_audit';
import { validationHook } from '../../middleware/validation';

export const adminSurveysRoute = new Hono();

adminSurveysRoute.get('/', async (c) => {
  const users = store.state().users; // userName 富集属 hub，待 userRepo 收口
  const [surveys, submissions] = await Promise.all([surveyRepo.listDefinitions(), surveyRepo.listSubmissions()]);
  return c.json({
    surveys,
    submissions: submissions.map((submission) => ({
      ...submission,
      userName: users[submission.userId]?.name ?? null,
    })),
  });
});

adminSurveysRoute.post(
  '/',
  zValidator('json', AdminSurveyCreateSchema, validationHook),
  async (c) => {
    const body = c.req.valid('json');
    const id = body.id ?? `srv_${randomUUID().slice(0, 6)}`;
    if (await surveyRepo.getDefinition(id)) {
      return c.json({ code: 'EXISTS', message: 'survey already exists' }, 409);
    }
    const survey = {
      id,
      title: body.title,
      rewardCandle: body.rewardCandle,
      status: body.status ?? 'inactive',
      questions: body.questions?.length ? body.questions : [
        { id: 'q1', type: 'text' as const, title: body.title, minSeconds: 5 },
      ],
      updatedAt: new Date().toISOString(),
    };
    await surveyRepo.setDefinition(survey);
    audit('survey.create', id, body.reason, survey);
    return c.json(survey, 201);
  },
);

adminSurveysRoute.patch(
  '/:id',
  zValidator('json', AdminSurveyPatchSchema, validationHook),
  async (c) => {
    const id = c.req.param('id');
    const body = c.req.valid('json');
    const existing = await surveyRepo.getDefinition(id);
    if (!existing) return c.json({ code: 'NOT_FOUND', message: 'survey not found' }, 404);
    const updated = {
      ...existing,
      title: body.title ?? existing.title,
      rewardCandle: body.rewardCandle ?? existing.rewardCandle,
      status: body.status ?? existing.status,
      questions: body.questions ?? existing.questions,
      updatedAt: new Date().toISOString(),
    };
    await surveyRepo.setDefinition(updated);
    audit('survey.patch', id, body.reason, updated);
    return c.json(updated);
  },
);

adminSurveysRoute.post('/:id/toggle', async (c) => {
  const id = c.req.param('id');
  const parsed = AdminSurveyToggleSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'invalid request' }, 400);
  }
  const body = parsed.data;
  const existing = await surveyRepo.getDefinition(id);
  if (!existing) return c.json({ code: 'NOT_FOUND', message: 'survey not found' }, 404);
  const updated = {
    ...existing,
    status: existing.status === 'active' ? ('inactive' as const) : ('active' as const),
    updatedAt: new Date().toISOString(),
  };
  await surveyRepo.setDefinition(updated);
  audit('survey.toggle', id, body.reason ?? 'admin toggle', { status: updated.status });
  return c.json({ ok: true, survey: updated });
});

adminSurveysRoute.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const reason = c.req.query('reason') || 'no reason';
  if (!(await surveyRepo.deleteDefinition(id))) return c.json({ code: 'NOT_FOUND', message: 'survey not found' }, 404);
  audit('survey.delete', id, reason);
  return c.json({ ok: true });
});

adminSurveysRoute.get('/:id/export', async (c) => {
  const id = c.req.param('id');
  const subs = await surveyRepo.listSubmissionsBySurvey(id);
  const users = store.state().users; // userName 富集属 hub，待 userRepo 收口
  const csv = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const lines = ['userId,userName,surveyId,rewarded,source,answers,ts'];
  for (const s of subs) {
    const userName = users[s.userId]?.name ?? '';
    const answers = s.answers?.map((answer) => ({
      questionId: answer.questionId,
      answer: answer.answer,
      dwellMs: answer.dwellMs,
    })) ?? [];
    lines.push([
      csv(s.userId),
      csv(userName),
      csv(s.surveyId),
      csv(s.rewarded),
      csv(s.source ?? ''),
      csv(JSON.stringify(answers)),
      csv(s.ts),
    ].join(','));
  }
  return c.text(lines.join('\n'));
});
