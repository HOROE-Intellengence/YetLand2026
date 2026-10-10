export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname !== '/region') return env.ASSETS.fetch(request);
    const country = request.cf?.country;
    const region = country === 'CN' ? 'china'
      : typeof country === 'string' && /^[A-Z]{2}$/.test(country) && !['XX', 'ZZ'].includes(country)
        ? 'international' : null;
    return Response.json({ region }, { headers: {
      'Cache-Control': 'private, no-store',
      'CDN-Cache-Control': 'no-store',
      'Cloudflare-CDN-Cache-Control': 'no-store',
    } });
  },
};
