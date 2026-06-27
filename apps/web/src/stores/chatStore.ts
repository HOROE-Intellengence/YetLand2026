import { create } from 'zustand';
import { DEFAULT_USER_BOUNDARY, type ChatMessage, type Stage, type Boundary, type StructuredMessagePart } from '@yelan/shared';
import type { LocalChatSnapshot } from '../chat/local-history';

export interface DisplayChunk {
  text: string;
  glow?: boolean;
  sentenceEnd?: boolean;
}

interface ChatState {
  messages: ChatMessage[];
  liveChunks: DisplayChunk[];
  sending: boolean;
  stage: Stage;
  boundary: Boundary;
  temperature: number;
  // 仅在暗号激活（IF）会话中为 true —— 决定前端是否显示温度指示。
  ifActive: boolean;
  structuredParts: Record<string, StructuredMessagePart[]>;
  round: number;
  sessionId: string | null;

  addUserMessage: (msg: ChatMessage) => void;
  addAssistantMessage: (content: string) => void;
  addStructuredAssistantMessage: (content: string, parts: StructuredMessagePart[]) => void;
  appendLiveChunk: (chunk: DisplayChunk) => void;
  clearLiveChunks: () => void;
  setSending: (v: boolean) => void;
  setStage: (s: Stage) => void;
  setBoundary: (b: Boundary) => void;
  setTemperature: (t: number) => void;
  setIfActive: (v: boolean) => void;
  setStructuredPart: (rawText: string, parts: StructuredMessagePart[]) => void;
  hydrateLocalSnapshot: (snapshot: LocalChatSnapshot) => void;
  resetForLocalSession: (sessionId: string, openingLine?: string) => void;
  incrementRound: () => void;
  clear: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  liveChunks: [],
  sending: false,
  stage: 'daily' as Stage,
  boundary: DEFAULT_USER_BOUNDARY as Boundary,
  temperature: 3,
  ifActive: false,
  structuredParts: {},
  round: 0,
  sessionId: null,

  addUserMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
  addAssistantMessage: (content) =>
    set((s) => ({ messages: [...s.messages, { role: 'assistant', content }] })),
  addStructuredAssistantMessage: (content, parts) =>
    set((s) => ({
      messages: [...s.messages, { role: 'assistant', content }],
      structuredParts: { ...s.structuredParts, [content]: parts },
    })),
  appendLiveChunk: (chunk) =>
    set((s) => ({ liveChunks: [...s.liveChunks, chunk] })),
  clearLiveChunks: () => set({ liveChunks: [] }),
  setSending: (sending) => set({ sending }),
  setStage: (stage) => set({ stage }),
  setBoundary: (boundary) => set({ boundary }),
  setTemperature: (temperature) => set({ temperature }),
  setIfActive: (ifActive) => set({ ifActive }),
  setStructuredPart: (rawText, parts) =>
    set((s) => ({ structuredParts: { ...s.structuredParts, [rawText]: parts } })),
  hydrateLocalSnapshot: (snapshot) =>
    set({
      messages: snapshot.messages,
      liveChunks: [],
      sending: false,
      stage: snapshot.stage,
      boundary: snapshot.boundary,
      temperature: snapshot.temperature,
      structuredParts: snapshot.structuredParts,
      round: snapshot.round,
      sessionId: snapshot.sessionId,
    }),
  resetForLocalSession: (sessionId, openingLine) => {
    const cleanOpeningLine = openingLine?.trim();
    set({
      messages: cleanOpeningLine ? [{ role: 'assistant', content: cleanOpeningLine }] : [],
      liveChunks: [],
      sending: false,
      stage: 'daily' as Stage,
      boundary: DEFAULT_USER_BOUNDARY as Boundary,
      temperature: 3,
      ifActive: false,
      structuredParts: {},
      round: 0,
      sessionId,
    });
  },
  incrementRound: () => set((s) => ({ round: s.round + 1 })),
  clear: () =>
    set({
      messages: [],
      liveChunks: [],
      sending: false,
      stage: 'daily' as Stage,
      boundary: DEFAULT_USER_BOUNDARY as Boundary,
      temperature: 3,
      ifActive: false,
      structuredParts: {},
      round: 0,
      sessionId: null,
    }),
}));
