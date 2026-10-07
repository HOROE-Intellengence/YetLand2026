import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { MAX_INPUT_SECONDS, MAX_OUTPUT_SECONDS, VoiceError } from './config';
import type { VoiceAsset, VoiceDatabase } from './database';

// Never enable network protocols or playlists while decoding untrusted uploads.
function ffmpeg(args: string[], input: Buffer, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.VOICE_FFMPEG_PATH || 'ffmpeg',
      ['-hide_banner', '-loglevel', 'error', '-nostdin', '-threads', '1', ...args],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    let size = 0, settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (error) { child.kill(); reject(error); } else resolve(Buffer.concat(chunks));
    };
    const timer = setTimeout(() => finish(new VoiceError('AUDIO_CONVERSION_TIMEOUT', 422)), 30_000);
    child.on('error', () => finish(new VoiceError('AUDIO_CONVERTER_UNAVAILABLE', 503)));
    child.stdout.on('data', (data: Buffer) => {
      size += data.length;
      if (size > limit) finish(new VoiceError('AUDIO_TOO_LONG', 413));
      else chunks.push(data);
    });
    // Drain diagnostic output, but do not disclose filenames / media contents in errors.
    child.stderr.resume();
    child.stdin.on('error', () => { /* close/error determines result */ });
    child.on('close', (code) => finish(code === 0 ? undefined : new VoiceError('AUDIO_INVALID', 422)));
    child.stdin.end(input);
  });
}

function containerFormat(input: Buffer): string {
  if (input.subarray(0, 4).toString() === 'RIFF' && input.subarray(8, 12).toString() === 'WAVE') return 'wav';
  if (input.subarray(0, 4).toString() === 'OggS') return 'ogg';
  if (input.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return 'matroska';
  if (input.subarray(0, 4).toString() === 'fLaC') return 'flac';
  if (input.subarray(0, 3).toString() === 'ID3' || (input[0] === 0xff && ((input[1] ?? 0) & 0xe0) === 0xe0)) return 'mp3';
  if (input.subarray(4, 8).toString() === 'ftyp') return 'mov';
  throw new VoiceError('AUDIO_FORMAT_UNSUPPORTED', 415);
}

export async function decodeAudio(input: Buffer, rate = 16000, maxSeconds = MAX_INPUT_SECONDS): Promise<Buffer> {
  const format = containerFormat(input);
  const pcm = await ffmpeg(['-protocol_whitelist', 'pipe', '-f', format, '-i', 'pipe:0',
    '-map', '0:a:0', '-vn', '-ac', '1', '-ar', String(rate), '-t', String(maxSeconds + 1),
    '-f', 's16le', 'pipe:1'], input, rate * 2 * (maxSeconds + 1));
  if (!pcm.length || pcm.length % 2) throw new VoiceError('AUDIO_EMPTY', 422);
  if (pcm.length > rate * 2 * maxSeconds) throw new VoiceError('AUDIO_TOO_LONG', 413);
  return pcm;
}

export async function encodeOpus(pcm: Buffer, rate: number, bitrate: 24000 | 48000 = 24000): Promise<Buffer> {
  if (!pcm.length || pcm.length % 2) throw new VoiceError('AUDIO_INVALID', 422);
  return ffmpeg(['-f', 's16le', '-ar', String(rate), '-ac', '1', '-i', 'pipe:0',
    '-map_metadata', '-1', '-c:a', 'libopus', '-application', 'voip', '-b:a', String(bitrate),
    '-vbr', 'on', '-f', 'ogg', 'pipe:1'], pcm, (MAX_OUTPUT_SECONDS + MAX_INPUT_SECONDS) * 16000);
}

export const hash = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex');

export async function saveAudio(db: VoiceDatabase, args: {
  userId: string; turnId: string; direction: 'input' | 'output'; pcm: Buffer; rate: number; bitrate?: 24000 | 48000;
}): Promise<VoiceAsset> {
  const encoded = await encodeOpus(args.pcm, args.rate, args.bitrate);
  const id = randomUUID(), filename = `${id}.ogg`;
  const dir = join(db.root, 'assets');
  await mkdir(dir, { recursive: true });
  const temp = join(dir, `${id}.tmp`), target = join(dir, filename);
  try {
    const file = await open(temp, 'wx', 0o600);
    try { await file.writeFile(encoded); await file.sync(); } finally { await file.close(); }
    await rename(temp, target);
    // Persist the directory entry before committing its SQLite reference on Linux.
    if (process.platform !== 'win32') {
      const directory = await open(dir, 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    }
    const asset: VoiceAsset = {
      id, userId: args.userId, turnId: args.turnId, direction: args.direction, filename,
      bytes: encoded.length, sha256: hash(encoded),
      durationMs: Math.round(args.pcm.length / (args.rate * 2) * 1000), createdAt: new Date().toISOString(),
    };
    db.addAsset(asset);
    return asset;
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {});
    await rm(target, { force: true }).catch(() => {});
    throw error;
  }
}

export async function readAudio(db: VoiceDatabase, asset: VoiceAsset): Promise<Buffer> {
  // filename is generated by the server; additionally refuse paths if metadata is corrupted.
  if (!/^[a-f0-9-]{36}\.ogg$/.test(asset.filename)) throw new VoiceError('AUDIO_UNAVAILABLE', 500);
  const data = await readFile(join(db.root, 'assets', asset.filename));
  if (hash(data) !== asset.sha256) throw new VoiceError('AUDIO_INTEGRITY_FAILED', 500);
  return data;
}
