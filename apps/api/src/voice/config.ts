import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export function voiceRoot(): string {
  if (process.env.VOICE_DATA_DIR) return resolve(process.env.VOICE_DATA_DIR);
  const stateRoot = process.env.YELAN_STATE_DIR ?? resolve(apiRoot,
    process.env.NODE_ENV === 'test' || process.env.VITEST ? '.local-test' : '.local');
  return resolve(stateRoot, 'voice');
}
export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
export const MAX_INPUT_SECONDS = 120;
export const MAX_OUTPUT_SECONDS = 180;
export const MAX_HISTORY_TURNS = 100;
export const VOICE_MODEL = 'gemini-3.8-live';

export class VoiceError extends Error {
  constructor(public readonly code: string, public readonly status = 400) {
    super(code);
  }
}

export function relayConfig(): { url: string; token: string } {
  const token = process.env.VOICE_RELAY_TOKEN?.trim();
  let url: URL;
  try { url = new URL(process.env.VOICE_RELAY_URL ?? ''); }
  catch { throw new VoiceError('VOICE_RELAY_NOT_CONFIGURED', 503); }
  const localWs = process.env.DEPLOY_MODE !== 'server' && url.protocol === 'ws:' &&
    ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if ((!localWs && url.protocol !== 'wss:') || url.username || url.password || url.search || url.hash ||
      url.pathname !== '/google-live' || !token || token.length < 32) {
    throw new VoiceError('VOICE_RELAY_NOT_CONFIGURED', 503);
  }
  return { url: url.href, token };
}
