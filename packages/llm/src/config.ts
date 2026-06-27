export interface LlmProviderConfig {
  id: string;
  protocol: 'openai-compatible' | 'anthropic' | 'nvidia';
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface LlmRouterConfig {
  providers: LlmProviderConfig[];
  mainProviderId: string | null;
}
