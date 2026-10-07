// 在服务器构建前后分别执行；local 不发请求、不签名，并明确记录 SKIPPED。
// DEPLOY_MODE=server YELAN_API_BASE=https://... YELAN_USER_TOKEN=... VOICE_ASR_TEST_ASSET_ID=... node scripts/asr-signature-check.mjs pre-build
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const phase = process.argv[2] || 'unspecified';
if (process.env.DEPLOY_MODE !== 'server') {
  console.log(JSON.stringify({ status: 'SKIPPED', reason: 'LOCAL_SIGNATURE_SKIPPED', phase, networkRequests: 0 }));
  process.exit(0);
}
const base = process.env.YELAN_API_BASE?.replace(/\/$/, '');
const token = process.env.YELAN_USER_TOKEN;
const assetId = process.env.VOICE_ASR_TEST_ASSET_ID;
if (!base?.startsWith('https://') || !token || !assetId) {
  throw new Error('Set HTTPS YELAN_API_BASE, YELAN_USER_TOKEN and an owned input VOICE_ASR_TEST_ASSET_ID');
}
const auth = { Authorization: `Bearer ${token}` };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const request = (url, options = {}) => fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(30_000) });
try {
  const issue = `${base}/api/voice/asr-assets/${encodeURIComponent(assetId)}/sign`;
  assert.equal((await request(issue, { method: 'POST' })).status, 401, 'Anonymous signing must fail');
  const response = await request(issue, { method: 'POST', headers: auth });
  assert.equal(response.status, 200, 'Authenticated signing failed');
  const link = await response.json();
  assert.equal(link.skipped, false, 'Server must not silently skip signing');
  const signed = new URL(link.url);
  assert.equal(signed.origin, new URL(base).origin, 'Signed origin differs from configured public origin');
  const normal = await request(`${base}/api/voice/assets/${encodeURIComponent(assetId)}`, { headers: auth });
  assert.equal(normal.status, 200, 'Owner audio read failed');
  const expected = Buffer.from(await normal.arrayBuffer());
  const publicRead = await request(signed);
  assert.equal(publicRead.status, 200, 'Provider-style signed GET failed');
  assert.equal(hash(Buffer.from(await publicRead.arrayBuffer())), hash(expected), 'Audio hash differs');
  assert.match(publicRead.headers.get('Cache-Control') || '', /no-store/);
  const head = await request(signed, { method: 'HEAD' });
  assert.equal(head.status, 200, 'HEAD failed');
  assert.equal(Number(head.headers.get('Content-Length')), expected.length);
  const partial = await request(signed, { headers: { Range: 'bytes=0-15' } });
  assert.equal(partial.status, 206, 'Range failed');
  assert.deepEqual(Buffer.from(await partial.arrayBuffer()), expected.subarray(0, 16));
  const tampered = new URL(signed); tampered.searchParams.set('signature', '0'.repeat(64));
  assert.equal((await request(tampered)).status, 403, 'Tampered signature was accepted');
  const unsigned = new URL(signed); unsigned.search = '';
  assert.equal((await request(unsigned)).status, 403, 'Unsigned download was accepted');
  console.log(JSON.stringify({ status: 'PASSED', phase, bytes: expected.length,
    checks: ['owner signing', 'anonymous signing rejected', 'signed GET', 'audio hash', 'HEAD', 'Range', 'no-store', 'tampering rejected', 'missing signature rejected'],
    aliyunEndToEndTested: false }));
} catch {
  // 不输出 fetch/AssertionError 的 URL、headers、对象，避免签名或 token 入日志。
  console.error(JSON.stringify({ status: 'FAILED', phase, message: 'Signature check failed; inspect server configuration and protected diagnostics. No credentials or signed URLs logged.' }));
  process.exitCode = 1;
}
