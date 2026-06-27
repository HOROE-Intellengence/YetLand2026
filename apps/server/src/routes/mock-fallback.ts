import type { Context } from 'hono';
import type { Env } from '../types/bindings';

type AppContext = Context<{ Bindings: Env }>;

function findHeaderEnd(bytes: Uint8Array): number {
  for (let i = 0; i <= bytes.length - 4; i += 1) {
    if (bytes[i] === 13 && bytes[i + 1] === 10 && bytes[i + 2] === 13 && bytes[i + 3] === 10) {
      return i;
    }
  }
  return -1;
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function readAsciiLine(bytes: Uint8Array, offset: number): { line: string; next: number } | null {
  for (let i = offset; i < bytes.length - 1; i += 1) {
    if (bytes[i] === 13 && bytes[i + 1] === 10) {
      return {
        line: new TextDecoder().decode(bytes.slice(offset, i)),
        next: i + 2,
      };
    }
  }
  return null;
}

function decodeChunkedBody(bytes: Uint8Array): Uint8Array {
  const chunks: Uint8Array[] = [];
  let offset = 0;

  while (offset < bytes.length) {
    const sizeLine = readAsciiLine(bytes, offset);
    if (!sizeLine) return bytes;
    const size = Number.parseInt(sizeLine.line.split(';')[0] ?? '', 16);
    if (!Number.isFinite(size)) return bytes;
    offset = sizeLine.next;
    if (size === 0) break;
    chunks.push(bytes.slice(offset, offset + size));
    offset += size;
    if (bytes[offset] === 13 && bytes[offset + 1] === 10) offset += 2;
  }

  return concatBytes(chunks);
}

async function responseFromRawHttp(upstream: Response, base: string): Promise<Response> {
  const raw = new Uint8Array(await upstream.arrayBuffer());
  const headerEnd = findHeaderEnd(raw);
  if (headerEnd < 0) {
    return new Response(raw, {
      status: 502,
      headers: {
        'content-type': upstream.headers.get('content-type') || 'application/octet-stream',
        'x-yelan-proxied-by': 'apps/server',
        'x-yelan-proxied-to': base,
      },
    });
  }

  const headerText = new TextDecoder().decode(raw.slice(0, headerEnd));
  const [statusLine = '', ...headerLines] = headerText.split('\r\n');
  const status = Number(statusLine.match(/\s(\d{3})\s/)?.[1] ?? 502);
  const headers = new Headers();
  for (const line of headerLines) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    headers.append(line.slice(0, idx).trim(), line.slice(idx + 1).trim());
  }

  const bodyBytes = raw.slice(headerEnd + 4);
  const isChunked = headers.get('transfer-encoding')?.toLowerCase().includes('chunked');
  const body = isChunked ? decodeChunkedBody(bodyBytes) : bodyBytes;
  headers.delete('transfer-encoding');
  headers.delete('content-length');
  headers.set('x-yelan-proxied-by', 'apps/server');
  headers.set('x-yelan-proxied-to', base);

  return new Response(body, {
    status: status >= 200 && status <= 599 ? status : 502,
    headers,
  });
}

export function getMockFallbackBase(env: Env): string | null {
  const explicitBase = env.MOCK_SERVER_BASE?.trim();
  const enabled = env.ENABLE_MOCK_FALLBACK === 'true' || env.ENABLE_MOCK_FALLBACK === '1';
  if (!enabled && !explicitBase) return null;

  const base = (explicitBase || 'http://127.0.0.1:8787').replace(/\/+$/, '');

  // 生产环境强制 HTTPS（开发态本地 http://127.0.0.1:8787 允许）
  const isProduction = env.ENV === 'production';
  const isLocalhost = /^https?:\/\/(127\.0\.0\.1|localhost)/.test(base);
  if (isProduction && !base.startsWith('https://') && !isLocalhost) {
    console.error('[mock-fallback] MOCK_SERVER_BASE must be HTTPS in production:', base);
    return null;
  }

  return base;
}

export async function proxyToMockFallback(c: AppContext): Promise<Response | null> {
  const base = getMockFallbackBase(c.env);
  if (!base) return null;

  const incomingUrl = new URL(c.req.url);
  const upstreamUrl = new URL(`${incomingUrl.pathname}${incomingUrl.search}`, base);
  const headers = new Headers(c.req.raw.headers);
  headers.delete('host');

  // ADR-0009 D3: 边缘注入 X-Internal-Token，证明请求来自 Worker
  if (c.env.INTERNAL_TOKEN) {
    headers.set('X-Internal-Token', c.env.INTERNAL_TOKEN);
  } else if (c.env.ENV === 'production') {
    return new Response(
      JSON.stringify({ code: 'INTERNAL_TOKEN_MISSING', message: 'INTERNAL_TOKEN not configured on edge' }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    );
  }

  const init: RequestInit = {
    method: c.req.method,
    headers,
    redirect: 'manual',
  };
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    init.body = await c.req.raw.clone().arrayBuffer();
  }

  const upstream = await fetch(upstreamUrl.toString(), init);
  if (upstream.status < 200 || upstream.status > 599) {
    return responseFromRawHttp(upstream, base);
  }

  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.set('x-yelan-proxied-by', 'apps/server');
  responseHeaders.set('x-yelan-proxied-to', base);

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

export async function proxyToMockOr404(c: AppContext): Promise<Response> {
  const proxied = await proxyToMockFallback(c);
  return proxied ?? c.notFound();
}
