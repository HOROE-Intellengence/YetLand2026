import { useRef, useEffect, useState } from 'react';
import type { StructuredMessagePart } from '@yelan/shared';
import { useChat } from '../hooks/useChat';
import { useViewport } from '../hooks/useViewport';
import { useSessionStore } from '../stores/sessionStore';
import { useChatStore } from '../stores/chatStore';
import { DialogueText } from '../components/conversation/DialogueText';
import { MathText } from '../components/conversation/MathText';
import { createLocalSessionId, loadLocalChat, saveLocalChat } from '../chat/local-history';
import { getChatScopeId } from '../api/client';

import { TypingDots } from '../components/conversation/TypingDots';
import styles from './Conversation.module.css';

// textarea 自增高上限（约 5 行），超出后内部滚动
const TEXTAREA_MAX_HEIGHT = 140;

function autoGrowTextarea(el: HTMLTextAreaElement): void {
  el.style.height = 'auto';
  const next = Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT);
  el.style.height = `${next}px`;
  el.style.overflowY = el.scrollHeight > TEXTAREA_MAX_HEIGHT ? 'auto' : 'hidden';
}

function partClass(type: StructuredMessagePart['type']): string {
  switch (type) {
    case 'dialogue':
      return styles.dialoguePart!;
    case 'action':
      return styles.actionPart!;
    case 'environment':
      return styles.envPart!;
    default:
      return styles.narrationPart!;
  }
}

function StructuredParts({ parts }: { parts: StructuredMessagePart[] }) {
  const [visibleCount, setVisibleCount] = useState(() => (parts.length > 0 ? 1 : 0));
  const visibleParts = parts.slice(0, visibleCount);

  useEffect(() => {
    setVisibleCount(parts.length > 0 ? 1 : 0);
  }, [parts]);

  useEffect(() => {
    if (visibleCount >= parts.length) return;
    const timer = window.setTimeout(() => {
      setVisibleCount((count) => Math.min(count + 1, parts.length));
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [parts.length, visibleCount]);

  return (
    <>
      {visibleParts.map((p, i) => (
        <span key={i} className={partClass(p.type)}>
          <DialogueText>
            <MathText>{p.text}</MathText>
          </DialogueText>
        </span>
      ))}
    </>
  );
}

function AssistantContent({
  content,
  parts,
}: {
  content: string;
  parts?: StructuredMessagePart[];
}) {
  if (parts && parts.length > 0) {
    return <StructuredParts parts={parts} />;
  }
  return (
    <span className={styles.plainText}>
      <MathText>{content}</MathText>
    </span>
  );
}

export function Conversation() {
  const character = useSessionStore((s) => s.character);
  const goSelect = useSessionStore((s) => s.goSelect);
  const {
    messages,
    liveChunks,
    sending,
    temperature,
    ifActive,
    structuredParts,
    sessionId,
    send,
    cancel,
  } = useChat({ character });
  const stage = useChatStore((s) => s.stage);
  const boundary = useChatStore((s) => s.boundary);
  const round = useChatStore((s) => s.round);
  const [hydratedCharacterId, setHydratedCharacterId] = useState<string | null>(null);

  // 挂载视口钩子：写入 --keyboard-inset 供 .inputBar 消费；keyboardInset 驱动重滚
  const { keyboardInset } = useViewport();

  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // 新消息到达 / 键盘弹收时自动滚到底部，保证最新消息与输入框可见
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, liveChunks, sending, keyboardInset]);

  useEffect(() => {
    if (!character) return;
    const userId = getChatScopeId();
    const snapshot = userId ? loadLocalChat(character.id, userId) : null;
    // 空 messages 快照视同无快照 —— 否则 openingLine 永远没机会注入：
    // 早期某次 openingFirstVisit=='' 时落了一份 messages:[] 快照，之后即使
    // 后端把开场白补回来，hydrate 仍会重写 messages 为 []，进入「点进去空白」死循环。
    if (snapshot && snapshot.messages.length > 0) {
      useChatStore.getState().hydrateLocalSnapshot(snapshot);
    } else {
      useChatStore
        .getState()
        .resetForLocalSession(
          snapshot?.sessionId ?? createLocalSessionId(character.id),
          character.openingLines.firstVisit,
        );
    }
    setHydratedCharacterId(character.id);
  }, [character]);

  useEffect(() => {
    if (!character || hydratedCharacterId !== character.id || !sessionId) return;
    // 别把空 messages 落盘 —— 否则一旦 reset 写空（openingLine 缺失时），
    // 这份空快照会反过来污染下一次 hydrate，触发「点进去空白」死循环。
    if (messages.length === 0) return;
    const userId = getChatScopeId();
    if (!userId) return;
    saveLocalChat({
      version: 2,
      characterId: character.id,
      ownerUserId: userId,
      sessionId,
      messages,
      structuredParts,
      round,
      stage,
      boundary,
      temperature,
      updatedAt: new Date().toISOString(),
    });
  }, [
    boundary,
    character,
    hydratedCharacterId,
    messages,
    round,
    sessionId,
    stage,
    structuredParts,
    temperature,
  ]);

  const handleSend = () => {
    const text = inputRef.current?.value.trim();
    if (!text || sending) return;
    inputRef.current!.value = '';
    autoGrowTextarea(inputRef.current!); // 复位为单行高度
    void send(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // 聚焦后键盘有弹出动画，延后再滚到底，确保最新消息与输入框落在可视视口内
  const handleFocus = () => {
    window.setTimeout(() => {
      if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
      inputRef.current?.scrollIntoView({ block: 'nearest' });
    }, 300);
  };

  return (
    <div className={styles.wrap}>
      <button
        aria-label="返回主页"
        className={styles.backBtn}
        disabled={sending}
        onClick={goSelect}
        title="返回主页"
        type="button"
      >
        ←
      </button>

      {/* 温度指示 —— 仅暗号激活或开发者模式可见 */}
      {(ifActive || import.meta.env.DEV) && (
        <div className={styles.tempBadge}>
          {temperature >= 4 ? '🔥' : temperature <= 2 ? '❄️' : '🌡️'} {temperature}/5
        </div>
      )}

      {/* 消息列表 */}
      <div className={styles.messageList} ref={listRef}>
        {messages.map((m, i) => (
          <div
            key={i}
            className={m.role === 'user' ? styles.userMsg : styles.assistantMsg}
          >
            {m.role === 'assistant' ? (
              <AssistantContent
                content={m.content}
                parts={structuredParts[m.content]}
              />
            ) : (
              <span>
                <MathText>{m.content}</MathText>
              </span>
            )}
          </div>
        ))}

        {/* 实时流式输出 */}
        {sending && (
          <div className={styles.liveArea}>
            <TypingDots />
          </div>
        )}
      </div>

      {/* 输入栏 */}
      <div className={styles.inputBar}>
        <div className={styles.inputField}>
          <textarea
            ref={inputRef}
            className={styles.input}
            placeholder="输入消息..."
            rows={1}
            disabled={sending}
            onKeyDown={handleKeyDown}
            onInput={(e) => autoGrowTextarea(e.currentTarget)}
            onFocus={handleFocus}
          />
        </div>
        {sending ? (
          <button className={styles.sendBtn} onClick={cancel} type="button">
            停止
          </button>
        ) : (
          <button className={styles.sendBtn} onClick={handleSend} type="button">
            发送
          </button>
        )}
      </div>
    </div>
  );
}
