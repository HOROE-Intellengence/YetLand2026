import type { CompletionRequest } from '@yelan/llm';

export function withCacheControl(req: CompletionRequest): CompletionRequest {
  return {
    ...req,
    cacheControl: { type: 'ephemeral' },
  };
}
