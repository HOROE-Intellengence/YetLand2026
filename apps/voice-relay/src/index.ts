export interface Env { GOOGLE_API_KEY: string; RELAY_TOKEN: string }
const UPSTREAM = 'https://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== '/google-live' || url.search) return new Response('Not Found', { status: 404 });
    if (!env.RELAY_TOKEN || env.RELAY_TOKEN.length < 32 || !env.GOOGLE_API_KEY) return new Response('Not configured', { status: 503 });
    if (request.headers.get('Authorization') !== `Bearer ${env.RELAY_TOKEN}`) return new Response('Unauthorized', { status: 401 });
    if (request.method !== 'GET' || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('WebSocket required', { status: 426 });
    }
    try {
      // Only fixed Google Live target, reconstructed headers, no caller-controlled host/path/key.
      // Return the upgraded response directly: Workers streams both directions without JS frame copying.
      const response = await fetch(`${UPSTREAM}?key=${encodeURIComponent(env.GOOGLE_API_KEY)}`, {
        headers: { Upgrade: 'websocket' }, redirect: 'manual',
      });
      if (response.status !== 101 || !response.webSocket) return new Response('Upstream rejected', { status: 502 });
      return response;
    } catch {
      return new Response('Upstream unavailable', { status: 502 });
    }
  },
};
