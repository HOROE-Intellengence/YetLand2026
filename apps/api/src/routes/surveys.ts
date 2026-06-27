import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { SurveyFeedbackSchema, SurveySubmissionSchema } from '@yelan/shared';
import { mockActiveSurvey } from '../fixtures/surveys';
import { softAuth } from '../middleware/auth';
import { surveyRepo } from '../store/repositories';
import { adjustCandle } from '../services/users';
import { policyService } from '../services/policy';
import { validationHook } from '../middleware/validation';

export const mockSurveysRoute = new Hono();
mockSurveysRoute.use('*', softAuth());

mockSurveysRoute.get('/active', async (c) => {
  const userId = c.get('userId') as string;
  const activeSurvey = (await surveyRepo.findActiveDefinition()) ?? mockActiveSurvey;
  const submitted = await surveyRepo.findSubmission(userId, activeSurvey.id);
  return c.json(submitted ? null : activeSurvey);
});

mockSurveysRoute.post(
  '/:id/submit',
  zValidator('json', SurveySubmissionSchema, validationHook),
  async (c) => {
    const userId = c.get('userId') as string;
    const id = c.req.param('id');
    const body = c.req.valid('json');

    const minDwellSeconds = policyService.get<number>('SURVEY_MIN_DWELL_SECONDS', 5);
    for (const a of body.answers) {
      if (a.dwellMs < minDwellSeconds * 1000) {
        return c.json({ code: 'DWELL_TOO_SHORT', message: `must dwell at least ${minDwellSeconds}s per question` }, 400);
      }
    }

    const exists = await surveyRepo.findSubmission(userId, id);
    if (exists) return c.json({ rewarded: 0, alreadySubmitted: true });

    const survey = (await surveyRepo.getDefinition(id)) ?? (mockActiveSurvey.id === id ? mockActiveSurvey : null);
    const reward = survey?.rewardCandle ?? 30;
    await surveyRepo.addSubmission({
      userId,
      surveyId: id,
      rewarded: reward,
      ts: new Date().toISOString(),
      answers: body.answers.map((answer) => ({
        questionId: answer.questionId,
        answer: answer.answer ?? null,
        dwellMs: answer.dwellMs,
      })),
      source: 'survey',
    });
    adjustCandle(userId, reward, 'survey', id);
    return c.json({ rewarded: reward });
  },
);

mockSurveysRoute.post(
  '/feedback',
  zValidator('json', SurveyFeedbackSchema, validationHook),
  async (c) => {
    const userId = c.get('userId') as string;
    const body = c.req.valid('json');
    const row = {
      userId,
      surveyId: 'feedback',
      rewarded: 0,
      ts: new Date().toISOString(),
      source: body.source ?? 'survey-panel',
      answers: [
        {
          questionId: 'free_text',
          answer: {
            text: body.text,
            characterId: body.characterId ?? null,
          },
          dwellMs: 0,
        },
      ],
    };
    await surveyRepo.addSubmission(row);
    return c.json({ accepted: true, rewarded: 0, submission: row });
  },
);
