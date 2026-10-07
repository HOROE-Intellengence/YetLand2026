import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { ImageMaterials, imageThumbnail, THUMBNAIL_LIMIT } from './image-materials';

describe('generated image material persistence', () => {
  it('compresses a complex image below 200 KB and removes source metadata', async () => {
    const source = await sharp(randomBytes(1600 * 1600 * 3), { raw: { width: 1600, height: 1600, channels: 3 } }).png().toBuffer();
    const thumbnail = await imageThumbnail(source);
    expect(thumbnail.length).toBeLessThanOrEqual(THUMBNAIL_LIMIT);
    const meta = await sharp(thumbnail).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBeLessThanOrEqual(1024);
    expect(meta.exif).toBeUndefined();
  });
  it('persists thumbnails across reopen and filters by owner', async () => {
    const root = mkdtempSync(join(tmpdir(), 'yelan-materials-'));
    let store = new ImageMaterials(root);
    try {
      const image = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#aabbcc' } }).png().toBuffer();
      await store.save({ userId: 'u1', prompt: 'first', model: 'test', image });
      await store.save({ userId: 'u2', prompt: 'second', model: 'test', image });
      store.db.close(); store = new ImageMaterials(root);
      expect(store.list(1).total).toBe(2);
      const page = store.list(1, 'u1');
      expect(page.total).toBe(1);
      expect(page.items[0]?.userId).toBe('u1');
      expect(page.items[0]?.thumbnailDataUrl).toMatch(/^data:image\/jpeg;base64,/);
      expect(store.list(2).items).toHaveLength(0);
    } finally { store.db.close(); rmSync(root, { recursive: true, force: true }); }
  });
});
