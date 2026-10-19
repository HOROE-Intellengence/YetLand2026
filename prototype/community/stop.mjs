import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
await import('./stop-phone.mjs');
const result = spawnSync(
  'docker',
  [
    'compose',
    '--env-file',
    resolve(root, '.local/community-prototype/compose.env.local'),
    '-f',
    resolve(import.meta.dirname, 'compose.yml'),
    'stop',
  ],
  {
    cwd: root,
    windowsHide: true,
    stdio: 'inherit',
  },
);
process.exitCode = result.status ?? 1;
