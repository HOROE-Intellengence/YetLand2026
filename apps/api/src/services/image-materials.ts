import Database from 'better-sqlite3';
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';

export const THUMBNAIL_LIMIT = 200 * 1024;
export const MATERIAL_IMAGE_LIMIT = 2 * 1024 * 1024;
export type MaterialSource = 'generated' | 'user-upload' | 'phone-inspection' | 'archive';
interface MaterialRow { id: string; userId: string; characterId: string | null; prompt: string; model: string; createdAt: string; thumbnail: Buffer; bytes: number; width: number; height: number; mime: string; source: MaterialSource; originalBytes: number; fileName: string; content: Buffer | null; contentHash: string }

// Keep small files byte-for-byte. Only large images are re-encoded; audio,
// video, fonts and resource files retain their original bytes and MIME type.
export async function materialContent(data: Buffer, mime: string) {
  if (!mime.startsWith('image/') || data.length <= MATERIAL_IMAGE_LIMIT) return { data, mime };
  const meta = await sharp(data, { animated: true, limitInputPixels: 40_000_000 }).metadata();
  for (const scale of [1, .8, .6, .4, .25]) {
    for (const quality of [90, 78, 64]) {
      let image = sharp(data, { animated: true, limitInputPixels: 40_000_000 }).rotate();
      if (scale < 1) image = image.resize({ width: Math.max(1, Math.floor((meta.width || 2048) * scale)), withoutEnlargement: true });
      const output = await image.webp({ quality, effort: 3 }).toBuffer();
      if (output.length <= MATERIAL_IMAGE_LIMIT) return { data: output, mime: 'image/webp' };
    }
  }
  throw new Error('MATERIAL_IMAGE_COMPRESSION_FAILED');
}
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
    // Keep the original ten-column table usable by previous generated-image
    // writers during rollback. Full files and provenance live in a side table.
    this.db.exec(`CREATE TABLE IF NOT EXISTS material_files(id TEXT PRIMARY KEY,userId TEXT NOT NULL,content BLOB NOT NULL,mime TEXT NOT NULL,source TEXT NOT NULL,originalBytes INTEGER NOT NULL,fileName TEXT NOT NULL,contentHash TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS material_file_content ON material_files(userId,contentHash);
      CREATE TABLE IF NOT EXISTS material_links(materialId TEXT NOT NULL,recordKey TEXT NOT NULL,title TEXT NOT NULL,PRIMARY KEY(materialId,recordKey));`);
  }
  async save(input: { userId: string; characterId?: string; prompt: string; model: string; image: Buffer }) {
    const meta = await sharp(input.image).metadata();
    const mime = ({ png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif' } as Record<string,string>)[meta.format || ''] || 'image/png';
    return (await this.retain({ ...input, data: input.image, mime, source: 'generated' })).id;
  }
  async retain(input: { userId: string; characterId?: string; prompt?: string; model?: string; data: Buffer; mime: string; source: MaterialSource; fileName?: string; maxBytes?:number }) {
    const hash = createHash('sha256').update(input.data).digest('hex');
    const find = () => this.db.prepare('SELECT id FROM material_files WHERE userId=? AND contentHash=?').get(input.userId, hash) as {id:string} | undefined;
    const existing = find();
    if (existing) {
      if(this.get(existing.id,input.userId)!.bytes>(input.maxBytes??Infinity))throw new Error('INSPECTION_ASSET_QUOTA');
      if(input.source==='user-upload')this.db.prepare("UPDATE material_files SET source='user-upload' WHERE id=? AND source='phone-inspection'").run(existing.id);
      return this.get(existing.id, input.userId)!;
    }
    const content = await materialContent(input.data, input.mime);
    if(content.data.length>(input.maxBytes??Infinity))throw new Error('INSPECTION_ASSET_QUOTA');
    let thumbnail: Buffer = Buffer.alloc(0), width = 0, height = 0;
    if (content.mime.startsWith('image/')) {
      try {
        const meta = await sharp(content.data, { limitInputPixels: 40_000_000 }).metadata();
        width = meta.width || 0; height = meta.height || 0;
        thumbnail = await imageThumbnail(content.data);
      } catch {
        // A missing thumbnail must not discard a retained original (including
        // legacy SVGs unsupported by the rasterizer). Keep it downloadable.
        width = 0; height = 0;
      }
    }
    const id = this.db.transaction(()=>{
      const saved=find();if(saved)return saved.id;
      const id=randomUUID();
      this.db.prepare('INSERT INTO image_materials VALUES (?,?,?,?,?,?,?,?,?,?)').run(id,input.userId,input.characterId||null,input.prompt||'',input.model||'',new Date().toISOString(),thumbnail,content.data.length,width,height);
      this.db.prepare('INSERT INTO material_files VALUES (?,?,?,?,?,?,?,?)').run(id,input.userId,content.data,content.mime,input.source,input.data.length,(input.fileName||'').slice(0,240),hash);
      return id;
    })();
    return this.get(id, input.userId)!;
  }
  get(id: string, userId?: string) {
    const row = this.db.prepare(`SELECT m.*,f.content,coalesce(f.mime,'image/jpeg') mime,coalesce(f.source,'generated') source,coalesce(f.originalBytes,m.bytes) originalBytes,coalesce(f.fileName,'') fileName,coalesce(f.contentHash,'') contentHash FROM image_materials m LEFT JOIN material_files f ON m.id=f.id WHERE m.id=?${userId ? ' AND m.userId=?' : ''}`).get(...(userId ? [id,userId] : [id])) as MaterialRow | undefined;
    return row ? { ...row, data: row.content ?? row.thumbnail, originalAvailable: row.content !== null, originalBytes: row.originalBytes || row.bytes } : undefined;
  }
  link(id: string, recordKey: string, title: string) {
    this.db.prepare('INSERT INTO material_links VALUES (?,?,?) ON CONFLICT(materialId,recordKey) DO UPDATE SET title=excluded.title').run(id, recordKey, title);
  }
  markUploaded(id: string) { this.db.prepare("UPDATE material_files SET source='user-upload' WHERE id=? AND source='phone-inspection'").run(id); }
  list(page: number, userId?: string, source?: string) {
    const clauses = ["coalesce(f.source,'generated')<>'archive'"], args: string[] = [];
    if (userId) { clauses.push('m.userId=?'); args.push(userId); }
    if (source) { clauses.push("coalesce(f.source,'generated')=?"); args.push(source); }
    const where = ' WHERE ' + clauses.join(' AND ');
    const from='image_materials m LEFT JOIN material_files f ON m.id=f.id';
    const total = (this.db.prepare(`SELECT count(*) n FROM ${from}${where}`).get(...args) as { n: number }).n;
    const items = (this.db.prepare(`SELECT m.*,coalesce(f.mime,'image/jpeg') mime,coalesce(f.source,'generated') source,coalesce(f.originalBytes,m.bytes) originalBytes,coalesce(f.fileName,'') fileName,f.content IS NOT NULL AS originalAvailable FROM ${from}${where} ORDER BY m.createdAt DESC,m.id DESC LIMIT 12 OFFSET ?`)
      .all(...args, (page - 1) * 12) as (Omit<MaterialRow,'content'|'contentHash'> & {originalAvailable:number})[]).map(({ thumbnail, ...row }) =>
        ({ ...row, originalBytes: row.originalBytes || row.bytes, originalAvailable: Boolean(row.originalAvailable), thumbnailDataUrl: thumbnail.length ? `data:image/jpeg;base64,${thumbnail.toString('base64')}` : null, links: this.db.prepare('SELECT recordKey,title FROM material_links WHERE materialId=?').all(row.id) }));
    return { items, total, page, pageSize: 12 };
  }
}
let instance: ImageMaterials | undefined;
export function imageMaterials() {
  const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  return instance ??= new ImageMaterials(resolve(process.env.YELAN_STATE_DIR ?? resolve(apiRoot, '.local'), 'materials'));
}
