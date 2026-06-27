import { api } from './client';
import type {
  MeMemoriesListResponse,
  MeMemoriesRecall,
  MeMemoriesRecallResponse,
  MeMemoriesUpsert,
  MeMemoriesUpsertResponse,
} from '@yelan/shared';

export const listMemories = (params?: { since?: string }) => {
  const q = params?.since ? `?since=${encodeURIComponent(params.since)}` : '';
  return api<MeMemoriesListResponse>(`/api/me/memories${q}`);
};

export const upsertMemories = (payload: MeMemoriesUpsert) =>
  api<MeMemoriesUpsertResponse>('/api/me/memories', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const deleteMemory = (id: string) =>
  api<{ ok: true }>(`/api/me/memories/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const deleteAllMemories = () =>
  api<{
    ok: true;
    deleted: {
      preferences: number;
      events: number;
      profiles: number;
      profileFacts: number;
      profileChangelog: number;
      contextSummaries: number;
    };
  }>(
    '/api/me/memories',
    { method: 'DELETE' },
  );

export const recallMemories = (payload: MeMemoriesRecall) =>
  api<MeMemoriesRecallResponse>('/api/me/memories/recall', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
