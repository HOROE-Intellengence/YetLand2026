// Explicit opt-in: two synthetic paid upstream requests; no production user or key mutation.
import { readFileSync, mkdtempSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { Hono } from 'hono';
import { GatewayDatabase } from '../src/gateway/database';
import { createGatewayRoute } from '../src/routes/api-gateway';

if (!process.argv.includes('--confirm-live'))
  throw new Error('Requires --confirm-live; makes two synthetic Gemini requests');
const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const productionState = JSON.parse(
  readFileSync(process.env.LIVE_STATE_FILE ?? join(apiRoot, '.local/state.json'), 'utf8'),
);
const entry = productionState.llmApiInventory.entries['horoe-gemini-flash-lite'];
if (
  !entry?.enabled ||
  entry.protocol !== 'openai-compatible' ||
  !entry.apiKey ||
  !/^gemini-/.test(entry.model)
)
  throw new Error('Configured Gemini unavailable');
const url = new URL(
  entry.baseUrl.replace(/\/+$/, '').replace(/\/chat\/completions$/, '') + '/chat/completions',
);
if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
  throw new Error('Unexpected upstream URL');
const directory = mkdtempSync(join(tmpdir(), 'yl-gateway-live-'));
const db = new GatewayDatabase(
  directory,
  readFileSync(join(apiRoot, 'src/gateway/initial-prelude.md'), 'utf8'),
);
db.publish(0);
db.setSettings({ ...db.settings(), timeoutSeconds: 60 });
const identity = {
  id: 'synthetic-live-qa',
  name: 'Synthetic QA',
  createdAt: new Date().toISOString(),
};
const app = new Hono();
app.route(
  '/v1',
  createGatewayRoute({
    db: () => db,
    user: () => identity,
    upstream: () => ({ id: entry.id, model: entry.model, url: url.href, key: entry.apiKey }),
  }),
);
try {
  for (const tier of ['pure', 'advanced'] as const) {
    const k = db.createTestKey(identity, {
      name: `${tier} smoke`,
      tier,
      dailyLimit: 2,
      rpm: 2,
      concurrency: 1,
    });
    const request = {
      model: entry.model,
      messages: [{ role: 'user', content: '这是接口连通测试，请只回复 API_OK。' }],
      max_tokens: 96,
      stream: tier === 'advanced',
      ...(tier === 'advanced' ? { stream_options: { include_usage: true } } : {}),
    };
    const response = await app.request('/v1/chat/completions/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${k.secret}` },
      body: JSON.stringify(request),
    });
    try {
      await response.text();
    } catch {
      /* persisted error is reported below */
    }
    const row = db.call(response.headers.get('x-request-id') ?? '');
    console.log(
      JSON.stringify({
        tier,
        http: response.status,
        state: row?.status,
        code: row?.errorCode,
        output: row?.outputText,
        inputTokens: row?.inputTokens,
        outputTokens: row?.outputTokens,
        durationMs: row?.durationMs,
        promptVersion: row?.promptVersion,
      }),
    );
    db.patchKey(k.key.id, { status: 'revoked' });
    if (
      response.status !== 200 ||
      row?.status !== 'succeeded' ||
      !row.outputText.includes('API_OK')
    )
      process.exitCode = 1;
  }
  console.log(JSON.stringify({ isolatedData: directory, productionDataModified: false }));
} finally {
  db.close();
}
