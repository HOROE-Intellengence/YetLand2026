import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function forward(req: NextRequest) {
  if (process.env.YELAN_PHONE_MANAGED !== 'true') return Response.json({ code: 'MANAGED_MODE_DISABLED' }, { status: 404 });
  const path = req.nextUrl.pathname.slice('/api/host'.length);
  if (!(path === '/auth/me' || path.startsWith('/phone/'))) return Response.json({ code: 'NOT_FOUND' }, { status: 404 });
  const token = req.headers.get('authorization');
  if (!token?.startsWith('Bearer ')) return Response.json({ code: 'AUTH_REQUIRED' }, { status: 401 });
  const target = new URL(`/api${path}${req.nextUrl.search}`, process.env.YELAN_API_ORIGIN || 'http://127.0.0.1:8787');
  try {
    const response = await fetch(target, { method: req.method,
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      ...(req.method === 'GET' ? {} : { body: await req.text() }),
      signal: req.signal,
    });
    return new Response(response.body, { status: response.status, headers: {
      'Content-Type': response.headers.get('Content-Type') || 'application/json', 'Cache-Control': 'private, no-store',
    } });
  } catch { return Response.json({ code: 'YELAN_UNAVAILABLE' }, { status: 502 }); }
}
export const GET = forward;
export const POST = forward;
