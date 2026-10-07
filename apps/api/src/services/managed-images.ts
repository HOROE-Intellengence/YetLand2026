import { imageMaterials } from './image-materials';
import sharp from 'sharp';
import { downloadGeneratedImage } from './image-download';
import { writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const IMAGE_MODEL = 'gpt-image-2.5-flare';
export const imageConfigured = () => Boolean(process.env.IMAGE_API_KEY?.trim() && process.env.IMAGE_API_BASE_URL?.trim());
export class ImageError extends Error {
  constructor(public code: string, public status: 400 | 429 | 502 | 503 = 502) { super(code); }
}
const busy = new Set<string>();
export async function generateManagedImage(input: { userId: string; characterId?: string; prompt: string }, signal: AbortSignal) {
  if (!imageConfigured()) throw new ImageError('IMAGE_NOT_CONFIGURED', 503);
  if (busy.has(input.userId) || busy.size >= 2) throw new ImageError('IMAGE_BUSY', 429);
  const base = new URL(process.env.IMAGE_API_BASE_URL!);
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) throw new ImageError('IMAGE_CONFIG_INVALID', 503);
  busy.add(input.userId);
  try {
    // Exactly one provider request. Never automatically retry a possibly billed generation.
    const response = await fetch(base.href.replace(/\/$/, '') + '/images/generations', {
      method: 'POST', redirect: 'error',
      headers: { Authorization: `Bearer ${process.env.IMAGE_API_KEY!.trim()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: IMAGE_MODEL, prompt: input.prompt, n: 1, size: '1024x1024', response_format: 'b64_json' }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(180000)]),
    });
    if (!response.ok) throw new ImageError(`IMAGE_UPSTREAM_HTTP_${response.status}`);
    const reader = response.body?.getReader();
    if (!reader) throw new ImageError('IMAGE_EMPTY_RESPONSE');
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const next = await reader.read(); if (next.done) break;
        size += next.value.length;
        if (size > 24 * 1024 * 1024) { await reader.cancel(); throw new ImageError('IMAGE_RESPONSE_TOO_LARGE'); }
        chunks.push(next.value);
      }
    } finally { reader.releaseLock(); }
    const result = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { data?: Array<{ b64_json?: string; url?: string }> };
    // Preserve the provider result until local storage succeeds, so a download
    // failure can be recovered without paying to generate the same image again.
    const receipt = join(imageMaterials().root, `pending-${randomUUID()}.json`);
    await writeFile(receipt, JSON.stringify({ ...input, model: IMAGE_MODEL, result }), { mode: 0o600 });
    const b64 = result.data?.[0]?.b64_json;
    const url = result.data?.[0]?.url;
    if (!b64 && !url) throw new ImageError('IMAGE_RESPONSE_MISSING_IMAGE');
    const image = b64 ? Buffer.from(b64, 'base64') : await downloadGeneratedImage(url!, AbortSignal.any([signal, AbortSignal.timeout(45000)]));
    const metadata = await sharp(image, { limitInputPixels: 40_000_000 }).metadata();
    const mimeType = ({ png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' } as Record<string, string>)[metadata.format ?? ''];
    if (!mimeType) throw new ImageError('IMAGE_FORMAT_UNSUPPORTED');
    const materialId = await imageMaterials().save({ ...input, model: IMAGE_MODEL, image });
    await unlink(receipt).catch(() => {});
    return { b64: image.toString('base64'), mimeType, materialId };
  } finally { busy.delete(input.userId); }
}
