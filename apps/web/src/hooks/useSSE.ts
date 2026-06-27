// SSE 消费钩子：把流转成 ChatStreamEvent[]，供组件 useEffect 消费
// 通常上层用 useChat 而不是直接用这个
import { useEffect, useRef, useState } from 'react';
import type { ChatRequest, ChatStreamEvent } from '@yelan/shared';
import { openChatStream } from '../api/sse';

export type SSEState = 'idle' | 'streaming' | 'done' | 'error';

export interface UseSSEResult {
  events: ChatStreamEvent[];
  state: SSEState;
  error: Error | null;
  cancel: () => void;
}

export function useSSE(body: ChatRequest | null): UseSSEResult {
  const [events, setEvents] = useState<ChatStreamEvent[]>([]);
  const [state, setState] = useState<SSEState>('idle');
  const [error, setError] = useState<Error | null>(null);
  const ctrlRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!body) return;
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    setEvents([]);
    setState('streaming');
    setError(null);

    (async () => {
      try {
        for await (const ev of openChatStream(body, ctrl.signal)) {
          setEvents((prev) => [...prev, ev]);
          if (ev.kind === 'error') setError(new Error(ev.message));
          if (ev.kind === 'done') setState('done');
        }
        setState((s) => (s === 'streaming' ? 'done' : s));
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        setError(e as Error);
        setState('error');
      }
    })();

    return () => ctrl.abort();
  }, [body]);

  return {
    events,
    state,
    error,
    cancel: () => ctrlRef.current?.abort(),
  };
}
