import { describe, expect, it } from 'vitest';
import { ChatRequestSchema, ChatStreamEventSchema, TelemetryBatchSchema } from './chat';

describe('chat schemas', () => {
  it('accepts a valid chat request', () => {
    expect(() =>
      ChatRequestSchema.parse({
        characterId: 'shen-yan-zhi',
        sessionId: 'sess_1',
        round: 0,
        prevStage: 'daily',
        userBoundary: 2,
        text: '你好',
        history: [],
      }),
    ).not.toThrow();
  });

  it('rejects invalid stage and boundary values', () => {
    expect(() =>
      ChatRequestSchema.parse({
        characterId: 'shen-yan-zhi',
        sessionId: 'sess_1',
        round: 0,
        prevStage: 'unknown',
        userBoundary: 9,
        text: '你好',
        history: [],
      }),
    ).toThrow();
  });

  it('validates stream events and telemetry batches', () => {
    expect(ChatStreamEventSchema.parse({
      kind: 'meta',
      stage: 'daily',
      boundary: 2,
      mainProviderId: 'horoe-main',
      mainModel: 'gemini-3.1-flash-lite',
    })).toEqual({
      kind: 'meta',
      stage: 'daily',
      boundary: 2,
      mainProviderId: 'horoe-main',
      mainModel: 'gemini-3.1-flash-lite',
    });
    expect(() => ChatStreamEventSchema.parse({ kind: 'chunk' })).toThrow();
    expect(TelemetryBatchSchema.parse({ events: [{ name: 'open', ts: 1 }] }).events).toHaveLength(1);
  });
});
