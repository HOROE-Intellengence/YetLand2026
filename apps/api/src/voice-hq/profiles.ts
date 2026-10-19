import { randomUUID } from 'node:crypto';
import { defaultHqVoiceProfile, HQ_VOICE_OPTIONS } from '@yelan/shared';
import type { HqVoiceProfileId, FishVoiceSlot, FishVoiceSettings, HqVoiceOptionsResponse } from '@yelan/shared';
import { charactersService } from '../services/characters';
import { VoiceError } from '../voice/config';
import { voiceDatabase, type VoiceDatabase } from '../voice/database';
import { FISH_TTS_MODEL } from './providers';

export interface HqProfile { id: HqVoiceProfileId; label: string; voiceName: string; model: string; style: string; revision: number;
  provider: 'fish'; referenceId: string | null; speed: number; libraryId?: null }
export function ensureProfiles(db: VoiceDatabase): void {
  db.db.exec(`CREATE TABLE IF NOT EXISTS fish_voice_defaults (
    category TEXT PRIMARY KEY, label TEXT NOT NULL DEFAULT '', referenceId TEXT, speed REAL NOT NULL DEFAULT 1, revision INTEGER NOT NULL DEFAULT 1
  );`);
  // Add names without replacing existing Fish IDs, speeds, revisions or role bindings.
  const columns = db.db.prepare('PRAGMA table_info(fish_voice_defaults)').all() as Array<{ name: string }>;
  if (!columns.some(column => column.name === 'label')) {
    db.db.exec("ALTER TABLE fish_voice_defaults ADD COLUMN label TEXT NOT NULL DEFAULT ''");
  }
  const seed = db.db.prepare('INSERT OR IGNORE INTO fish_voice_defaults (category,label) VALUES (?,?)');
  const name = db.db.prepare("UPDATE fish_voice_defaults SET label=? WHERE category=? AND label=''");
  db.db.transaction(() => {
    for (const option of HQ_VOICE_OPTIONS) {
      seed.run(option.value, option.label);
      name.run(option.label, option.value);
    }
  })();
}
export function settings(db: VoiceDatabase): FishVoiceSettings {
  ensureProfiles(db);
  return { provider: 'fish', model: FISH_TTS_MODEL, configured: Boolean(process.env.VOICE_HQ_FISH_API_KEY?.trim()),
    slots: db.db.prepare('SELECT * FROM fish_voice_defaults ORDER BY rowid').all() as FishVoiceSlot[] };
}
export function voiceOptions(db: VoiceDatabase): HqVoiceOptionsResponse {
  return { options: settings(db).slots.map(slot => ({ value: slot.category, label: slot.label })) };
}
export function hasVoiceProfile(id: HqVoiceProfileId | undefined, db?: VoiceDatabase): boolean {
  return id === undefined || settings(db ?? voiceDatabase()).slots.some(slot => slot.category === id);
}
export function addSlot(db: VoiceDatabase, label: string, referenceId: string | null, speed: number): string {
  ensureProfiles(db);
  const id = `voice-${randomUUID()}`;
  db.db.prepare('INSERT INTO fish_voice_defaults (category,label,referenceId,speed) VALUES (?,?,?,?)').run(id, label, referenceId, speed);
  return id;
}
export function saveSlot(db: VoiceDatabase, category: HqVoiceProfileId, referenceId: string | null, speed: number, label?: string): void {
  ensureProfiles(db);
  const result = db.db.prepare('UPDATE fish_voice_defaults SET referenceId=?,speed=?,label=COALESCE(?,label),revision=revision+1 WHERE category=?').run(referenceId, speed, label ?? null, category);
  if (!result.changes) throw new VoiceError('HQ_VOICE_UNAVAILABLE', 404);
}
export function characterProfile(db: VoiceDatabase, characterId: string): HqProfile {
  const character = charactersService.getRow(characterId);
  if (!character) throw new VoiceError('CHARACTER_NOT_FOUND', 404);
  const id = character.hqVoiceProfileId ?? defaultHqVoiceProfile(character.voiceName);
  const slot = settings(db).slots.find(s => s.category === id);
  if (!slot) throw new VoiceError('HQ_VOICE_UNAVAILABLE', 404);
  const label = slot.label;
  return { id, label, voiceName: slot.referenceId ? label : 'Fish 默认声音',
    provider: 'fish', referenceId: slot.referenceId, model: FISH_TTS_MODEL, style: '', speed: slot.speed, revision: slot.revision };
}
