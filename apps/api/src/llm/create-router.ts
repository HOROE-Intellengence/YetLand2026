import { LlmRouter, type LlmProviderConfig } from '@yelan/llm';
import { getMainRouterConfigs } from '../services/llm-api-inventory';
import { isPhoneTextModelScope } from '../services/llm-scope';

let _router: LlmRouter | null = null;
let _phoneRouter: LlmRouter | null = null;

export function getRouter(): LlmRouter {
  const phone = isPhoneTextModelScope();
  let router = phone ? _phoneRouter : _router;
  if (!router) {
    const configs = getMainRouterConfigs();

    const providers: LlmProviderConfig[] = configs.map((c) => ({
      id: c.id,
      protocol: c.protocol,
      apiKey: c.apiKey,
      baseUrl: c.baseUrl,
      model: c.model,
    }));

    router = new LlmRouter({
      providers,
      mainProviderId: configs[0]?.id ?? null,
    });
    if (phone) _phoneRouter = router;
    else _router = router;
  }
  return router;
}

export function resetRouter(): void {
  _router = null;
  _phoneRouter = null;
}
