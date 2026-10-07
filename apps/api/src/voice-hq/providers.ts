import { setTimeout as delay } from 'node:timers/promises';
import { VoiceError, MAX_OUTPUT_SECONDS } from '../voice/config';
import { decodeAudio } from '../voice/audio';
import type { HqProfile } from './profiles';
import asrDefault from './asr-provider.json';
import { voiceFetch } from '../voice/local-proxy';

export type Fetch = typeof fetch;
async function json(url: string, init: RequestInit, fetcher: Fetch, limit = 24 * 1024 * 1024): Promise<Record<string, unknown>> {
  const response = await fetcher(url, { ...init, redirect: 'error' });
  if (!response.ok) throw new VoiceError(`HQ_UPSTREAM_HTTP_${response.status}`, 502);
  if (Number(response.headers.get('content-length')) > limit) throw new VoiceError('HQ_UPSTREAM_TOO_LARGE', 502);
  const reader = response.body?.getReader(); if (!reader) throw new VoiceError('HQ_UPSTREAM_EMPTY', 502);
  const chunks: Uint8Array[] = []; let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      total += value.length; if (total > limit) { await reader.cancel(); throw new VoiceError('HQ_UPSTREAM_TOO_LARGE', 502); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>; }
  catch { throw new VoiceError('HQ_UPSTREAM_INVALID_JSON', 502); }
}
function httpsBase(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new VoiceError('HQ_PROVIDER_NOT_CONFIGURED', 503);
  return url.href.replace(/\/$/, '');
}
export const FISH_TTS_MODEL = 's2.1-pro-free';
export function ttsConfig() {
  const key = process.env.VOICE_HQ_FISH_API_KEY?.trim();
  if (!key) throw new VoiceError('HQ_TTS_NOT_CONFIGURED', 503);
  return { key, base: httpsBase(process.env.VOICE_HQ_FISH_BASE_URL || 'https://api.fish.audio'), model: FISH_TTS_MODEL };
}
export function asrConfig() {
  const key = process.env.VOICE_HQ_ASR_API_KEY?.trim();
  if (!key) throw new VoiceError('HQ_ASR_NOT_CONFIGURED', 503);
  return { key, base: httpsBase(process.env.VOICE_HQ_ASR_BASE_URL || asrDefault.baseUrl),
    model: process.env.VOICE_HQ_ASR_MODEL || asrDefault.model };
}
export async function synthesize(text: string, profile: HqProfile, signal: AbortSignal, fetcher: Fetch = voiceFetch): Promise<Buffer> {
  if (!text.trim() || text.length > 16000) throw new VoiceError('HQ_TTS_TEXT_LIMIT', 422);
  if (profile.provider !== 'fish' || profile.model !== FISH_TTS_MODEL) throw new VoiceError('HQ_TTS_LEGACY_SNAPSHOT', 409);
  const cfg = ttsConfig();
  const response = await fetcher(`${cfg.base}/v1/tts`, {
    method: 'POST', redirect: 'error',
    headers: { Authorization: `Bearer ${cfg.key}`, 'Content-Type': 'application/json', model: FISH_TTS_MODEL },
    body: JSON.stringify({ text, ...(profile.referenceId ? { reference_id: profile.referenceId } : {}),
      format: 'wav', sample_rate: 24000, latency: 'normal', prosody: { speed: profile.speed ?? 1, volume: 0 } }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(240000)]),
  });
  if (!response.ok) throw new VoiceError(`HQ_FISH_HTTP_${response.status}`, 502);
  const limit = 12 * 1024 * 1024;
  if (Number(response.headers.get('content-length')) > limit) throw new VoiceError('HQ_UPSTREAM_TOO_LARGE', 502);
  const reader = response.body?.getReader(); if (!reader) throw new VoiceError('HQ_TTS_EMPTY', 502);
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.length; if (size > limit) { await reader.cancel(); throw new VoiceError('HQ_UPSTREAM_TOO_LARGE', 502); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = Buffer.concat(chunks);
  if (bytes.subarray(0, 4).toString() !== 'RIFF' || bytes.subarray(8, 12).toString() !== 'WAVE') throw new VoiceError('HQ_TTS_FORMAT', 502);
  return decodeAudio(bytes, 24000, MAX_OUTPUT_SECONDS);
}
export async function listFishVoices(query: { title?: string; page?: number; self?: boolean }, signal: AbortSignal, fetcher: Fetch = voiceFetch) {
  const cfg = ttsConfig(), params = new URLSearchParams({ page_size: '20', page_number: String(query.page ?? 1), self: String(query.self ?? false), sort_by: 'score' });
  if (query.title) params.set('title', query.title);
  const result = await json(`${cfg.base}/model?${params}`, { headers: { Authorization: `Bearer ${cfg.key}` },
    signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]) }, fetcher, 2 * 1024 * 1024);
  const items = Array.isArray(result.items) ? result.items as Array<Record<string, unknown>> : [];
  return { total: Number(result.total) || 0, hasMore: typeof result.has_more === 'boolean' ? result.has_more : items.length === 20, items: items.filter(v => v.type === 'tts' && !v.dmca_taken_down).map(v => ({
    referenceId: String(v._id), name: String(v.title), languages: Array.isArray(v.languages) ? v.languages.map(String) : [],
    tags: Array.isArray(v.tags) ? v.tags.map(String).slice(0, 12) : [],
  })) };
}
function output(data: Record<string, unknown>): Record<string, unknown> {
  if (data.output && typeof data.output === 'object') return data.output as Record<string, unknown>;
  if (data.data && typeof data.data === 'object') return output(data.data as Record<string, unknown>);
  if (data.output_result && typeof data.output_result === 'object') return output(data.output_result as Record<string, unknown>);
  return data;
}
export async function submitAsr(url: string, signal: AbortSignal, fetcher: Fetch = voiceFetch): Promise<string> {
  const cfg = asrConfig();
  const data = await json(`${cfg.base}/services/audio/asr/transcription`, {
    method: 'POST', headers: { Authorization: `Bearer ${cfg.key}`, 'Content-Type': 'application/json', 'X-DashScope-Async': 'enable' },
    body: JSON.stringify({ model: cfg.model, input: { file_urls: [url] }, parameters: { channel_id: [0] } }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
  }, fetcher, 1024 * 1024);
  const taskId = output(data).task_id;
  if (typeof taskId !== 'string' || !/^[\w-]{1,150}$/.test(taskId)) throw new VoiceError('HQ_ASR_SUBMISSION_UNKNOWN', 502);
  return taskId;
}
export async function pollAsr(taskId: string, signal: AbortSignal, fetcher: Fetch = voiceFetch, intervalMs = 2000): Promise<string> {
  const cfg = asrConfig();
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(180000)]);
  while (!bounded.aborted) {
    const data = output(await json(`${cfg.base}/tasks/${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${cfg.key}` }, signal: bounded,
    }, fetcher, 1024 * 1024));
    if (data.task_status === 'PENDING' || data.task_status === 'RUNNING') { await delay(intervalMs, undefined, { signal: bounded }); continue; }
    const results = data.results as Array<{ subtask_status: string; transcription_url: string }> | undefined;
    if (data.task_status !== 'SUCCEEDED' || results?.length !== 1 || results[0]?.subtask_status !== 'SUCCEEDED') throw new VoiceError('HQ_ASR_TASK_FAILED', 502);
    const resultUrl = new URL(results[0].transcription_url);
    if (resultUrl.protocol !== 'https:' || resultUrl.username || resultUrl.password || !resultUrl.hostname.endsWith('.aliyuncs.com')) throw new VoiceError('HQ_ASR_RESULT_URL', 502);
    const result = await json(resultUrl.href, { signal: bounded }, fetcher, 2 * 1024 * 1024); // No API key sent to storage.
    const transcripts = result.transcripts as Array<{ text: string }> | undefined;
    const text = transcripts?.map(t => t.text).join('\n').trim();
    if (!text || text.length > 4000) throw new VoiceError('HQ_ASR_EMPTY_OR_TOO_LONG', 422);
    return text;
  }
  throw new VoiceError('HQ_ASR_TIMEOUT', 504);
}
