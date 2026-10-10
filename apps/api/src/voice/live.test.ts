import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocketServer } from 'ws';
import type { AddressInfo } from 'node:net';
import { generateVoice } from './live';

afterEach(() => vi.unstubAllEnvs());

async function upstreamTest(sendResponse: (socket: import('ws').WebSocket) => void,
  verify: (result: ReturnType<typeof generateVoice>, audio: Buffer[]) => Promise<void>) {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>(resolve => server.once('listening', resolve));
  vi.stubEnv('DEPLOY_MODE', 'local');
  vi.stubEnv('VOICE_RELAY_URL', `ws://127.0.0.1:${(server.address() as AddressInfo).port}/google-live`);
  vi.stubEnv('VOICE_RELAY_TOKEN', 'test-live-protocol-token-0000000000000000');
  server.on('connection', socket => socket.on('message', raw => {
    const message = JSON.parse(raw.toString());
    if (message.setup) socket.send(JSON.stringify({ setupComplete: {} }));
    if (message.clientContent) sendResponse(socket);
  }));
  const audio: Buffer[] = [];
  try {
    await verify(generateVoice({ prompt: '测试', voiceName: 'Puck', history: [], pcm: Buffer.alloc(0),
      text: '你好', signal: new AbortController().signal, onAudio: x => audio.push(x), onProgress: () => {} }), audio);
  } finally {
    for (const client of server.clients) client.terminate();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

const final = { serverContent: { modelTurn: { parts: [{ inlineData: {
  mimeType: 'audio/pcm;rate=24000', data: Buffer.alloc(9600, 1).toString('base64'),
} }] }, inputTranscription: { text: '测试输入' }, outputTranscription: { text: '测试回答' },
generationComplete: true, turnComplete: true, interactionStatus: 'IDLE' } };

describe('Live final-turn protocol', () => {
  it('waits through an intermediate turnComplete with no audio', async () => {
    await upstreamTest(socket => {
      socket.send(JSON.stringify({ serverContent: { turnComplete: true, interactionStatus: 'IN_PROGRESS' } }));
      setTimeout(() => { if (socket.readyState === 1) socket.send(JSON.stringify(final)); }, 30);
    }, async (result, audio) => {
      expect(await result).toMatchObject({ inputText: '你好测试输入', outputText: '测试回答',
        inputTranscriptComplete: true, outputTranscriptComplete: true });
      expect(Buffer.concat(audio)).toHaveLength(9600);
    });
  });
  it('drains final transcription events without the legacy finished field', async () => {
    await upstreamTest(socket => {
      socket.send(JSON.stringify({ serverContent: { modelTurn: final.serverContent.modelTurn,
        turnComplete: true, interactionStatus: 'IDLE' } }));
      setTimeout(() => { if (socket.readyState === 1) socket.send(JSON.stringify({ serverContent: {
        inputTranscription: { text: '后到的输入' }, outputTranscription: { text: '后到的回答' },
      } })); }, 30);
    }, async result => {
      expect(await result).toMatchObject({ inputText: '你好后到的输入', outputText: '后到的回答',
        inputTranscriptComplete: true, outputTranscriptComplete: true });
    });
  });
  it('keeps a genuinely empty final turn failed even when the socket closes during grace', async () => {
    await upstreamTest(socket => {
      socket.send(JSON.stringify({ serverContent: { turnComplete: true, interactionStatus: 'IDLE' } }));
      socket.close();
    }, async result => { await expect(result).rejects.toMatchObject({ code: 'VOICE_EMPTY_OR_INCOMPLETE_AUDIO' }); });
  });
});
