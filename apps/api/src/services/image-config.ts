import { store } from '../store/persistence';
export const IMAGE_MODEL = 'gpt-image-2.5-flare';
export function imageConfig() {
  return store.state().imageServiceConfig ?? {
    baseUrl: process.env.IMAGE_API_BASE_URL?.trim() || '',
    apiKey: process.env.IMAGE_API_KEY?.trim() || '', enabled: true,
  };
}
export function publicImageConfig() {
  const c = imageConfig();
  return { baseUrl: c.baseUrl, enabled: c.enabled, hasKey: Boolean(c.apiKey),
    ready: Boolean(c.enabled && c.baseUrl && c.apiKey), model: IMAGE_MODEL,
    source: store.state().imageServiceConfig ? 'admin' : 'environment' };
}
export function saveImageConfig(input: {baseUrl: string; apiKey?: string; enabled: boolean}) {
  const state = store.state(), previous = state.imageServiceConfig;
  state.imageServiceConfig = { baseUrl: input.baseUrl.replace(/\/+$/, '').replace(/\/images\/(generations|edits)$/, ''),
    apiKey: input.apiKey?.trim() || imageConfig().apiKey, enabled: input.enabled };
  try { store.save(); } catch (e) { state.imageServiceConfig = previous; throw e; }
  return publicImageConfig();
}
