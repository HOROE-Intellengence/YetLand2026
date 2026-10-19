import { NextRequest } from 'next/server';
import { streamManagedImageJson } from '@/lib/managed-image-stream';
import { boundedRequestBody } from '@/lib/managed-request-body';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function forward(req: NextRequest) {
  if (process.env.YELAN_PHONE_MANAGED !== 'true') return Response.json({ code: 'MANAGED_MODE_DISABLED' }, { status: 404 });
  const path = req.nextUrl.pathname.slice('/api/host'.length);
  if (!(path === '/auth/me' || path.startsWith('/phone/') || /^\/voice(?:-hq)?\/(sessions|assets)\//.test(path))) return Response.json({ code: 'NOT_FOUND' }, { status: 404 });
  const token = req.headers.get('authorization');
  if (!token?.startsWith('Bearer ')) return Response.json({ code: 'AUTH_REQUIRED' }, { status: 401 });
  const target = new URL(`/api${path}${req.nextUrl.search}`, process.env.YELAN_API_ORIGIN || 'http://127.0.0.1:8787');
  try {
    const maxSize=/\/inspection\/assets\//.test(path)?(req.headers.get('content-type')?.startsWith('image/')?64:16)*1024*1024:4*1024*1024;
    const body = await boundedRequestBody(req,maxSize);
    const perform = (signal: AbortSignal) => fetch(target, { method: req.method,
      headers: { Authorization: token, 'Content-Type': req.headers.get('content-type') || 'application/json',
        ...(req.headers.get('x-yelan-memory-branch') ? { 'X-Yelan-Memory-Branch': req.headers.get('x-yelan-memory-branch')! } : {}),
        ...(req.headers.get('x-yelan-call-trace') ? { 'X-Yelan-Call-Trace': req.headers.get('x-yelan-call-trace')!.slice(0,2000) } : {}),
        ...(req.headers.get('idempotency-key') ? { 'Idempotency-Key': req.headers.get('idempotency-key')! } : {}),
        ...(req.headers.get('range') ? { Range: req.headers.get('range')! } : {}),
        ...(req.headers.get('x-yelan-asset-source') ? { 'X-Yelan-Asset-Source': req.headers.get('x-yelan-asset-source')!.slice(0,40) } : {}),
        ...(req.headers.get('x-yelan-asset-name') ? { 'X-Yelan-Asset-Name': req.headers.get('x-yelan-asset-name')!.slice(0,2400) } : {}),
      },
      ...(body === undefined ? {} : { body }),
      signal,
    });
    if (req.method === 'POST' && path === '/phone/images/generations') {
      return streamManagedImageJson(perform, req.signal);
    }
    const response = await perform(req.signal);
    return new Response(response.body, { status: response.status, headers: {
      'Content-Type': response.headers.get('Content-Type') || 'application/json', 'Cache-Control': 'private, no-store',
      ...(response.headers.get('Content-Range') ? { 'Content-Range': response.headers.get('Content-Range')! } : {}),
      ...(response.headers.get('Accept-Ranges') ? { 'Accept-Ranges': response.headers.get('Accept-Ranges')! } : {}),
    } });
  } catch(error) { return error instanceof Error&&error.message==='BODY_TOO_LARGE'?Response.json({code:'BODY_TOO_LARGE'},{status:413}):Response.json({ code: 'YELAN_UNAVAILABLE' }, { status: 502 }); }
}
export const GET = forward;
export const POST = forward;
export const PUT = forward;
