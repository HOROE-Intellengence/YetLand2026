// Dedicated ingress only; never log Authorization, cookies, or signed URLs.
import { previewLogin } from './preview-login.mjs';
import { faviconPath, faviconSvg, withFavicon } from './favicon.mjs';
const origins = new Map([
  ['global.yetland.cn', 'https://yetland.cn'],
  ['phone-global.yetland.cn', 'https://phone.yetland.cn'],
  ['phone.yetland.com', 'https://phone.yetland.cn'],
  ['ingress.yetland.com', 'https://yetland.cn'],
]);

export default {
  async fetch(request, env) {
    const incoming = new URL(request.url);
    const origin = origins.get(incoming.hostname);
    if (!origin) return new Response('Unknown ingress hostname', {status: 421});
    if (incoming.protocol === 'http:' && !incoming.pathname.startsWith('/.well-known/')) {
      incoming.protocol = 'https:';
      return new Response(null, {status: 308, headers: {Location: incoming.href, 'Cache-Control': 'private, no-store'}});
    }
    if (!env.ENTRY_TOKEN) return new Response('Ingress unavailable', {status: 503});
    if (incoming.pathname === faviconPath && ['GET', 'HEAD'].includes(request.method)) {
      return new Response(request.method === 'HEAD' ? null : faviconSvg, { headers: {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'public, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
      } });
    }
    if (request.method === 'GET' && incoming.pathname === '/__preview/login') return previewLogin();
    const target = new URL(incoming.pathname + incoming.search, origin);
    const headers = new Headers(request.headers);
    headers.delete('host');
    headers.delete('x-yelan-entry');
    headers.delete('x-yelan-entry-host');
    headers.set('x-yelan-entry', env.ENTRY_TOKEN);
    headers.set('x-yelan-entry-host', incoming.hostname);
    // Prevent a client-selected peer address from reaching application logs.
    headers.delete('x-forwarded-for');
    headers.delete('x-real-ip');
    if (request.headers.get('cf-connecting-ip')) {
      headers.set('x-real-ip', request.headers.get('cf-connecting-ip'));
    }
    const forwarded = new Request(target, {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      redirect: 'manual',
      cache: 'no-store',
    });
    let upstream;
    try {
      // No retry: repeating a POST could create a second paid operation.
      upstream = await fetch(forwarded);
    } catch {
      return new Response('Origin unavailable', {status: 502, headers: {'Cache-Control': 'private, no-store'}});
    }
    if (upstream.status === 101) return upstream;
    const responseHeaders = new Headers(upstream.headers);
    if (incoming.hostname.endsWith('.yetland.com')) {
      const cookies = upstream.headers.getSetCookie();
      responseHeaders.delete('set-cookie');
      for (const cookie of cookies) {
        responseHeaders.append('set-cookie', cookie.replace(/;\s*Domain=\.?yetland\.cn(?=;|$)/gi, '; Domain=yetland.com'));
      }
    }
    responseHeaders.set('Cache-Control', 'private, no-store');
    responseHeaders.set('CDN-Cache-Control', 'no-store');
    responseHeaders.set('Cloudflare-CDN-Cache-Control', 'no-store');
    responseHeaders.set('Referrer-Policy', 'no-referrer');
    responseHeaders.delete('x-yelan-entry');
    responseHeaders.delete('x-yelan-entry-host');
    const location = responseHeaders.get('location');
    if (location?.startsWith(origin + '/')) {
      responseHeaders.set('location', incoming.origin + location.slice(origin.length));
    }
    if (incoming.hostname === 'phone-global.yetland.cn' || incoming.hostname === 'phone.yetland.com') {
      responseHeaders.set('Content-Security-Policy', 'frame-ancestors https://ingress.yetland.com');
    }
    const response = new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
    return request.method === 'GET' ? withFavicon(response) : response;
  },
};
