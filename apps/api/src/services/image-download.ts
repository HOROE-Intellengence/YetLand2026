import { lookup } from 'node:dns/promises';
import { BlockList } from 'node:net';
import { Agent } from 'undici';

const blocked = new BlockList();
for (const [address, prefix] of [['0.0.0.0',8], ['10.0.0.0',8], ['100.64.0.0',10], ['127.0.0.0',8], ['169.254.0.0',16], ['172.16.0.0',12], ['192.0.0.0',24], ['192.168.0.0',16], ['198.18.0.0',15], ['224.0.0.0',3]] as const) blocked.addSubnet(address, prefix, 'ipv4');
const globalV6 = new BlockList(); globalV6.addSubnet('2000::', 3, 'ipv6');
blocked.addSubnet('2001:db8::', 32, 'ipv6');
export function publicImageAddress(address: string, family: number) {
  return family === 4 ? !blocked.check(address, 'ipv4') : globalV6.check(address, 'ipv6') && !blocked.check(address, 'ipv6');
}
export async function readImageResponse(response: Response, limit = 24 * 1024 * 1024): Promise<Buffer> {
  if (!response.ok) throw new Error(`IMAGE_DOWNLOAD_HTTP_${response.status}`);
  const reader = response.body?.getReader(); if (!reader) throw new Error('IMAGE_EMPTY_RESPONSE');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.length;
      if (size > limit) { await reader.cancel(); throw new Error('IMAGE_RESPONSE_TOO_LARGE'); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}
export async function downloadGeneratedImage(raw: string, signal: AbortSignal): Promise<Buffer> {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) throw new Error('IMAGE_URL_REJECTED');
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(item => !publicImageAddress(item.address, item.family))) throw new Error('IMAGE_URL_REJECTED');
  const address = addresses[0]!;
  // Pin the checked address, rejecting redirects and DNS rebinding. No API key
  // is forwarded to the provider's image storage host.
  const dispatcher = new Agent({ connect: { autoSelectFamily: false, lookup: (_host, _options, callback) => callback(null, address.address, address.family) } });
  try {
    return await readImageResponse(await fetch(url, { redirect: 'error', signal, dispatcher } as RequestInit));
  } finally { await dispatcher.close(); }
}
