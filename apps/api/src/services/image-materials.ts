import Database from 'better-sqlite3';
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

export const THUMBNAIL_LIMIT = 200 * 1024;
interface MaterialRow { id: string; userId: string; characterId: string | null; prompt: string; model: string; createdAt: string; thumbnail: Buffer; bytes: number; width: number; height: number }
export async function imageThumbnail(input: Buffer): Promise<Buffer> {
  for (const width of [1024, 800, 640, 480, 320]) {
    const output = await sharp(input, { limitInputPixels: 40_000_000 }).rotate()
      .resize({ width, height: width, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true }).toBuffer();
    if (output.length <= THUMBNAIL_LIMIT) return output;
  }
  throw new Error('THUMBNAIL_TOO_LARGE');
}

export class ImageMaterials {
  readonly db: Database.Database;
  constructor(readonly root: string) {
    mkdirSync(root, { recursive: true });
    this.db = new Database(resolve(root, 'materials.sqlite'));
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`CREATE TABLE IF NOT EXISTS image_materials (
      id TEXT PRIMARY KEY, userId TEXT NOT NULL, characterId TEXT,
      prompt TEXT NOT NULL, model TEXT NOT NULL, createdAt TEXT NOT NULL,
      thumbnail BLOB NOT NULL, bytes INTEGER NOT NULL,
      width INTEGER NOT NULL, height INTEGER NOT NULL
    ); CREATE INDEX IF NOT EXISTS image_materials_created ON image_materials(createdAt DESC);`);
  }
  async save(input: { userId: string; characterId?: string; prompt: string; model: string; image: Buffer }) {
    const thumbnail = await imageThumbnail(input.image);
    const meta = await sharp(thumbnail).metadata();
    const id = randomUUID();
    this.db.prepare('INSERT INTO image_materials VALUES (?,?,?,?,?,?,?,?,?,?)').run(
      id, input.userId, input.characterId ?? null, input.prompt, input.model,
      new Date().toISOString(), thumbnail, thumbnail.length, meta.width!, meta.height!,
    );
    return id;
  }
  list(page: number, userId?: string) {
    const where = userId ? ' WHERE userId=?' : '';
    const args = userId ? [userId] : [];
    const total = (this.db.prepare(`SELECT count(*) n FROM image_materials${where}`).get(...args) as { n: number }).n;
    const items = (this.db.prepare(`SELECT * FROM image_materials${where} ORDER BY createdAt DESC,id DESC LIMIT 12 OFFSET ?`)
      .all(...args, (page - 1) * 12) as MaterialRow[]).map(({ thumbnail, ...row }) =>
        ({ ...row, thumbnailDataUrl: `data:image/jpeg;base64,${thumbnail.toString('base64')}` }));
    return { items, total, page, pageSize: 12 };
  }
}
let instance: ImageMaterials | undefined;
export function imageMaterials() {
  const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  return instance ??= new ImageMaterials(resolve(process.env.YELAN_STATE_DIR ?? resolve(apiRoot, '.local'), 'materials'));
}
