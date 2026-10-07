import { kvGet, kvSetAsync } from './kv-db';
import { yelanHeaders, yelanRequest } from './yelan-managed-client';

export type YelanVoiceTurn = {
  id: string; sessionId: string; status: string; inputText: string; outputText: string;
  outputAudioUrl?: string | null; errorCode?: string | null; canRetryTts?: boolean; canResumeAsr?: boolean;
};
export type PendingVoice = {
  chatSessionId: string; characterId: string;
  connection: { id: string; kind: 'voice' | 'voice-hq' };
  requestId: string; input?: { text: string } | { audio: string };
  turn?: YelanVoiceTurn;
  retry?: { action: 'retry-tts' | 'resume-asr'; requestId: string };
};
const key = (sessionId: string) => `yelan-voice-pending:${sessionId}`;
export function loadPendingVoice(sessionId: string): PendingVoice | null {
  try {
    const value = JSON.parse(kvGet(key(sessionId)) || 'null') as PendingVoice | null;
    return value?.chatSessionId === sessionId && typeof value.requestId === 'string' && typeof value.connection?.id === 'string'
      && ['voice', 'voice-hq'].includes(value.connection.kind) ? value : null;
  } catch { return null; }
}
export async function savePendingVoice(value: PendingVoice) { await kvSetAsync(key(value.chatSessionId), JSON.stringify(value)); }
export async function clearPendingVoice(sessionId: string) { await kvSetAsync(key(sessionId), 'null'); }
export const voiceTurnBase = (value: PendingVoice) => `/${value.connection.kind}/sessions/${encodeURIComponent(value.connection.id)}/turns`;

// A lost POST response reuses the persisted request ID and exact input. Once a
// turn ID is known, recovery only reads that turn (or explicitly retries TTS/ASR).
export async function recoverVoiceTurn(value: PendingVoice, signal: AbortSignal): Promise<YelanVoiceTurn> {
  const base = voiceTurnBase(value);
  let turn: YelanVoiceTurn;
  if (value.retry && value.turn) {
    turn = await yelanRequest<YelanVoiceTurn>(`${base}/${encodeURIComponent(value.turn.id)}/${value.retry.action}`, {
      method: 'POST', signal, headers: { 'Idempotency-Key': value.retry.requestId },
    });
  } else if (value.turn) {
    turn = await yelanRequest<YelanVoiceTurn>(`${base}/${encodeURIComponent(value.turn.id)}`, { signal });
  } else {
    if (!value.input) throw new Error('找不到这条录音，请重新录制');
    const blob = 'audio' in value.input ? await (await fetch(value.input.audio)).blob() : null;
    const response = await fetch(`/api/host${base}${blob ? '' : '/text'}`, {
      method: 'POST', signal,
      headers: { ...yelanHeaders(), 'Content-Type': blob?.type || 'application/json', 'Idempotency-Key': value.requestId },
      body: blob || JSON.stringify(value.input),
    });
    if (!response.ok) {
      const failure = await response.json().catch(() => ({}));
      throw new Error(failure.code || '夜阑通话请求失败');
    }
    turn = await response.json();
  }
  value.turn = turn; delete value.input; delete value.retry;
  await savePendingVoice(value);
  return turn;
}
