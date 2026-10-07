import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { pollAsr, submitAsr, synthesize } from './providers';
const profile: HqProfile = { id: 'young-female', label: 'test', voiceName: 'test', model: 's2.1-pro-free', provider: 'fish', referenceId: 'fish-test-ref', speed: 1, libraryId: null, revision: 1, style: '' };
import type { HqProfile } from './profiles';
beforeEach(() => { vi.stubEnv('VOICE_HQ_FISH_API_KEY', 'test-tts'); vi.stubEnv('VOICE_HQ_ASR_API_KEY', 'test-asr'); });
afterEach(() => vi.unstubAllEnvs());
it('uses the exact free model header and reference id, returns real decoded PCM', async () => {
  const pcm = Buffer.alloc(4800, 1), h = Buffer.alloc(44);
  h.write('RIFF'); h.writeUInt32LE(36+pcm.length,4);h.write('WAVEfmt ',8);h.writeUInt32LE(16,16);h.writeUInt16LE(1,20);h.writeUInt16LE(1,22);h.writeUInt32LE(24000,24);h.writeUInt32LE(48000,28);h.writeUInt16LE(2,32);h.writeUInt16LE(16,34);h.write('data',36);h.writeUInt32LE(pcm.length,40);
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(Buffer.concat([h,pcm]), {headers:{'Content-Type':'audio/wav'}}));
  expect(await synthesize('逐字照读', profile, new AbortController().signal, fetcher)).toEqual(pcm);
  const [url, init] = fetcher.mock.calls[0]!;
  expect(url).toBe('https://api.fish.audio/v1/tts');
  expect(new Headers(init!.headers).get('model')).toBe('s2.1-pro-free');
  const body = JSON.parse(init!.body as string);
  expect(body.text).toBe('逐字照读'); expect(body.reference_id).toBe('fish-test-ref');
  expect(body).not.toHaveProperty('speech_metadata'); expect(body.format).toBe('wav');
});
it('rejects HTTP errors and legacy Gemini snapshots without fallback or automatic retry', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('quota', {status:402}));
  await expect(synthesize('你好', profile, new AbortController().signal, fetcher)).rejects.toThrow('HQ_FISH_HTTP_402');
  expect(fetcher).toHaveBeenCalledTimes(1);
  await expect(synthesize('你好', {...profile, model:'gemini-3.8-flash-tts'}, new AbortController().signal, fetcher)).rejects.toThrow('HQ_TTS_LEGACY_SNAPSHOT');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('parses wrapped task output, polls once pending, fetches transcription without credentials', async () => {
  const fetcher = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ data: { output: { task_id: 'task-1' } } }))
    .mockResolvedValueOnce(Response.json({ output: { task_status: 'RUNNING' } }))
    .mockResolvedValueOnce(Response.json({ output: { task_status: 'SUCCEEDED', results: [{ subtask_status: 'SUCCEEDED', transcription_url: 'https://result.oss.aliyuncs.com/result.json' }] } }))
    .mockResolvedValueOnce(Response.json({ transcripts: [{ text: '你好呀' }] }));
  const signal = new AbortController().signal;
  expect(await submitAsr('https://app.example/signed', signal, fetcher)).toBe('task-1');
  expect(await pollAsr('task-1', signal, fetcher, 1)).toBe('你好呀');
  expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string).parameters).toEqual({ channel_id: [0] });
  expect(fetcher.mock.calls[3]![1]!.headers).toBeUndefined();
});
it('rejects a failed subtask even when the top-level task succeeded', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ output: { task_status: 'SUCCEEDED', results: [{ subtask_status: 'FAILED' }] } }));
  await expect(pollAsr('task-1', new AbortController().signal, fetcher, 1)).rejects.toThrow('HQ_ASR_TASK_FAILED');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('rejects untrusted transcription hosts and non-audio TTS', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ output: { task_status: 'SUCCEEDED', results: [{ subtask_status: 'SUCCEEDED', transcription_url: 'https://evil.example/result' }] } }));
  await expect(pollAsr('task-1', new AbortController().signal, fetcher, 1)).rejects.toThrow('HQ_ASR_RESULT_URL');
  fetcher.mockResolvedValue(Response.json({ candidates: [{ finishReason: 'MAX_TOKENS' }] }));
  await expect(synthesize('你好', profile, new AbortController().signal, fetcher)).rejects.toThrow('HQ_TTS_FORMAT');
});
