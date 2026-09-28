import { useCallback, useRef } from 'react';
import type { ChatMessage, ChatRequest, Character, Stage, Boundary, StructuredMessagePart } from '@yelan/shared';
import { openChatStream } from '../api/sse';
import { recall } from '../memory/recall';
import { onRoundComplete } from '../memory/sync';
import { useSessionStore } from '../stores/sessionStore';
import { useChatStore, type DisplayChunk } from '../stores/chatStore';
import { createLocalSessionId } from '../chat/local-history';

interface UseChatArgs {
  character: Character | null;
  sessionId?: string;
  initialBoundary?: Boundary;
}

export interface UseChatResult {
  messages: ChatMessage[];
  liveChunks: DisplayChunk[];
  liveText: string;
  sending: boolean;
  stage: Stage;
  boundary: Boundary;
  temperature: number;
  ifActive: boolean;
  structuredParts: Record<string, StructuredMessagePart[]>;
  sessionId: string | null;
  send: (text: string) => Promise<void>;
  cancel: () => void;
  clear: () => void;
}

export function useChat({
  character,
}: UseChatArgs): UseChatResult {
  const ctrlRef = useRef<AbortController | null>(null);

  const send = useCallback(
    async (text: string) => {
      if (!character || useChatStore.getState().sending || !text.trim()) return;
      const sessionId =
        useChatStore.getState().sessionId ?? createLocalSessionId(character.id);
      if (!useChatStore.getState().sessionId) {
        useChatStore.getState().resetForLocalSession(sessionId, character.openingLines.firstVisit);
      }
      useChatStore.getState().setSending(true);
      useChatStore.getState().clearLiveChunks();

      const userMsg: ChatMessage = { role: 'user', content: text };
      const history = useChatStore.getState().messages;
      // 延迟保存用户消息，只有在 SSE 流成功开始后才保存
      // useChatStore.getState().addUserMessage(userMsg);  // 移到下面

      // 显式取消旧请求（防御性编程）
      if (ctrlRef.current) {
        ctrlRef.current.abort();
      }

      const ctrl = new AbortController();
      ctrlRef.current = ctrl;

      const remembered = await recall({
        characterId: character.id,
        mode: 'main',
        query: text,
        topK: 5,
      });

      const req: ChatRequest = {
        characterId: character.id,
        sessionId,
        round: useChatStore.getState().round,
        prevStage: useChatStore.getState().stage,
        userBoundary: useChatStore.getState().boundary,
        text,
        history,
        recall: {
          preferences: remembered.preferences.map((p) => p.text),
          events: remembered.events.map((e) => ({ date: e.date, text: e.text, emotion: e.emotion })),
        },
      };

      let assistantBuf = '';
      let assistantParts: StructuredMessagePart[] | null = null;
      let streamStarted = false;  // 标记流是否成功开始
      let wasAborted = false;  // 标记是否被用户主动中止

      try {
        for await (const ev of openChatStream(req, ctrl.signal)) {
          // 第一个事件到达，说明请求成功，现在保存用户消息
          if (!streamStarted) {
            useChatStore.getState().addUserMessage(userMsg);
            streamStarted = true;
          }

          switch (ev.kind) {
            case 'chunk':
              assistantBuf += ev.text;
              break;
            case 'meta':
              useChatStore.getState().setStage(ev.stage);
              useChatStore.getState().setBoundary(ev.boundary);
              if (ev.ifActive != null) useChatStore.getState().setIfActive(ev.ifActive);
              useSessionStore.getState().setStage(ev.stage);
              useSessionStore.getState().setBoundary(ev.boundary);
              break;
            case 'atmosphere':
              useChatStore.getState().setTemperature(ev.temperature);
              useSessionStore.getState().setTemperature(ev.temperature);
              break;
            case 'structured':
              assistantBuf = ev.rawText;
              assistantParts = ev.parts;
              if (import.meta.env.DEV) {
                if (ev.source === 'fallback') {
                  console.warn(`[分句] 走了正则 fallback，未用真实分句 AI。降级原因=${ev.degradeReason ?? 'unknown'}`);
                } else if (ev.source === 'sidecar') {
                  console.info('[分句] 真实分句 AI 生效，已分型');
                }
              }
              break;
            case 'achievement':
              useSessionStore.getState().pushAchievement({ slug: ev.slug });
              break;
            case 'cutoff':
              useSessionStore.getState().cutoff();
              break;
            case 'error':
              throw new Error(`${ev.code}: ${ev.message}`);
            case 'done':
              break;
          }
          if (ev.kind === 'done' || ev.kind === 'cutoff') break;
        }
      } catch (e) {
        // 区分不同类型的错误
        if (e instanceof Error && e.name === 'AbortError') {
          console.log('[chat] 用户取消了本轮对话');
          wasAborted = true;
        } else {
          console.warn('[chat] stream error:', (e as Error).message);

          // 如果请求彻底失败且用户消息未保存，通知用户
          if (!streamStarted) {
            console.error('[chat] 请求失败，消息未发送');
            // TODO: 可以在这里显示一个Toast通知用户
          }
        }
      } finally {
        // 只有成功开始且未被中止才保存 assistant 回复
        if (assistantBuf && streamStarted && !wasAborted) {
          if (assistantParts && assistantParts.length > 0) {
            useChatStore.getState().addStructuredAssistantMessage(assistantBuf, assistantParts);
          } else {
            useChatStore.getState().addAssistantMessage(assistantBuf);
          }
        } else if (wasAborted && assistantBuf) {
          console.log(`[chat] 已丢弃被中止的部分回复 (${assistantBuf.length}字符)`);
        }
        useChatStore.getState().clearLiveChunks();

        // 只有成功完成才增加轮次
        if (streamStarted && !wasAborted) {
          useChatStore.getState().incrementRound();
          onRoundComplete();
        }

        useChatStore.getState().setSending(false);
      }
    },
    [character],
  );

  const cancel = useCallback(() => {
    ctrlRef.current?.abort();
  }, []);

  const clear = useCallback(() => {
    useChatStore.getState().clear();
  }, []);

  // Subscribe to individual store slices for React reactivity
  const messages = useChatStore((s) => s.messages);
  const liveChunks = useChatStore((s) => s.liveChunks);
  const sending = useChatStore((s) => s.sending);
  const stage = useChatStore((s) => s.stage);
  const boundary = useChatStore((s) => s.boundary);
  const temperature = useChatStore((s) => s.temperature);
  const ifActive = useChatStore((s) => s.ifActive);
  const structuredParts = useChatStore((s) => s.structuredParts);
  const sessionId = useChatStore((s) => s.sessionId);

  return {
    messages,
    liveChunks,
    liveText: liveChunks.map((c) => c.text).join(''),
    sending,
    stage,
    boundary,
    temperature,
    ifActive,
    structuredParts,
    sessionId,
    send,
    cancel,
    clear,
  };
}
