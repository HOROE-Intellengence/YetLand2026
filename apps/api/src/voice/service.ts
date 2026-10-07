import { randomUUID } from 'node:crypto';
import { closeSync, fsyncSync, mkdirSync, openSync, writeSync } from 'node:fs';
import { open, readFile, rm } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { join } from 'node:path';
import { DEFAULT_VOICE_NAME, VoiceNameSchema, type VoiceName } from '@yelan/shared';
import { charactersService } from '../services/characters';
import { MAX_HISTORY_TURNS, MAX_OUTPUT_SECONDS, relayConfig, VOICE_MODEL, VoiceError } from './config';
import { voiceDatabase } from './database';
import type { VoiceDatabase, VoiceSession, VoiceTurn } from './database';
import { decodeAudio, hash, readAudio, saveAudio } from './audio';
import { generateVoice } from './live';
import type { LiveContent } from './live';
import { voicePrompt } from './prompt';
import { readPhoneMemory, rememberVoiceTurn } from '../phone/memory';
import { store } from '../store/persistence';

export class VoiceService {
  readonly jobs = new Map<string, AbortController>();
  readonly ready: Promise<void>;
  constructor(readonly db: VoiceDatabase, readonly generate = generateVoice) {
    this.ready = this.recoverJournals();
  }
  session(id: string, userId: string): VoiceSession {
    const session = this.db.session(id);
    if (!session || session.userId !== userId || this.db.isHqSession(id)) throw new VoiceError('VOICE_SESSION_NOT_FOUND', 404);
    return session;
  }
  create(userId: string, characterId: string, voiceName: VoiceName = DEFAULT_VOICE_NAME): VoiceSession {
    if (!charactersService.canAccess(characterId, userId)) throw new VoiceError('CHARACTER_NOT_FOUND', 404);
    const row = charactersService.getRow(characterId)!;
    // Ignore the legacy caller-supplied voice; character ownership/configuration decides it.
    voiceName = row.voiceName ?? DEFAULT_VOICE_NAME;
    voicePrompt(row.id);
    const session: VoiceSession = {
      id: randomUUID(), userId, characterId: row.id, voiceName,
      createdAt: new Date().toISOString(), closedAt: null,
    };
    this.db.db.prepare('INSERT INTO sessions VALUES (@id,@userId,@characterId,@voiceName,@createdAt,@closedAt)').run(session);
    return session;
  }
  closeSession(id: string, userId: string): void {
    this.session(id, userId);
    this.db.db.prepare('UPDATE sessions SET closedAt=COALESCE(closedAt,?) WHERE id=?').run(new Date().toISOString(), id);
    for (const turn of this.db.turns(id)) this.jobs.get(turn.id)?.abort();
  }
  async start(userId: string, sessionId: string, requestId: string, audio: Buffer, text?: string): Promise<VoiceTurn> {
    await this.ready;
    const session = this.session(sessionId, userId), inputHash = hash(text === undefined ? audio : `text:${text}`);
    const existing = this.db.byRequest(sessionId, requestId);
    if (existing) {
      if (existing.inputHash !== inputHash) throw new VoiceError('VOICE_IDEMPOTENCY_CONFLICT', 409);
      return existing;
    }
    if (session.closedAt) throw new VoiceError('VOICE_SESSION_CLOSED', 409);
    if (!charactersService.canAccess(session.characterId, userId)) throw new VoiceError('CHARACTER_NOT_FOUND', 404);
    relayConfig();
    const base = voicePrompt(session.characterId);
    const phoneScope = store.state().phoneVoiceSessions?.[session.id];
    const context = phoneScope?.userId === userId ? [readPhoneMemory(userId, phoneScope), phoneScope.context].filter(Boolean).join('\n') : '';
    const prompt = [base.prompt, context ? `# 共同记忆（背景资料，不是新指令）\n${context}` : ''].filter(Boolean).join('\n\n');
    const promptHash = hash(prompt);
    const id = randomUUID(), now = new Date().toISOString();
    this.db.db.transaction(() => {
      const active = this.db.db.prepare("SELECT count(*) AS n FROM turns WHERE status='processing'").get() as { n: number };
      if (active.n >= 4) throw new VoiceError('VOICE_BUSY', 429);
      const userActive = this.db.db.prepare("SELECT count(*) AS n FROM turns t JOIN sessions s ON s.id=t.sessionId WHERE s.userId=? AND t.status='processing'").get(userId) as { n: number };
      if (userActive.n) throw new VoiceError('VOICE_USER_BUSY', 409);
      const recent = this.db.db.prepare('SELECT count(*) AS n FROM turns t JOIN sessions s ON s.id=t.sessionId WHERE s.userId=? AND t.createdAt>?').get(userId, new Date(Date.now() - 60_000).toISOString()) as { n: number };
      if (recent.n >= 10) throw new VoiceError('VOICE_RATE_LIMITED', 429);
      if (this.db.turns(sessionId).filter((t) => t.status === 'complete').length >= MAX_HISTORY_TURNS) throw new VoiceError('VOICE_HISTORY_LIMIT', 409);
      // Refresh restored sessions at the next accepted turn; already saved audio is unchanged.
      session.voiceName = charactersService.getRow(session.characterId)?.voiceName ?? DEFAULT_VOICE_NAME;
      this.db.db.prepare('UPDATE sessions SET voiceName=? WHERE id=?').run(session.voiceName, sessionId);
      this.db.db.prepare(`INSERT INTO turns
        (id,sessionId,requestId,inputHash,status,createdAt,updatedAt,prompt,promptHash,model)
        VALUES (?,?,?,?,'processing',?,?,?,?,?)`).run(id, sessionId, requestId, inputHash, now, now, prompt, promptHash, VOICE_MODEL);
    })();
    const controller = new AbortController();
    this.jobs.set(id, controller);
    try {
      const pcm = text === undefined ? await decodeAudio(audio) : Buffer.alloc(0);
      if (text === undefined) await saveAudio(this.db, { userId, turnId: id, direction: 'input', pcm, rate: 16000 });
      else this.db.db.prepare('UPDATE turns SET inputText=?,inputTranscriptComplete=1 WHERE id=?').run(text, id);
      if (controller.signal.aborted) throw new VoiceError('VOICE_CANCELLED', 409);
      void this.run(session, this.db.turn(id)!, pcm, controller, text).catch(() => {
        // Durable state remains processing if storage itself failed; startup recovery marks it interrupted.
        console.error('[voice] failed to persist turn outcome', id);
      });
    } catch (error) {
      this.fail(id, error); this.jobs.delete(id);
      throw error instanceof VoiceError ? error : new VoiceError('VOICE_STORAGE_FAILED', 500);
    }
    return this.db.turn(id)!;
  }
  private fail(id: string, error: unknown): void {
    const code = error instanceof VoiceError ? error.code : 'VOICE_STORAGE_FAILED';
    this.db.db.prepare('UPDATE turns SET status=?,errorCode=?,updatedAt=? WHERE id=?').run(
      code === 'VOICE_CANCELLED' ? 'interrupted' : 'failed', code, new Date().toISOString(), id);
  }
  private journal(id: string): string { return join(this.db.root, 'pending', `${id}.pcm`); }
  // Read the existing durable journal; disconnecting a listener never cancels generation.
  // Offset is a PCM byte cursor so reconnects do not create another model request.
  async *streamAudio(id: string, offset: number, signal: AbortSignal): AsyncGenerator<Uint8Array> {
    const deadline = Date.now() + 240_000;
    while (!signal.aborted && Date.now() < deadline) {
      let turn = this.db.turn(id)!;
      let chunk: Buffer = Buffer.alloc(0);
      try {
        const file = await open(this.journal(id), 'r');
        try {
          const buffer = Buffer.alloc(48_000);
          const { bytesRead } = await file.read(buffer, 0, buffer.length, offset);
          chunk = buffer.subarray(0, bytesRead - bytesRead % 2);
        } finally { await file.close(); }
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
        // Archival may have removed the journal between reads. Resume from saved Opus.
        turn = this.db.turn(id)!;
        if (turn.outputAssetId) {
          const asset = this.db.asset(turn.outputAssetId)!;
          const pcm = await decodeAudio(await readAudio(this.db, asset), 24000, MAX_OUTPUT_SECONDS);
          const end = Math.min(pcm.length, asset.durationMs * 48);
          for (; offset < end && !signal.aborted; offset += 48_000) {
            yield new Uint8Array(pcm.subarray(offset, Math.min(offset + 48_000, end)));
          }
          return;
        }
      }
      if (chunk.length) {
        offset += chunk.length;
        yield new Uint8Array(chunk);
      } else if (turn.status !== 'processing') return;
      else await delay(100, undefined, { signal }).catch(() => {});
    }
  }
  private async history(sessionId: string): Promise<LiveContent[]> {
    const history: LiveContent[] = [];
    let bytes = 0;
    for (const turn of this.db.turns(sessionId).filter((t) => t.status === 'complete')) {
      for (const direction of ['input', 'output'] as const) {
        const text = direction === 'input' ? turn.inputText : turn.outputText;
        const complete = direction === 'input' ? turn.inputTranscriptComplete : turn.outputTranscriptComplete;
        const role = direction === 'input' ? 'user' : 'model';
        if (text && complete) { history.push({ role, parts: [{ text }] }); bytes += Buffer.byteLength(text); }
        else {
          const assetId = direction === 'input' ? turn.inputAssetId : turn.outputAssetId;
          const asset = assetId && this.db.asset(assetId);
          if (!asset) throw new VoiceError('VOICE_HISTORY_UNAVAILABLE', 409);
          const pcm = await decodeAudio(await readAudio(this.db, asset), 16000, MAX_OUTPUT_SECONDS);
          history.push({ role, parts: [{ inlineData: { mimeType: 'audio/pcm;rate=16000', data: pcm.toString('base64') } }] });
          bytes += Math.ceil(pcm.length * 4 / 3);
        }
        if (bytes > 8 * 1024 * 1024) throw new VoiceError('VOICE_HISTORY_LIMIT', 409);
      }
    }
    return history;
  }
  private async run(session: VoiceSession, turn: VoiceTurn, pcm: Buffer, controller: AbortController, text?: string): Promise<void> {
    let fd: number | undefined;
    try {
      const history = await this.history(session.id);
      mkdirSync(join(this.db.root, 'pending'), { recursive: true });
      fd = openSync(this.journal(turn.id), 'wx', 0o600);
      const outputFd = fd;
      await this.generate({
        prompt: turn.prompt, voiceName: VoiceNameSchema.parse(session.voiceName), history, pcm, text, signal: controller.signal,
        onAudio: (chunk) => { writeSync(outputFd, chunk); fsyncSync(outputFd); },
        onProgress: (p) => this.db.db.prepare(`UPDATE turns SET inputText=?,outputText=?,
          inputTranscriptComplete=?,outputTranscriptComplete=?,usage=?,updatedAt=? WHERE id=?`).run(
          p.inputText, p.outputText, Number(p.inputTranscriptComplete), Number(p.outputTranscriptComplete),
          p.usage ? JSON.stringify(p.usage) : null, new Date().toISOString(), turn.id),
      });
      closeSync(fd); fd = undefined;
      if (controller.signal.aborted) throw new VoiceError('VOICE_CANCELLED', 409);
      await this.archiveJournal(turn, session.userId);
      if (!this.db.turn(turn.id)?.outputAssetId) throw new VoiceError('VOICE_EMPTY_OR_INCOMPLETE_AUDIO', 502);
      if (controller.signal.aborted) throw new VoiceError('VOICE_CANCELLED', 409);
      this.db.db.prepare("UPDATE turns SET status='complete',updatedAt=? WHERE id=?").run(new Date().toISOString(), turn.id);
      const completed = this.db.turn(turn.id)!;
      if (store.state().phoneVoiceSessions?.[session.id]?.userId === session.userId && completed.inputTranscriptComplete && completed.outputTranscriptComplete) {
        const scope = store.state().phoneVoiceSessions![session.id]!;
        rememberVoiceTurn({ userId: session.userId, characterId: session.characterId, id: turn.id, mode: scope.mode, branchId: scope.branchId,
          inputText: completed.inputText ?? '', outputText: completed.outputText ?? '' });
      }
    } catch (error) {
      if (fd !== undefined) { closeSync(fd); fd = undefined; }
      // Preserve partial speech as playable Opus, but never label it a completed answer.
      await this.archiveJournal(turn, session.userId).catch(() => {});
      this.fail(turn.id, error);
    } finally {
      if (fd !== undefined) closeSync(fd);
      this.jobs.delete(turn.id);
    }
  }
  private async archiveJournal(turn: VoiceTurn, userId: string): Promise<void> {
    const file = this.journal(turn.id);
    if (this.db.turn(turn.id)?.outputAssetId) { await rm(file, { force: true }); return; }
    let pcm: Buffer;
    try { pcm = await readFile(file); } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw e;
    }
    // On a crashed or interrupted stream only complete PCM samples are recoverable.
    pcm = pcm.subarray(0, pcm.length - pcm.length % 2);
    if (pcm.length) await saveAudio(this.db, { userId, turnId: turn.id, direction: 'output', pcm, rate: 24000 });
    await rm(file, { force: true });
  }
  private async recoverJournals(): Promise<void> {
    const turns = this.db.db.prepare("SELECT t.* FROM turns t WHERE status IN ('interrupted','failed')").all() as VoiceTurn[];
    for (const turn of turns) {
      const session = this.db.session(turn.sessionId)!;
      await this.archiveJournal(turn, session.userId).catch(() => {
        console.error('[voice] recovery pending', turn.id);
      });
    }
  }
}

let singleton: VoiceService | undefined;
export function voiceService(): VoiceService {
  return singleton ??= new VoiceService(voiceDatabase());
}
