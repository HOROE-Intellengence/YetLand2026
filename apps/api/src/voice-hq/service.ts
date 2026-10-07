import { randomUUID } from 'node:crypto';
import type { HqTurnResponse } from '@yelan/shared';
import { getDeployMode } from '../config/deploy-mode';
import { charactersService } from '../services/characters';
import { VoiceError } from '../voice/config';
import { store } from '../store/persistence';
import { isSessionIfActive } from '../services/if-unlock';
import { voiceDatabase, publicTurn, type VoiceDatabase, type VoiceSession, type VoiceTurn } from '../voice/database';
import { decodeAudio, hash, saveAudio } from '../voice/audio';
import { createAsrAudioLink } from '../voice/asr-signing';
import { characterProfile, ensureProfiles, type HqProfile } from './profiles';
import { generateHqReply } from './main';
import { synthesize, submitAsr, pollAsr, ttsConfig, asrConfig } from './providers';

interface Meta { turnId: string; stage: HqTurnResponse['stage']; profileJson: string; asrTaskId: string | null;
  mainCompleted: number; localAsrSkipped: number; timings: string }
export interface HqDependencies { main: typeof generateHqReply; tts: typeof synthesize; submit: typeof submitAsr; poll: typeof pollAsr }
const production: HqDependencies = { main: generateHqReply, tts: synthesize, submit: submitAsr, poll: pollAsr };
export class HqVoiceService {
  readonly jobs = new Map<string, AbortController>();
  constructor(readonly db: VoiceDatabase, readonly dependencies: HqDependencies = production) {
    ensureProfiles(db);
    // An output committed just before a process exit is already usable; never synthesize it twice.
    db.db.exec(`UPDATE turns SET status='complete', errorCode=NULL WHERE status='interrupted' AND outputAssetId IS NOT NULL
      AND id IN (SELECT turnId FROM hq_turns WHERE mainCompleted=1);
      UPDATE hq_turns SET stage='complete' WHERE turnId IN (SELECT id FROM turns WHERE status='complete');`);
  }
  session(id: string, userId: string): VoiceSession {
    const row = this.db.session(id);
    if (!row || row.userId !== userId || !this.db.isHqSession(id)) throw new VoiceError('VOICE_SESSION_NOT_FOUND', 404);
    return row;
  }
  private access(session: VoiceSession) {
    if (session.closedAt) throw new VoiceError('VOICE_SESSION_CLOSED', 409);
    if (!charactersService.canAccess(session.characterId, session.userId)) throw new VoiceError('CHARACTER_NOT_FOUND', 404);
  }
  create(userId: string, characterId: string) {
    if (!charactersService.canAccess(characterId, userId)) throw new VoiceError('CHARACTER_NOT_FOUND', 404);
    const character = charactersService.get(characterId)!, profile = characterProfile(this.db, character.id);
    const id = `hq_${randomUUID()}`;
    this.db.db.transaction(() => {
      this.db.db.prepare('INSERT INTO sessions VALUES (?,?,?,?,?,NULL)').run(id, userId, character.id, profile.voiceName, new Date().toISOString());
      this.db.db.prepare('INSERT INTO hq_sessions VALUES (?,?)').run(id, profile.id);
    })();
    return this.describe(id, userId);
  }
  describe(id: string, userId: string) {
    const session = this.session(id, userId);
    const profile = this.db.db.prepare('SELECT profileId FROM hq_sessions WHERE sessionId=?').get(id) as { profileId: string };
    return { id, characterId: session.characterId, profileId: profile.profileId, closedAt: session.closedAt, localTest: getDeployMode() === 'local',
      ifActive: isSessionIfActive(store.state().sessions[id]) };
  }
  meta(id: string): Meta {
    const row = this.db.db.prepare('SELECT * FROM hq_turns WHERE turnId=?').get(id) as Meta | undefined;
    if (!row) throw new VoiceError('VOICE_TURN_NOT_FOUND', 404); return row;
  }
  response(turn: VoiceTurn): HqTurnResponse {
    const meta = this.meta(turn.id), profile = JSON.parse(meta.profileJson) as HqProfile;
    const session = this.db.session(turn.sessionId)!;
    const retryable = !session.closedAt && ['failed', 'interrupted'].includes(turn.status);
    const timings = JSON.parse(meta.timings) as Record<string, number>;
    const temperature = timings.temperature;
    return { ...publicTurn(turn), stage: turn.status === 'interrupted' && meta.stage !== 'asr_skipped' ? 'interrupted' : meta.stage,
      profileId: profile.id, mainCompleted: Boolean(meta.mainCompleted), localAsrSkipped: Boolean(meta.localAsrSkipped),
      canRetryTts: profile.provider === 'fish' && retryable && Boolean(meta.mainCompleted) && !turn.outputAssetId,
      canResumeAsr: retryable && Boolean(meta.asrTaskId) && !turn.inputTranscriptComplete && turn.errorCode !== 'HQ_ASR_TASK_FAILED',
      ifActive: isSessionIfActive(store.state().sessions[turn.sessionId]),
      temperature: Number.isInteger(temperature) && temperature! >= 1 && temperature! <= 5 ? temperature! : null,
      timings };
  }
  ownedTurn(sessionId: string, id: string, userId: string): VoiceTurn {
    this.session(sessionId, userId); const turn = this.db.turn(id);
    if (!turn || turn.sessionId !== sessionId) throw new VoiceError('VOICE_TURN_NOT_FOUND', 404);
    this.meta(id); return turn;
  }
  private stage(id: string, stage: Meta['stage']) { this.db.db.prepare('UPDATE hq_turns SET stage=? WHERE turnId=?').run(stage, id); }
  private timing(id: string, label: string, elapsed: number) {
    const timings = JSON.parse(this.meta(id).timings) as Record<string, number>; timings[label] = Math.round(elapsed);
    this.db.db.prepare('UPDATE hq_turns SET timings=? WHERE turnId=?').run(JSON.stringify(timings), id);
  }
  private capacity(userId: string) {
    if ((this.db.db.prepare("SELECT count(*) AS n FROM turns WHERE status='processing'").get() as { n: number }).n >= 4) throw new VoiceError('VOICE_BUSY', 429);
    if ((this.db.db.prepare("SELECT count(*) AS n FROM turns t JOIN sessions s ON s.id=t.sessionId WHERE s.userId=? AND t.status='processing'").get(userId) as { n: number }).n) throw new VoiceError('VOICE_USER_BUSY', 409);
  }
  async start(userId: string, sessionId: string, requestId: string, audio: Buffer, text?: string): Promise<HqTurnResponse> {
    const session = this.session(sessionId, userId), inputHash = hash(text === undefined ? audio : `text:${text}`);
    const previous = this.db.byRequest(sessionId, requestId);
    if (previous) {
      if (previous.inputHash !== inputHash) throw new VoiceError('VOICE_IDEMPOTENCY_CONFLICT', 409);
      return this.response(previous);
    }
    this.access(session);
    if (text !== undefined && getDeployMode() !== 'local') throw new VoiceError('HQ_LOCAL_TEXT_ONLY', 404);
    if (text !== undefined || getDeployMode() === 'server') ttsConfig();
    if (text === undefined && getDeployMode() === 'server') asrConfig();
    const profile = characterProfile(this.db, session.characterId), id = randomUUID(), now = new Date().toISOString();
    this.db.db.transaction(() => {
      this.capacity(userId);
      const recent = this.db.db.prepare('SELECT count(*) AS n FROM turns t JOIN sessions s ON s.id=t.sessionId WHERE s.userId=? AND t.createdAt>?').get(userId, new Date(Date.now() - 60000).toISOString()) as { n: number };
      if (recent.n >= 10) throw new VoiceError('VOICE_RATE_LIMITED', 429);
      if (this.db.turns(sessionId).length >= 100) throw new VoiceError('HQ_CONTEXT_LIMIT', 409);
      this.db.db.prepare('UPDATE hq_sessions SET profileId=? WHERE sessionId=?').run(profile.id, sessionId);
      this.db.db.prepare('UPDATE sessions SET voiceName=? WHERE id=?').run(profile.voiceName, sessionId);
      this.db.db.prepare(`INSERT INTO turns (id,sessionId,requestId,inputHash,status,createdAt,updatedAt,prompt,promptHash,model,inputText,inputTranscriptComplete)
        VALUES (?,?,?,?,'processing',?,?,'','',?,?,?)`).run(id, sessionId, requestId, inputHash, now, now, profile.model, text ?? '', Number(text !== undefined));
      this.db.db.prepare('INSERT INTO hq_turns (turnId,stage,profileJson,localAsrSkipped) VALUES (?,?,?,?)').run(id, 'uploading', JSON.stringify(profile), Number(getDeployMode() === 'local'));
    })();
    const controller = new AbortController(); this.jobs.set(id, controller);
    try {
      if (text === undefined) {
        const pcm = await decodeAudio(audio); controller.signal.throwIfAborted();
        await saveAudio(this.db, { userId, turnId: id, direction: 'input', pcm, rate: 16000 });
      }
      if (text === undefined && getDeployMode() !== 'server') {
        this.stage(id, 'asr_skipped');
        this.db.db.prepare("UPDATE turns SET status='interrupted',errorCode='LOCAL_ASR_SKIPPED',updatedAt=? WHERE id=?").run(new Date().toISOString(), id);
        this.jobs.delete(id);
      } else this.launch(session, id, controller);
    } catch (e) { this.fail(id, e); this.jobs.delete(id); }
    return this.response(this.db.turn(id)!);
  }
  private fail(id: string, error: unknown) {
    const code = error instanceof VoiceError ? error.code : (error as Error).name === 'AbortError' ? 'HQ_CANCELLED' : 'HQ_STAGE_FAILED';
    const status = code === 'HQ_CANCELLED' ? 'interrupted' : 'failed';
    // 保留 main/tts/asr 阶段快照，公开状态由 turns.status 覆盖。
    this.db.db.prepare('UPDATE turns SET status=?,errorCode=?,updatedAt=? WHERE id=?').run(status, code, new Date().toISOString(), id);
  }
  private launch(session: VoiceSession, id: string, controller: AbortController) {
    void this.run(session, id, controller.signal).catch(e => this.fail(id, e)).finally(() => this.jobs.delete(id)).catch(() => console.error("[voice-hq] Failed to persist terminal status"));
  }
  private async run(session: VoiceSession, id: string, signal: AbortSignal) {
    const started = performance.now();
    let turn = this.db.turn(id)!, meta = this.meta(id);
    this.access(session); signal.throwIfAborted();
    if (!turn.inputTranscriptComplete) {
      const start = performance.now();
      if (!meta.asrTaskId) {
        const asset = turn.inputAssetId && this.db.asset(turn.inputAssetId);
        if (!asset) throw new VoiceError('AUDIO_UNAVAILABLE', 500);
        const signed = createAsrAudioLink(asset, session.userId);
        if (signed.skipped) throw new VoiceError('LOCAL_ASR_SKIPPED', 409);
        this.stage(id, 'asr_submitting');
        // 请求结果不确定时不得自动重新提交。
        let taskId: string;
        try { taskId = await this.dependencies.submit(signed.url, signal); }
        catch { throw new VoiceError('HQ_ASR_SUBMISSION_UNKNOWN', 502); }
        this.db.db.prepare("UPDATE hq_turns SET asrTaskId=?,stage='asr_pending' WHERE turnId=?").run(taskId, id);
        meta = this.meta(id);
      }
      this.stage(id, 'asr_pending');
      const text = await this.dependencies.poll(meta.asrTaskId!, signal);
      this.db.db.prepare('UPDATE turns SET inputText=?,inputTranscriptComplete=1 WHERE id=?').run(text, id);
      this.timing(id, 'asrMs', performance.now() - start); turn = this.db.turn(id)!;
    }
    signal.throwIfAborted(); this.access(this.session(session.id, session.userId));
    if (!meta.mainCompleted) {
      this.stage(id, 'main'); const start = performance.now();
      const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
      for (const previous of this.db.turns(session.id)) {
        if (previous.id === id) break;
        if (this.meta(previous.id).mainCompleted) history.push({ role: 'user', content: previous.inputText }, { role: 'assistant', content: previous.outputText });
      }
      const result = await this.dependencies.main({ userId: session.userId, sessionId: session.id,
        characterId: session.characterId, text: turn.inputText, history,
        signal: AbortSignal.any([signal, AbortSignal.timeout(180000)]),
        onPrompt: (prompt, temperature) => {
          this.db.db.prepare('UPDATE turns SET prompt=?,promptHash=? WHERE id=?').run(prompt, hash(prompt), id);
          this.timing(id, 'temperature', temperature);
        } });
      this.db.db.transaction(() => {
        this.db.db.prepare('UPDATE turns SET outputText=?,outputTranscriptComplete=1,model=?,usage=? WHERE id=?').run(result.text, result.model, JSON.stringify(result.usage ?? null), id);
        this.db.db.prepare('UPDATE hq_turns SET mainCompleted=1 WHERE turnId=?').run(id);
      })();
      this.timing(id, 'mainMs', performance.now() - start);
    }
    signal.throwIfAborted(); this.access(this.session(session.id, session.userId));
    this.stage(id, 'tts'); const start = performance.now(); turn = this.db.turn(id)!;
    const profile = JSON.parse(this.meta(id).profileJson) as HqProfile;
    const pcm = await this.dependencies.tts(turn.outputText, profile, signal);
    signal.throwIfAborted();
    await saveAudio(this.db, { userId: session.userId, turnId: id, direction: 'output', pcm, rate: 24000, bitrate: 48000 });
    this.timing(id, 'ttsMs', performance.now() - start); this.timing(id, 'totalMs', performance.now() - started);
    this.stage(id, 'complete');
    this.db.db.prepare("UPDATE turns SET status='complete',errorCode=NULL,updatedAt=? WHERE id=?").run(new Date().toISOString(), id);
  }
  retry(userId: string, sessionId: string, id: string, requestId: string, kind: 'tts' | 'asr'): HqTurnResponse {
    const session = this.session(sessionId, userId); this.access(session);
    const turn = this.ownedTurn(sessionId, id, userId);
    if (this.db.db.prepare('SELECT 1 FROM hq_tts_retries WHERE turnId=? AND requestId=?').get(id, requestId)) return this.response(turn);
    const view = this.response(turn);
    if (!(kind === 'tts' ? view.canRetryTts : view.canResumeAsr)) throw new VoiceError('HQ_RETRY_NOT_ALLOWED', 409);
    if (kind === 'asr' && getDeployMode() !== 'server') throw new VoiceError('LOCAL_ASR_SKIPPED', 409);
    this.db.db.transaction(() => {
      this.capacity(userId);
      const count = this.db.db.prepare('SELECT count(*) AS n FROM hq_tts_retries WHERE turnId=?').get(id) as { n: number };
      if (count.n >= 3) throw new VoiceError('HQ_RETRY_LIMIT', 429);
      this.db.db.prepare('INSERT INTO hq_tts_retries VALUES (?,?)').run(id, requestId);
      this.db.db.prepare("UPDATE turns SET status='processing',errorCode=NULL,updatedAt=? WHERE id=?").run(new Date().toISOString(), id);
    })();
    const controller = new AbortController(); this.jobs.set(id, controller); this.launch(session, id, controller);
    return this.response(this.db.turn(id)!);
  }
  close(id: string, userId: string) {
    this.session(id, userId);
    this.db.db.prepare('UPDATE sessions SET closedAt=COALESCE(closedAt,?) WHERE id=?').run(new Date().toISOString(), id);
    for (const turn of this.db.turns(id)) this.jobs.get(turn.id)?.abort();
  }
}
let singleton: HqVoiceService | undefined;
export function hqVoiceService() { return singleton ??= new HqVoiceService(voiceDatabase()); }
