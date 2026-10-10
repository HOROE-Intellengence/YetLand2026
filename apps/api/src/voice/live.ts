import WebSocket from 'ws';
import { voiceWebSocketAgent } from './local-proxy';
import { MAX_OUTPUT_SECONDS, relayConfig, VOICE_MODEL, VoiceError } from './config';
import type { VoiceName } from '@yelan/shared';

export interface LiveContent {
  role: 'user' | 'model';
  parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }>;
}
export interface LiveProgress {
  inputText: string; outputText: string;
  inputTranscriptComplete: boolean; outputTranscriptComplete: boolean;
  usage: unknown;
}
export interface LiveRequest {
  prompt: string; voiceName: VoiceName; history: LiveContent[]; pcm: Buffer;
  text?: string;
  signal: AbortSignal;
  onAudio: (pcm: Buffer) => void;
  onProgress: (progress: LiveProgress) => void;
}

export function generateVoice(request: LiveRequest): Promise<LiveProgress> {
  const config = relayConfig();
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(config.url, {
      agent: voiceWebSocketAgent(config.url),
      headers: { Authorization: `Bearer ${config.token}` },
      handshakeTimeout: 25_000, maxPayload: 2 * 1024 * 1024,
      perMessageDeflate: false, followRedirects: false,
    });
    let settled = false, ready = false, audioBytes = 0, offset = 0;
    let pump: ReturnType<typeof setTimeout> | undefined;
    let endGrace: ReturnType<typeof setTimeout> | undefined;
    const progress: LiveProgress = {
      inputText: request.text ?? '', outputText: '', inputTranscriptComplete: request.text !== undefined,
      outputTranscriptComplete: false, usage: null,
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true; clearTimeout(deadline); clearTimeout(setupDeadline);
      clearTimeout(pump); clearTimeout(endGrace);
      request.signal.removeEventListener('abort', abort);
      socket.terminate();
      if (error) reject(error); else resolve(progress);
    };
    const complete = () => {
      if (settled) return;
      if (!audioBytes || audioBytes % 2) {
        finish(new VoiceError('VOICE_EMPTY_OR_INCOMPLETE_AUDIO', 502));
        return;
      }
      // Current Live transcription events omit `finished`. A drained final turn
      // closes nonempty transcripts; absent transcripts still use audio history.
      if (progress.inputText.trim()) progress.inputTranscriptComplete = true;
      if (progress.outputText.trim()) progress.outputTranscriptComplete = true;
      request.onProgress(progress);
      finish();
    };
    const abort = () => finish(new VoiceError('VOICE_CANCELLED', 409));
    const deadline = setTimeout(() => finish(new VoiceError('VOICE_RESPONSE_TIMEOUT', 504)),
      90_000 + request.pcm.length / 32);
    const setupDeadline = setTimeout(() => finish(new VoiceError('VOICE_SETUP_TIMEOUT', 504)), 25_000);
    request.signal.addEventListener('abort', abort, { once: true });
    if (request.signal.aborted) { abort(); return; }
    const send = (body: unknown) => socket.send(JSON.stringify(body));
    socket.on('open', () => send({ setup: {
      model: `models/${VOICE_MODEL}`,
      generationConfig: { responseModalities: ['AUDIO'], speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: request.voiceName } },
      } },
      systemInstruction: { parts: [{ text: request.prompt }] },
      inputAudioTranscription: {}, outputAudioTranscription: {},
      realtimeInputConfig: { automaticActivityDetection: { disabled: true } },
    } }));
    function pumpAudio(): void {
      if (settled) return;
      if (socket.bufferedAmount > 512 * 1024) {
        pump = setTimeout(pumpAudio, 20); return;
      }
      if (offset >= request.pcm.length) {
        send({ realtimeInput: { activityEnd: {} } }); return;
      }
      const chunk = request.pcm.subarray(offset, offset + 3200); // 100 ms, paced to avoid input-buffer loss
      offset += chunk.length;
      send({ realtimeInput: { audio: { mimeType: 'audio/pcm;rate=16000', data: chunk.toString('base64') } } });
      pump = setTimeout(pumpAudio, 100);
    }
    socket.on('message', (raw) => {
      if (settled) return;
      try {
        const message = JSON.parse(raw.toString());
        if (message.error) throw new VoiceError('VOICE_UPSTREAM_REJECTED', 502);
        if (message.setupComplete && !ready) {
          ready = true; clearTimeout(setupDeadline);
          if (request.text !== undefined) {
            send({ clientContent: { turns: [...request.history, { role: 'user', parts: [{ text: request.text }] }], turnComplete: true } });
            return;
          }
          if (request.history.length) send({ clientContent: { turns: request.history, turnComplete: false } });
          send({ realtimeInput: { activityStart: {} } });
          pumpAudio();
        }
        if (message.usageMetadata) progress.usage = message.usageMetadata;
        const content = message.serverContent;
        if (content) {
          if (content.interrupted) throw new VoiceError('VOICE_UPSTREAM_INTERRUPTED', 502);
          for (const part of content.modelTurn?.parts ?? []) {
            const inline = part.inlineData;
            if (!inline) continue;
            if (typeof inline.data !== 'string' || !/^audio\/pcm(?:;rate=24000)?$/.test(inline.mimeType)) {
              throw new VoiceError('VOICE_OUTPUT_FORMAT', 502);
            }
            const pcm = Buffer.from(inline.data, 'base64');
            audioBytes += pcm.length;
            if (audioBytes > MAX_OUTPUT_SECONDS * 48000) throw new VoiceError('VOICE_OUTPUT_TOO_LONG', 502);
            request.onAudio(pcm);
          }
          if (content.inputTranscription) {
            progress.inputText += content.inputTranscription.text ?? '';
            progress.inputTranscriptComplete = Boolean(content.inputTranscription.finished);
          }
          if (content.outputTranscription) {
            progress.outputText += content.outputTranscription.text ?? '';
            progress.outputTranscriptComplete = Boolean(content.outputTranscription.finished);
          }
          if (content.generationComplete && progress.outputText) progress.outputTranscriptComplete = true;
          if (progress.inputText.length + progress.outputText.length > 120_000) throw new VoiceError('VOICE_TRANSCRIPT_TOO_LARGE', 502);
          request.onProgress(progress);
          if (content.turnComplete && content.interactionStatus !== 'IN_PROGRESS' && !endGrace) {
            // Input transcription has no ordering guarantee. Briefly drain late transcript events.
            endGrace = setTimeout(complete, 500);
          }
        } else if (message.usageMetadata) request.onProgress(progress);
        if (message.goAway && !endGrace) throw new VoiceError('VOICE_UPSTREAM_GOING_AWAY', 502);
      } catch (error) {
        finish(error instanceof VoiceError ? error : new VoiceError('VOICE_PROTOCOL_ERROR', 502));
      }
    });
    socket.on('error', () => finish(new VoiceError('VOICE_UPSTREAM_CONNECTION_FAILED', 502)));
    socket.on('unexpected-response', (_req, response) => {
      response.resume(); finish(new VoiceError('VOICE_RELAY_REJECTED', 502));
    });
    socket.on('close', () => endGrace ? complete() : finish(new VoiceError('VOICE_UPSTREAM_DISCONNECTED', 502)));
  });
}
