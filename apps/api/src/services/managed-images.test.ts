import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateManagedImage, IMAGE_MODEL } from './managed-images';
const state = vi.hoisted(() => ({ root: '', save: vi.fn() }));
vi.mock('./image-materials', () => ({ imageMaterials: () => state }));
beforeEach(() => {
  state.root = mkdtempSync(join(tmpdir(), 'managed-image-test-'));
  state.save.mockReset().mockResolvedValue('material-test');
  vi.stubEnv('IMAGE_API_BASE_URL', 'https://images.example/v1');
  vi.stubEnv('IMAGE_API_KEY', 'test-key');
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); rmSync(state.root, { recursive: true, force: true }); });
it('sends a normalized reference image to edits exactly once and stores a thumbnail source', async () => {
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#aaccee' } }).png().toBuffer();
  const fetcher = vi.fn(async () => Response.json({ data: [{ b64_json: png.toString('base64') }] }));
  vi.stubGlobal('fetch', fetcher);
  const result = await generateManagedImage({ userId: 'u1', characterId: 'c1', prompt: 'test', referenceImageDataUrl: `data:image/png;base64,${png.toString('base64')}` }, new AbortController().signal);
  expect(result.materialId).toBe('material-test');
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe('https://images.example/v1/images/edits');
  expect((init.body as FormData).get('model')).toBe(IMAGE_MODEL);
  expect((init.body as FormData).get('image')).toBeInstanceOf(Blob);
  expect(state.save).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', characterId: 'c1', image: png }));
});
it('rejects invalid reference bytes before issuing a paid request', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  await expect(generateManagedImage({ userId: 'u1', prompt: 'test', referenceImageDataUrl: 'data:image/png;base64,YmFk' }, new AbortController().signal)).rejects.toMatchObject({ code: 'IMAGE_REFERENCE_INVALID' });
  expect(fetcher).not.toHaveBeenCalled();
});
it('never retries an upstream failure', async () => {
  const fetcher = vi.fn(async () => new Response('', { status: 502 })); vi.stubGlobal('fetch', fetcher);
  await expect(generateManagedImage({ userId: 'u1', prompt: 'test' }, new AbortController().signal)).rejects.toMatchObject({ code: 'IMAGE_UPSTREAM_HTTP_502' });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
