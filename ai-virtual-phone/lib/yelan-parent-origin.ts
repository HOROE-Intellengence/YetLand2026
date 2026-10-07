export function yelanParentOrigins(configured: string): string[] {
  const url = new URL(configured);
  const origins = [url.origin];
  // Local development aliases only; keep port/protocol exact, never wildcard.
  if (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)) {
    url.hostname = url.hostname === 'localhost' ? '127.0.0.1' : 'localhost';
    origins.push(url.origin);
  }
  return origins;
}
