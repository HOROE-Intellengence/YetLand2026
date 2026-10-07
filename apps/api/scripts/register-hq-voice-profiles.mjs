// 将已确认的试听音色、原始演绎参数和试听母带登记到现有语音库。
// 用法：node apps/api/scripts/register-hq-voice-profiles.mjs --db <voice.sqlite> --auditions <试听目录>
// 仅登记配置；不调用模型，不修改角色卡绑定，不启动或恢复任何语音会话。
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1] || process.argv[index + 1].startsWith('--')) {
    throw new Error(`Missing ${name}`);
  }
  return resolve(process.argv[index + 1]);
}
function within(root, filename) {
  const path = resolve(root, filename), rel = relative(root, path);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Path outside requested directory');
  return path;
}
const digest = data => createHash('sha256').update(data).digest('hex');
const dbPath = argument('--db'), auditions = argument('--auditions');
const catalogPath = fileURLToPath(new URL('../src/voice-hq/voice-profiles.json', import.meta.url));
const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
if (catalog.mode !== 'voice-hq' || catalog.profiles.length !== 4 ||
    new Set(catalog.profiles.map(p => p.id)).size !== 4) throw new Error('Unexpected voice catalog');

const prepared = catalog.profiles.map(profile => {
  if (!/^[a-z-]+$/.test(profile.id) || profile.model !== 'gemini-3.8-flash-tts' || !profile.style?.trim()) {
    throw new Error('Invalid profile');
  }
  const source = within(auditions, profile.sampleSource), audio = readFileSync(source);
  if (digest(audio) !== profile.sampleSha256) throw new Error(`Sample hash mismatch: ${profile.id}`);
  const request = JSON.parse(readFileSync(source.replace(/\.wav$/, '.request.json'), 'utf8'));
  if (request.contents[0].parts[0].speech_metadata.style !== profile.style ||
      request.generationConfig.speechConfig.voiceConfig.voice !== profile.voiceName ||
      request.contents[0].parts[0].text !== profile.sampleText) {
    throw new Error(`Audition settings mismatch: ${profile.id}`);
  }
  const previewFile = `previews/hq/${profile.id}-v${profile.revision}-${profile.sampleSha256.slice(0, 12)}.wav`;
  return { profile, source, previewFile, profileJson: JSON.stringify(profile) };
});

// 直接开 SQLite，不调用 voiceDatabase()：后者的 recover() 会中断正在运行的轮次。
const db = new Database(dbPath, { fileMustExist: true });
db.pragma('busy_timeout = 5000');
db.pragma('synchronous = FULL');
try {
  const timestamp = new Date().toISOString();
  const backupDir = join(dirname(dbPath), 'backups');
  mkdirSync(backupDir, { recursive: true });
  const backup = join(backupDir, `before-hq-profiles-${timestamp.replace(/[:.]/g, '-')}.sqlite`);
  await db.backup(backup); // SQLite 一致快照，包含 WAL 中已提交内容。
  const counts = () => Object.fromEntries(['sessions', 'turns', 'assets'].map(table =>
    [table, db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n]));
  const before = counts();
  for (const row of prepared) {
    const target = within(dirname(dbPath), row.previewFile);
    mkdirSync(dirname(target), { recursive: true });
    if (existsSync(target)) {
      if (digest(readFileSync(target)) !== row.profile.sampleSha256) throw new Error('Existing preview mismatch');
    } else copyFileSync(row.source, target);
    if (digest(readFileSync(target)) !== row.profile.sampleSha256) throw new Error('Preview copy failed');
  }
  db.transaction(() => {
    db.exec(`CREATE TABLE IF NOT EXISTS hq_voice_profiles (
      id TEXT PRIMARY KEY, label TEXT NOT NULL, voiceName TEXT NOT NULL,
      model TEXT NOT NULL, style TEXT NOT NULL, sampleNumber INTEGER NOT NULL,
      previewFile TEXT NOT NULL, sampleSha256 TEXT NOT NULL,
      profileJson TEXT NOT NULL, revision INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('approved', 'disabled')),
      createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
    )`);
    const get = db.prepare('SELECT * FROM hq_voice_profiles WHERE id=?');
    const insert = db.prepare(`INSERT INTO hq_voice_profiles
      (id,label,voiceName,model,style,sampleNumber,previewFile,sampleSha256,profileJson,revision,status,createdAt,updatedAt)
      VALUES (@id,@label,@voiceName,@model,@style,@sampleNumber,@previewFile,@sampleSha256,@profileJson,@revision,'approved',@timestamp,@timestamp)`);
    for (const { profile, previewFile, profileJson } of prepared) {
      const existing = get.get(profile.id);
      if (existing) {
        if (existing.profileJson !== profileJson || existing.previewFile !== previewFile ||
            existing.voiceName !== profile.voiceName || existing.style !== profile.style ||
            existing.model !== profile.model || existing.sampleNumber !== profile.sampleNumber ||
            existing.sampleSha256 !== profile.sampleSha256 || existing.revision !== profile.revision) {
          throw new Error(`Profile already exists with different settings: ${profile.id}`);
        }
        continue; // 已有运营状态也不覆盖。
      }
      insert.run({ ...profile, previewFile, profileJson, timestamp });
    }
  })();
  const rows = db.prepare('SELECT id,label,voiceName,sampleNumber,status,revision FROM hq_voice_profiles ORDER BY rowid').all();
  if (db.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('Database integrity check failed');
  console.log(JSON.stringify({ db: dbPath, registered: rows, existingTablesBefore: before,
    existingTablesAfter: counts(), backup, modelsCalled: 0 }, null, 2));
} finally { db.close(); }
