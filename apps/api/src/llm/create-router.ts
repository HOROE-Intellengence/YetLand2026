import { LlmRouter, type LlmProviderConfig } from '@yelan/llm';
import { getMainRouterConfigs } from '../services/llm-api-inventory';

let _router: LlmRouter | null = null;

export function getRouter(): LlmRouter {
  if (!_router) {
    const configs = getMainRouterConfigs();

    const providers: LlmProviderConfig[] = configs.map((c) => ({
      id: c.id,
      protocol: c.protocol,
      apiKey: c.apiKey,
      baseUrl: c.baseUrl,
      model: c.model,
    }));

    _router = new LlmRouter({
      providers,
      mainProviderId: configs[0]?.id ?? null,
    });
  }
  return _router;
}

export function resetRouter(): void {
  _router = null;
}
