// Provider diagnostics are admin-only. Never persist credentials or signed URLs.
export function redactProviderText(value: unknown): string {
  let text = String(value ?? '');
  for (const [key, secret] of Object.entries(process.env)) {
    if (/KEY|TOKEN|SECRET|PASSWORD/i.test(key) && secret && secret.length >= 4) text = text.split(secret).join('[REDACTED]');
  }
  return text.replace(/(?:https?|wss?):\/\/[^\s"'<>]+/gi, '[URL]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/((?:api[_-]?key|token|signature|secret|password)\s*[=:]\s*)[^\s,;]+/gi, '$1[REDACTED]')
    .slice(0, 500);
}
export function liveErrorCode(code: number, reason: string, fallback = 'VOICE_UPSTREAM_DISCONNECTED'): string {
  if (/prepayment credits.*depleted|insufficient.*(?:credit|balance)|billing.*(?:disabled|exhausted)/i.test(reason)) return 'VOICE_UPSTREAM_CREDITS_EXHAUSTED';
  if (code === 429 || /rate.?limit|resource.?exhausted|quota.*exceed/i.test(reason)) return 'VOICE_UPSTREAM_RATE_LIMITED';
  if ([401, 403].includes(code) || /unauthenticated|permission.?denied|api.?key.*(?:invalid|not valid|expired)|invalid.*api.?key/i.test(reason)) return 'VOICE_UPSTREAM_AUTH_FAILED';
  return fallback;
}
