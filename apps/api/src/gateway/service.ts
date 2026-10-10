import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GatewayDatabase, GatewayError, gatewayRoot } from './database';
import type { Identity } from './database';
import { store } from '../store/persistence';
import { ensureLlmApiInventorySeeded } from '../services/llm-api-inventory';

let singleton: GatewayDatabase | undefined;
export function gatewayDatabase() {
  if (!singleton) {
    singleton = new GatewayDatabase(
      gatewayRoot(),
      readFileSync(fileURLToPath(new URL('./initial-prelude.md', import.meta.url)), 'utf8'),
    );
    singleton.recover();
  }
  return singleton;
}
export function accountIdentity(id: string): Identity | undefined {
  const u = store.state().users[id];
  if (!u) return undefined;
  // Never copy tokens or password hashes into request archives.
  return {
    id: u.id,
    name: u.name,
    phone: u.phone,
    email: u.email,
    createdAt: u.createdAt,
    isGuest: u.isGuest,
    deletedAt: u.deletedAt,
    registration: u.registrationIdentity ?? null,
  };
}
export interface Upstream {
  id: string;
  url: string;
  key: string;
  model: string;
}
export function gatewayUpstream(id: string): Upstream {
  ensureLlmApiInventorySeeded();
  const e = store.state().llmApiInventory.entries[id];
  if (
    !e?.enabled ||
    !e.apiKey ||
    e.protocol !== 'openai-compatible' ||
    !/^gemini-/i.test(e.model)
  ) {
    throw new GatewayError('UPSTREAM_UNAVAILABLE', 503, 'API 模型暂不可用，请联系管理员检查上游配置');
  }
  let url: URL;
  try {
    url = new URL(
      e.baseUrl.replace(/\/+$/, '').replace(/\/chat\/completions$/, '') + '/chat/completions',
    );
  } catch {
    throw new GatewayError('UPSTREAM_UNAVAILABLE', 503, '上游地址无效');
  }
  const local =
    process.env.DEPLOY_MODE !== 'server' &&
    url.protocol === 'http:' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    (!local && url.protocol !== 'https:') ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new GatewayError(
      'UPSTREAM_UNAVAILABLE',
      503,
      '上游必须使用 HTTPS 且不能在 URL 中携带凭证',
    );
  return { id: e.id, url: url.href, key: e.apiKey, model: e.model };
}
