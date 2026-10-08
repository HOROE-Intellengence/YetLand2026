// Fixed, authenticated service bridge. Never accepts caller-selected upstream URLs.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname !== 'ingress.yetland.com') return new Response('Not found', {status:404});
    let target, key, headers;
    if (url.pathname === '/google-live' && !url.search) {
      key = env.RELAY_TOKEN;
      if (!key || request.headers.get('Authorization') !== `Bearer ${key}`) return new Response('Unauthorized', {status:401});
      if (request.method !== 'GET' || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('WebSocket required', {status:426});
      target = 'https://yelan-voice-relay.horolelts.workers.dev/google-live';
      headers = {Authorization:`Bearer ${key}`, Upgrade:'websocket'};
    } else if ((url.pathname === '/fish/v1/tts' && request.method === 'POST' && !url.search) ||
               (url.pathname === '/fish/model' && request.method === 'GET')) {
      key = env.FISH_API_KEY;
      if (!key || request.headers.get('Authorization') !== `Bearer ${key}`) return new Response('Unauthorized', {status:401});
      if (Number(request.headers.get('Content-Length')) > 262144) return new Response('Too large', {status:413});
      target = 'https://api.fish.audio'+url.pathname.slice('/fish'.length)+url.search;
      headers = {Authorization:`Bearer ${key}`, 'Content-Type':'application/json', model:'s2.1-pro-free'};
    } else return new Response('Not found', {status:404});
    try {
      const upstream = await fetch(target, {method:request.method, headers,
        body:request.method === 'POST' ? request.body : undefined, redirect:'manual', signal:request.signal});
      if (upstream.status === 101) return upstream;
      const resultHeaders = new Headers(upstream.headers);
      resultHeaders.set('Cache-Control','private, no-store');
      resultHeaders.set('Cloudflare-CDN-Cache-Control','no-store');
      return new Response(upstream.body, {status:upstream.status,headers:resultHeaders});
    } catch { return new Response('Upstream unavailable', {status:502,headers:{'Cache-Control':'no-store'}}); }
  },
};

