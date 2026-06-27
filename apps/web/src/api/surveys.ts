import { api } from './client';
import type { Survey, SurveySubmission } from '@yelan/shared';

export const getActiveSurvey = () => api<Survey | null>('/api/surveys/active');
export const submitSurvey = (id: string, body: SurveySubmission) =>
  api<{ rewarded: number }>(`/api/surveys/${id}/submit`, { method: 'POST', body: JSON.stringify(body) });
export const submitFeedback = (body: { text: string; characterId?: string; source?: string }) =>
  api<{ accepted: boolean; rewarded: number }>('/api/surveys/feedback', { method: 'POST', body: JSON.stringify(body) });
