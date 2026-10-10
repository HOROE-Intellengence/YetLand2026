import { randomUUID } from 'node:crypto';
import type { VoiceDiagnosticInput, VoiceDiagnosticResult } from '@yelan/shared';
import { voiceDatabase, type VoiceDatabase } from './database';
import { voiceService, type VoiceService } from './service';
import { HqVoiceService } from '../voice-hq/service';
import { characterProfile } from '../voice-hq/profiles';
import { synthesize, ttsConfig } from '../voice-hq/providers';
import { relayConfig, VoiceError } from './config';
import { hash, saveAudio, readAudio } from './audio';
import { store } from '../store/persistence';

type DiagnosticRow = {
  sessionId: string;
  requestId: string;
  requestHash: string;
  mode: VoiceDiagnosticResult['mode'];
  kind: VoiceDiagnosticResult['kind'];
  inputText: string;
  errorCode: string | null;
};
function diagnosticError(error: unknown): string {
  if (error instanceof VoiceError) return error.code;
  const failure = error as { name?: string; cause?: { code?: string } };
  if (failure?.name === 'TimeoutError' || failure?.name === 'AbortError')
    return 'VOICE_RESPONSE_TIMEOUT';
  if (
    failure?.cause?.code?.startsWith('UND_ERR_') ||
    ['ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET', 'ETIMEDOUT'].includes(failure?.cause?.code ?? '')
  )
    return 'VOICE_UPSTREAM_CONNECTION_FAILED';
  return 'VOICE_DIAGNOSTIC_FAILED';
}
export class VoiceDiagnostics {
  readonly jobs = new Map<string, AbortController>();
  constructor(
    readonly db: VoiceDatabase,
    readonly live: () => VoiceService = voiceService,
    readonly tts: typeof synthesize = synthesize,
  ) {}
  async start(input: VoiceDiagnosticInput): Promise<VoiceDiagnosticResult> {
    const requestHash = hash(
      JSON.stringify([input.mode, input.userId, input.characterId, input.text]),
    );
    const previous = this.db.db
      .prepare('SELECT * FROM voice_diagnostics WHERE requestId=?')
      .get(input.requestId) as DiagnosticRow | undefined;
    if (previous) {
      if (previous.requestHash !== requestHash)
        throw new VoiceError('VOICE_IDEMPOTENCY_CONFLICT', 409);
      return this.result(previous.sessionId);
    }
    const user = store.state().users[input.userId];
    if (!user || user.isGuest || user.deletedAt)
      throw new VoiceError('REGISTERED_ACCOUNT_REQUIRED', 400);
    if (input.mode === 'advanced') ttsConfig();
    else relayConfig();
    const session = this.db.db
      .transaction(() => {
        const active = this.db.db
          .prepare("SELECT count(*) n FROM turns WHERE status='processing'")
          .get() as { n: number };
        if (active.n >= 4) throw new VoiceError('VOICE_BUSY', 429);
        const userActive = this.db.db
          .prepare(
            "SELECT 1 FROM turns t JOIN sessions s ON s.id=t.sessionId WHERE s.userId=? AND t.status='processing'",
          )
          .get(input.userId);
        if (userActive) throw new VoiceError('VOICE_USER_BUSY', 409);
        const recent = this.db.db
          .prepare('SELECT count(*) n FROM voice_diagnostics WHERE createdAt>?')
          .get(new Date(Date.now() - 60000).toISOString()) as { n: number };
        if (recent.n >= 5) throw new VoiceError('VOICE_RATE_LIMITED', 429);
        const session =
          input.mode === 'advanced'
            ? new HqVoiceService(this.db).create(input.userId, input.characterId)
            : this.live().create(input.userId, input.characterId);
        this.db.db
          .prepare('INSERT INTO voice_diagnostics VALUES (?,?,?,?,?,?,?,NULL)')
          .run(
            session.id,
            input.requestId,
            requestHash,
            input.mode,
            input.mode === 'advanced' ? 'fish_tts' : 'live_reply',
            input.text,
            new Date().toISOString(),
          );
        return session;
      })
      .immediate();
    try {
      if (input.mode === 'instant')
        await this.live().start(
          input.userId,
          session.id,
          input.requestId,
          Buffer.alloc(0),
          input.text,
        );
      else {
        const id = randomUUID(),
          time = new Date().toISOString();
        const profile = characterProfile(this.db, session.characterId);
        this.db.db
          .transaction(() => {
            this.db.db
              .prepare(
                `INSERT INTO turns (id,sessionId,requestId,inputHash,status,createdAt,updatedAt,prompt,promptHash,model,inputText,outputText,inputTranscriptComplete,outputTranscriptComplete)
            VALUES (?,?,?,?,'processing',?,?,'','',?,?,?,1,1)`,
              )
              .run(
                id,
                session.id,
                input.requestId,
                hash(`tts:${input.text}`),
                time,
                time,
                profile.model,
                input.text,
                input.text,
              );
            this.db.db
              .prepare('INSERT INTO hq_turns(turnId,stage,profileJson) VALUES (?,?,?)')
              .run(id, 'tts', JSON.stringify(profile));
          })
          .immediate();
        const controller = new AbortController();
        this.jobs.set(id, controller);
        // A 202 response does not cancel the server job. Poll the original ID; never resubmit on timeout.
        void (async () => {
          try {
            const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(180000)]);
            const pcm = await this.tts(input.text, profile, signal);
            signal.throwIfAborted();
            await saveAudio(this.db, {
              userId: input.userId,
              turnId: id,
              direction: 'output',
              pcm,
              rate: 24000,
              bitrate: 48000,
            });
            this.db.db.transaction(() => {
              this.db.db
                .prepare("UPDATE turns SET status='complete',updatedAt=? WHERE id=?")
                .run(new Date().toISOString(), id);
              this.db.db.prepare("UPDATE hq_turns SET stage='complete' WHERE turnId=?").run(id);
            })();
          } catch (error) {
            const code = diagnosticError(error);
            this.db.db
              .prepare("UPDATE turns SET status='failed',errorCode=?,updatedAt=? WHERE id=?")
              .run(code, new Date().toISOString(), id);
            this.db.db.prepare("UPDATE hq_turns SET stage='failed' WHERE turnId=?").run(id);
          } finally {
            this.jobs.delete(id);
          }
        })().catch(() => console.error('[voice] Failed to persist diagnostic status', id));
      }
    } catch (error) {
      const code = diagnosticError(error);
      this.db.db
        .prepare('UPDATE voice_diagnostics SET errorCode=? WHERE sessionId=?')
        .run(code, session.id);
    }
    return this.result(session.id);
  }
  async result(id: string): Promise<VoiceDiagnosticResult> {
    const test = this.db.db.prepare('SELECT * FROM voice_diagnostics WHERE sessionId=?').get(id) as
      | DiagnosticRow
      | undefined;
    if (!test) throw new VoiceError('VOICE_TEST_NOT_FOUND', 404);
    const turn = this.db.turns(id)[0];
    const asset = turn?.outputAssetId ? this.db.asset(turn.outputAssetId) : undefined;
    let audioReadable = false;
    if (asset) {
      try {
        audioReadable = (await readAudio(this.db, asset)).length === asset.bytes && asset.bytes > 0;
      } catch {
        /* Report disk failure explicitly. */
      }
    }
    const status = turn?.status ?? (test.errorCode ? 'failed' : 'interrupted');
    return {
      id,
      mode: test.mode,
      kind: test.kind,
      sessionId: id,
      turnId: turn?.id ?? null,
      status: status === 'complete' && !audioReadable ? 'failed' : status,
      errorCode:
        status === 'complete' && !audioReadable
          ? 'AUDIO_STORAGE_CHECK_FAILED'
          : (turn?.errorCode ?? test.errorCode),
      inputText: test.inputText,
      outputText: turn?.outputText ?? '',
      persistence: { turnSaved: Boolean(turn), audioSaved: Boolean(asset), audioReadable },
      outputAudio: asset
        ? { id: asset.id, bytes: asset.bytes, durationMs: asset.durationMs, sha256: asset.sha256 }
        : null,
    };
  }
}
let singleton: VoiceDiagnostics | undefined;
export const voiceDiagnostics = () => (singleton ??= new VoiceDiagnostics(voiceDatabase()));
