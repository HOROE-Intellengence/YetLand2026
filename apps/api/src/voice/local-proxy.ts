import { ProxyAgent } from 'undici';
import { HttpsProxyAgent } from 'https-proxy-agent';

// Opt-in transport for local development only. Never change global fetch or
// route the application's unrelated requests through a developer's proxy.
export function localVoiceProxyUrl(target: string): string | undefined {
  if (process.env.DEPLOY_MODE !== 'local') return undefined;
  const raw = process.env.VOICE_LOCAL_PROXY_URL?.trim();
  if (!raw) return undefined;
  const hostname = new URL(target).hostname;
  if (['localhost', '127.0.0.1', '[::1]'].includes(hostname)) return undefined;
  const proxy = new URL(raw);
  if (!['http:', 'https:'].includes(proxy.protocol) || proxy.username || proxy.password ||
      proxy.search || proxy.hash || proxy.pathname !== '/') {
    throw new Error('VOICE_LOCAL_PROXY_URL must be an HTTP(S) proxy origin');
  }
  return proxy.origin;
}

let cached: { url: string; http: ProxyAgent; ws: HttpsProxyAgent<string> } | undefined;
function agents(url: string) {
  if (cached?.url !== url) {
    void cached?.http.close();
    cached?.ws.destroy();
    cached = { url, http: new ProxyAgent(url), ws: new HttpsProxyAgent(url) };
  }
  return cached;
}

export const voiceFetch: typeof fetch = (input, init) => {
  const target = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const proxy = localVoiceProxyUrl(target);
  return fetch(input, proxy ? { ...init, dispatcher: agents(proxy).http } as RequestInit : init);
};

export function voiceWebSocketAgent(target: string) {
  const proxy = localVoiceProxyUrl(target);
  return proxy ? agents(proxy).ws : undefined;
}
