// End-to-end real-provider probe, deliberately opt-in: node scripts/voice-smoke.mjs <recording> <characterId> [voice]
// YELAN_USER_TOKEN must be a signed-in user token, never ADMIN_TOKEN.
/* global fetch, AbortSignal */
import { Buffer } from 'node:buffer';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

const [filename, characterId, voiceName = 'Leda'] = process.argv.slice(2);
const token = process.env.YELAN_USER_TOKEN;
const base = (process.env.YELAN_API_BASE || 'http://127.0.0.1:8787').replace(/\/$/, '');
if (!filename || !characterId || !token) {
  process.stderr.write('Usage: set YELAN_USER_TOKEN, then node scripts/voice-smoke.mjs <audio-file> <characterId> [Charon|Puck|Gacrux|Leda]\n');
  process.exit(1);
}
const mimes = { '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.webm': 'audio/webm', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.mp4': 'audio/mp4', '.flac': 'audio/flac' };
const mime = mimes[extname(filename).toLowerCase()];
if (!mime) throw new Error('Unsupported recording extension');
async function api(path, init = {}) {
  const response = await fetch(`${base}${path}`, {
    ...init, headers: { Authorization: `Bearer ${token}`, ...init.headers },
    signal: AbortSignal.timeout(65_000),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(`HTTP ${response.status}: ${body.code || 'request failed'}`);
  }
  return response;
}
let session;
try {
  session = await (await api('/api/voice/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ characterId, voiceName }) })).json();
  const turn = await (await api(`/api/voice/sessions/${session.id}/turns`, {
    method: 'POST', headers: { 'Content-Type': mime, 'Idempotency-Key': randomUUID() }, body: await readFile(filename),
  })).json();
  process.stdout.write(`session=${session.id} turn=${turn.id}\n`);
  let latest = turn;
  const deadline = Date.now() + 240_000;
  while (latest.status === 'processing' && Date.now() < deadline) {
    await delay(1000);
    latest = await (await api(`/api/voice/sessions/${session.id}/turns/${turn.id}`)).json();
  }
  if (latest.status !== 'complete') throw new Error(`${latest.status}: ${latest.errorCode || 'client polling timed out'}`);
  const output = resolve(`${filename}.reply.ogg`);
  const audio = await api(latest.outputAudioUrl);
  await writeFile(output, Buffer.from(await audio.arrayBuffer()));
  process.stdout.write(`Saved reply: ${output}\nInput: ${latest.inputText}\nOutput: ${latest.outputText}\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n`); process.exitCode = 1;
} finally {
  if (session) await api(`/api/voice/sessions/${session.id}/close`, { method: 'POST' }).catch(() => {});
}
