import { createHmac, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import type { VoiceAsrLinkResponse } from '@yelan/shared';
import { getDeployMode } from '../config/deploy-mode';
import { VoiceError } from './config';
import type { VoiceAsset } from './database';

export const ASR_ASSET_PATH = '/api/voice/asr-assets';
const MAX_TTL_SECONDS = 3600;

interface SigningConfig { origin: string; secret: string; ttl: number }
export type AsrAudioLink = VoiceAsrLinkResponse;

/** 本地不读取签名配置、不创建公网链接；只有 server 可以签发和验签。 */
function signingConfig(): SigningConfig | null {
  if (getDeployMode() !== 'server') return null;
  const secret = process.env.VOICE_ASR_SIGNING_KEY?.trim() ?? '';
  const ttl = Number(process.env.VOICE_ASR_SIGNING_TTL_SECONDS || '900');
  let url: URL;
  try { url = new URL(process.env.VOICE_ASR_PUBLIC_ORIGIN ?? ''); }
  catch { throw new VoiceError('VOICE_ASR_SIGNING_NOT_CONFIGURED', 503); }
  const host = url.hostname.toLowerCase();
  // 使用显式配置的公网 HTTPS 域名，绝不信任请求 Host/X-Forwarded-Host。
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      url.pathname !== '/' || !host.includes('.') || isIP(host) || host.startsWith('[') ||
      host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') ||
      secret.length < 32 || /\s/.test(secret) || !Number.isInteger(ttl) || ttl < 60 || ttl > MAX_TTL_SECONDS) {
    throw new VoiceError('VOICE_ASR_SIGNING_NOT_CONFIGURED', 503);
  }
  return { origin: url.origin, secret, ttl };
}

function signature(asset: VoiceAsset, issued: number, expires: number, config: SigningConfig): string {
  return createHmac('sha256', config.secret).update(JSON.stringify([
    'v1', 'asr-input', config.origin, asset.id, asset.userId, asset.turnId,
    asset.sha256, issued, expires,
  ])).digest('hex');
}

/** 只签用户本人的输入录音，不签回复音频；上层不得把 skipped 当成 ASR 成功。 */
export function createAsrAudioLink(asset: VoiceAsset, userId: string, now = Date.now()): AsrAudioLink {
  if (asset.userId !== userId || asset.direction !== 'input') throw new VoiceError('VOICE_ASSET_NOT_FOUND', 404);
  const config = signingConfig();
  if (!config) return { skipped: true, reason: 'LOCAL_SIGNATURE_SKIPPED', url: null, expiresAt: null };
  const issued = Math.floor(now / 1000), expires = issued + config.ttl;
  const url = new URL(`${ASR_ASSET_PATH}/${encodeURIComponent(asset.id)}`, config.origin);
  url.searchParams.set('issued', String(issued));
  url.searchParams.set('expires', String(expires));
  url.searchParams.set('signature', signature(asset, issued, expires, config));
  return { skipped: false, url: url.href, expiresAt: new Date(expires * 1000).toISOString() };
}

export function verifyAsrAudioLink(asset: VoiceAsset, params: URLSearchParams, now = Date.now()): boolean {
  const config = signingConfig();
  if (!config || asset.direction !== 'input') return false;
  if (Array.from(params.keys()).some(k => !['issued', 'expires', 'signature'].includes(k)) ||
      ['issued', 'expires', 'signature'].some(k => params.getAll(k).length !== 1)) return false;
  const issuedRaw = params.get('issued')!, expiresRaw = params.get('expires')!, sig = params.get('signature')!;
  if (!/^[1-9]\d{0,12}$/.test(issuedRaw) || !/^[1-9]\d{0,12}$/.test(expiresRaw) || !/^[a-f0-9]{64}$/.test(sig)) return false;
  const issued = Number(issuedRaw), expires = Number(expiresRaw), seconds = Math.floor(now / 1000);
  if (!Number.isSafeInteger(issued) || !Number.isSafeInteger(expires) ||
      issued > seconds + 30 || expires <= seconds || expires <= issued || expires - issued > MAX_TTL_SECONDS) return false;
  return timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(signature(asset, issued, expires, config), 'hex'));
}
