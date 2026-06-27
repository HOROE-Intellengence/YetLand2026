// 侧袋 AI 类型 — 从 @yelan/shared 导入并补充服务端内部类型
import type {
  SidecarPromptKey,
  SidecarPromptsMap,
  OutputStructurerResult,
  AtmosphereInput,
  AtmosphereResult,
  PreferenceRecordResult,
  QuotaEndingResult,
  ContextCompressResult,
} from '@yelan/shared';

export type {
  SidecarPromptKey,
  SidecarPromptsMap,
  OutputStructurerResult,
  AtmosphereInput,
  AtmosphereResult,
  PreferenceRecordResult,
  QuotaEndingResult,
  ContextCompressResult,
};

// 侧袋 AI 通用结果包装
export interface SidecarResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}
