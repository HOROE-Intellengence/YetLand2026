// 召回：用当前用户输入做嵌入 → top-5 余弦相似 → 拼到 system_prompt 的"她记得"
import { memoryDb, type EventRow, type PreferenceRow } from './db';

export interface RecallResult {
  preferences: PreferenceRow[];
  events: EventRow[];
}

export async function recall(_args: {
  characterId: string;
  mode: 'main' | 'if';
  query: string;
  topK?: number;
}): Promise<RecallResult> {
  const args = _args;
  const topK = args.topK ?? 5;
  const modes = args.mode === 'if' ? ['main', 'if'] : ['main'];
  const query = args.query.trim().toLowerCase();

  const prefs = (await memoryDb.preferences.toArray()).filter(
    (p) => !p.tombstone && p.characterId === args.characterId && modes.includes(p.mode),
  );
  const events = (await memoryDb.events.toArray()).filter(
    (e) => !e.tombstone && e.characterId === args.characterId && modes.includes(e.mode),
  );

  const scoredPrefs = prefs
    .map((p) => ({ row: p, score: scoreText(query, p.text) * (p.weight || 1) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((x) => x.row);

  const scoredEvents = events
    .map((e) => ({ row: e, score: scoreText(query, `${e.date} ${e.text} ${e.emotion ?? ''}`) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((x) => x.row);

  return { preferences: scoredPrefs, events: scoredEvents };
}

function scoreText(query: string, text: string): number {
  if (!query) return 0;
  const target = text.toLowerCase();
  if (target.includes(query)) return 10;
  const tokens = Array.from(new Set(query.split(/\s+/).filter(Boolean)));
  return tokens.reduce((sum, token) => sum + (target.includes(token) ? 1 : 0), 0);
}
