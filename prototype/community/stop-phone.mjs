import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
try {
  const saved = JSON.parse(
    readFileSync(
      resolve(import.meta.dirname, '../../.local/community-prototype/phone-process.json'),
      'utf8',
    ),
  );
  const response = await fetch('http://localhost:3041/api/community-prototype-health', {
    signal: AbortSignal.timeout(2500),
  });
  const actual = await response.json();
  if (actual.prototype === 'yelan-community' && actual.pid === saved.pid) {
    process.kill(saved.pid, 'SIGTERM');
    console.log('已停止本原型的小手机');
  }
} catch {
  /* No verified prototype process is running. */
}
