import { preludeCardsService, VOICE_PRELUDE_ID } from '../services/prelude-cards';
import { loadCharacterCard } from '../prompts/loader';
import { VoiceError } from './config';
import { hash } from './audio';

export function voicePrompt(characterId: string): { prompt: string; promptHash: string } {
  const prelude = preludeCardsService.get(VOICE_PRELUDE_ID);
  if (!prelude?.isActive || prelude.scope !== 'voice' || !prelude.content.trim()) {
    throw new VoiceError('VOICE_PRELUDE_UNAVAILABLE', 409);
  }
  const character = loadCharacterCard(characterId);
  if (!character) throw new VoiceError('CHARACTER_NOT_FOUND', 404);
  // Deliberately bypass assembleSystemPrompt: exactly these two user-authorized sources.
  const prompt = `${prelude.content}\n\n${character}`;
  return { prompt, promptHash: hash(prompt) };
}
