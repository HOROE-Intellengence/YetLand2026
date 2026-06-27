import { DEFAULT_USER_BOUNDARY } from '@yelan/shared';
import { describe, expect, it, beforeEach } from 'vitest';
import { useChatStore } from '../chatStore';

describe('chatStore', () => {
  beforeEach(() => {
    useChatStore.getState().clear();
  });

  it('starts with default state', () => {
    const s = useChatStore.getState();
    expect(s.messages).toEqual([]);
    expect(s.liveChunks).toEqual([]);
    expect(s.sending).toBe(false);
    expect(s.stage).toBe('daily');
    expect(s.boundary).toBe(DEFAULT_USER_BOUNDARY);
    expect(s.temperature).toBe(3);
    expect(s.round).toBe(0);
    expect(s.sessionId).toBeNull();
  });

  it('addUserMessage appends a message', () => {
    useChatStore.getState().addUserMessage({ role: 'user', content: '你好' });
    expect(useChatStore.getState().messages).toHaveLength(1);
    expect(useChatStore.getState().messages[0]).toEqual({ role: 'user', content: '你好' });
  });

  it('addAssistantMessage appends an assistant message', () => {
    useChatStore.getState().addAssistantMessage('回复内容');
    const msgs = useChatStore.getState().messages;
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toEqual({ role: 'assistant', content: '回复内容' });
  });

  it('addStructuredAssistantMessage stores both content and parts', () => {
    const parts = [{ type: 'dialogue' as const, text: '分段1' }];
    useChatStore.getState().addStructuredAssistantMessage('全文', parts);
    const s = useChatStore.getState();
    expect(s.messages).toHaveLength(1);
    expect(s.structuredParts['全文']).toEqual(parts);
  });

  it('appendLiveChunk accumulates chunks', () => {
    useChatStore.getState().appendLiveChunk({ text: '第', sentenceEnd: false });
    useChatStore.getState().appendLiveChunk({ text: '一句', sentenceEnd: true, glow: true });
    expect(useChatStore.getState().liveChunks).toHaveLength(2);
  });

  it('clearLiveChunks empties live chunks', () => {
    useChatStore.getState().appendLiveChunk({ text: 'test' });
    useChatStore.getState().clearLiveChunks();
    expect(useChatStore.getState().liveChunks).toEqual([]);
  });

  it('setSending toggles sending flag', () => {
    useChatStore.getState().setSending(true);
    expect(useChatStore.getState().sending).toBe(true);
    useChatStore.getState().setSending(false);
    expect(useChatStore.getState().sending).toBe(false);
  });

  it('setStage updates stage', () => {
    useChatStore.getState().setStage('climax');
    expect(useChatStore.getState().stage).toBe('climax');
  });

  it('setTemperature updates temperature', () => {
    useChatStore.getState().setTemperature(5);
    expect(useChatStore.getState().temperature).toBe(5);
  });

  it('incrementRound increases round', () => {
    useChatStore.getState().incrementRound();
    useChatStore.getState().incrementRound();
    expect(useChatStore.getState().round).toBe(2);
  });

  it('resetForLocalSession clears messages and sets sessionId', () => {
    useChatStore.getState().addUserMessage({ role: 'user', content: 'test' });
    useChatStore.getState().resetForLocalSession('sess_abc');
    const s = useChatStore.getState();
    expect(s.messages).toEqual([]);
    expect(s.sessionId).toBe('sess_abc');
    expect(s.round).toBe(0);
    expect(s.temperature).toBe(3);
  });

  it('resetForLocalSession can seed the first assistant opening line', () => {
    useChatStore.getState().resetForLocalSession('sess_opening', '  今夜，你来得比我想得早。  ');
    const s = useChatStore.getState();
    expect(s.sessionId).toBe('sess_opening');
    expect(s.messages).toEqual([{ role: 'assistant', content: '今夜，你来得比我想得早。' }]);
    expect(s.round).toBe(0);
  });

  it('hydrateLocalSnapshot restores full state', () => {
    useChatStore.getState().hydrateLocalSnapshot({
      version: 2,
      characterId: 'jiang-bai',
      ownerUserId: 'usr_test',
      sessionId: 'sess_restored',
      messages: [{ role: 'user', content: '你好' }, { role: 'assistant', content: '你好呀' }],
      structuredParts: { '你好呀': [{ type: 'dialogue', text: '你好呀' }] },
      round: 5,
      stage: 'climax',
      boundary: 3,
      temperature: 4,
      updatedAt: new Date().toISOString(),
    });
    const s = useChatStore.getState();
    expect(s.messages).toHaveLength(2);
    expect(s.sessionId).toBe('sess_restored');
    expect(s.round).toBe(5);
    expect(s.stage).toBe('climax');
    expect(s.boundary).toBe(3);
    expect(s.temperature).toBe(4);
  });
});
