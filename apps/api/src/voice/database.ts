import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { VoiceTurnResponse } from '@yelan/shared';
import { voiceRoot } from './config';

export interface VoiceSession {
  id: string; userId: string; characterId: string; voiceName: string;
  createdAt: string; closedAt: string | null;
}
export interface VoiceTurn {
  id: string; sessionId: string; requestId: string; inputHash: string;
  status: VoiceTurnResponse['status']; createdAt: string; updatedAt: string;
  inputAssetId: string | null; outputAssetId: string | null;
  inputText: string; outputText: string;
  inputTranscriptComplete: number; outputTranscriptComplete: number;
  errorCode: string | null; prompt: string; promptHash: string; model: string;
  usage: string | null; trainingConsent: number;
}
export interface VoiceAsset {
  id: string; userId: string; turnId: string; direction: 'input' | 'output';
  filename: string; bytes: number; sha256: string; durationMs: number; createdAt: string;
}

export class VoiceDatabase {
  readonly db: Database.Database;
  constructor(readonly root: string) {
    mkdirSync(root, { recursive: true });
    this.db = new Database(join(root, 'voice.sqlite'));
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = FULL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY, userId TEXT NOT NULL, characterId TEXT NOT NULL,
        voiceName TEXT NOT NULL, createdAt TEXT NOT NULL, closedAt TEXT
      );
      CREATE TABLE IF NOT EXISTS turns (
        id TEXT PRIMARY KEY, sessionId TEXT NOT NULL REFERENCES sessions(id),
        requestId TEXT NOT NULL, inputHash TEXT NOT NULL, status TEXT NOT NULL,
        createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
        inputAssetId TEXT, outputAssetId TEXT,
        inputText TEXT NOT NULL DEFAULT '', outputText TEXT NOT NULL DEFAULT '',
        inputTranscriptComplete INTEGER NOT NULL DEFAULT 0,
        outputTranscriptComplete INTEGER NOT NULL DEFAULT 0,
        errorCode TEXT, prompt TEXT NOT NULL, promptHash TEXT NOT NULL, model TEXT NOT NULL,
        usage TEXT, trainingConsent INTEGER NOT NULL DEFAULT 0,
        UNIQUE(sessionId, requestId)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS one_active_turn ON turns(sessionId) WHERE status = 'processing';
      CREATE INDEX IF NOT EXISTS turns_by_session ON turns(sessionId, createdAt);
      CREATE INDEX IF NOT EXISTS sessions_by_user ON sessions(userId, createdAt);
      CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY, userId TEXT NOT NULL, turnId TEXT NOT NULL REFERENCES turns(id),
        direction TEXT NOT NULL, filename TEXT NOT NULL, bytes INTEGER NOT NULL,
        sha256 TEXT NOT NULL, durationMs INTEGER NOT NULL, createdAt TEXT NOT NULL,
        UNIQUE(turnId, direction)
      );
      CREATE TABLE IF NOT EXISTS hq_sessions (
        sessionId TEXT PRIMARY KEY REFERENCES sessions(id), profileId TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS hq_turns (
        turnId TEXT PRIMARY KEY REFERENCES turns(id), stage TEXT NOT NULL,
        profileJson TEXT NOT NULL, asrTaskId TEXT, mainCompleted INTEGER NOT NULL DEFAULT 0,
        localAsrSkipped INTEGER NOT NULL DEFAULT 0, timings TEXT NOT NULL DEFAULT '{}'
      );
      CREATE TABLE IF NOT EXISTS hq_tts_retries (
        turnId TEXT NOT NULL REFERENCES turns(id), requestId TEXT NOT NULL,
        PRIMARY KEY(turnId, requestId)
      );
    `);
  }
  recover(): void {
    // This is a single-process backend. Never silently resubmit an uncertain paid request.
    this.db.prepare("UPDATE turns SET status='interrupted', errorCode='PROCESS_RESTARTED', updatedAt=? WHERE status='processing'").run(new Date().toISOString());
  }
  session(id: string): VoiceSession | undefined {
    return this.db.prepare('SELECT * FROM sessions WHERE id=?').get(id) as VoiceSession | undefined;
  }
  isHqSession(id: string): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM hq_sessions WHERE sessionId=?').get(id));
  }
  turn(id: string): VoiceTurn | undefined {
    return this.db.prepare('SELECT * FROM turns WHERE id=?').get(id) as VoiceTurn | undefined;
  }
  byRequest(sessionId: string, requestId: string): VoiceTurn | undefined {
    return this.db.prepare('SELECT * FROM turns WHERE sessionId=? AND requestId=?').get(sessionId, requestId) as VoiceTurn | undefined;
  }
  turns(sessionId: string): VoiceTurn[] {
    return this.db.prepare('SELECT * FROM turns WHERE sessionId=? ORDER BY rowid').all(sessionId) as VoiceTurn[];
  }
  asset(id: string): VoiceAsset | undefined {
    return this.db.prepare('SELECT * FROM assets WHERE id=?').get(id) as VoiceAsset | undefined;
  }
  addAsset(asset: VoiceAsset): void {
    this.db.transaction(() => {
      this.db.prepare('INSERT INTO assets VALUES (@id,@userId,@turnId,@direction,@filename,@bytes,@sha256,@durationMs,@createdAt)').run(asset);
      const column = asset.direction === 'input' ? 'inputAssetId' : 'outputAssetId';
      this.db.prepare(`UPDATE turns SET ${column}=?, updatedAt=? WHERE id=?`).run(asset.id, asset.createdAt, asset.turnId);
    })();
  }
  close(): void { this.db.close(); }
}

let singleton: VoiceDatabase | undefined;
export function voiceDatabase(): VoiceDatabase {
  if (!singleton) { singleton = new VoiceDatabase(voiceRoot()); singleton.recover(); }
  return singleton;
}

export function publicTurn(turn: VoiceTurn): VoiceTurnResponse {
  return {
    id: turn.id, sessionId: turn.sessionId, requestId: turn.requestId, status: turn.status,
    createdAt: turn.createdAt, updatedAt: turn.updatedAt,
    inputText: turn.inputText, outputText: turn.outputText,
    inputTranscriptComplete: Boolean(turn.inputTranscriptComplete),
    outputTranscriptComplete: Boolean(turn.outputTranscriptComplete), errorCode: turn.errorCode,
    inputAudioUrl: turn.inputAssetId ? `/api/voice/assets/${turn.inputAssetId}` : null,
    outputAudioUrl: turn.outputAssetId ? `/api/voice/assets/${turn.outputAssetId}` : null,
  };
}
