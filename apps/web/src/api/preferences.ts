import { api } from './client';
import type { MePreferencesPut, MePreferencesResponse } from '@yelan/shared';

export const getPreferences = () => api<MePreferencesResponse>('/api/me/preferences');

export const updatePreferences = (prefs: MePreferencesPut) =>
  api<MePreferencesResponse>('/api/me/preferences', {
    method: 'PUT',
    body: JSON.stringify(prefs),
  });
