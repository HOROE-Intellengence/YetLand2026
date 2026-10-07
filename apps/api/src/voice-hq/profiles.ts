import { defaultHqVoiceProfile, HqVoiceProfileIdSchema, HQ_VOICE_OPTIONS } from '@yelan/shared';
import type { HqVoiceProfileId, FishVoiceSlot, FishVoiceSettings } from '@yelan/shared';
import { charactersService } from '../services/characters';
import { VoiceError } from '../voice/config';
import type { VoiceDatabase } from '../voice/database';
import { FISH_TTS_MODEL } from './providers';

export interface HqProfile { id: HqVoiceProfileId; label: string; voiceName: string; model: string; style: string; revision: number;
  provider: 'fish'; referenceId: string | null; speed: number; libraryId?: null }
export function ensureProfiles(db: VoiceDatabase): void {
  db.db.exec(`CREATE TABLE IF NOT EXISTS fish_voice_defaults (
    category TEXT PRIMARY KEY, referenceId TEXT, speed REAL NOT NULL DEFAULT 1, revision INTEGER NOT NULL DEFAULT 1
  );`);
  const seed = db.db.prepare('INSERT OR IGNORE INTO fish_voice_defaults (category) VALUES (?)');
  db.db.transaction(() => { for (const id of HqVoiceProfileIdSchema.options) seed.run(id); })();
}
export function settings(db: VoiceDatabase): FishVoiceSettings {
  ensureProfiles(db);
  return { provider: 'fish', model: FISH_TTS_MODEL, configured: Boolean(process.env.VOICE_HQ_FISH_API_KEY?.trim()),
    slots: db.db.prepare('SELECT * FROM fish_voice_defaults ORDER BY category').all() as FishVoiceSlot[] };
}
export function saveSlot(db: VoiceDatabase, category: HqVoiceProfileId, referenceId: string | null, speed: number): void {
  ensureProfiles(db);
  db.db.prepare('UPDATE fish_voice_defaults SET referenceId=?,speed=?,revision=revision+1 WHERE category=?').run(referenceId, speed, category);
}
export function characterProfile(db: VoiceDatabase, characterId: string): HqProfile {
  const character = charactersService.getRow(characterId);
  if (!character) throw new VoiceError('CHARACTER_NOT_FOUND', 404);
  const id = character.hqVoiceProfileId ?? defaultHqVoiceProfile(character.voiceName);
  const slot = settings(db).slots.find(s => s.category === id)!;
  const label = HQ_VOICE_OPTIONS.find(v => v.value === id)!.label;
  return { id, label, voiceName: slot.referenceId ? label : 'Fish 默认声音',
    provider: 'fish', referenceId: slot.referenceId, model: FISH_TTS_MODEL, style: '', speed: slot.speed, revision: slot.revision };
}
