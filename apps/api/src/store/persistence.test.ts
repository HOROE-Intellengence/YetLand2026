import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { listSnapshotFiles, pruneSnapshots, quarantineCorruptState, recoverFromSnapshot } from './persistence';

describe('persistence snapshot retention', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'yelan-snap-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** 写一个文件并把 mtime 设成 ageSeconds 秒前，方便断言新→旧排序 */
  function makeFile(name: string, ageSeconds: number): void {
    const path = join(dir, name);
    writeFileSync(path, '{}', 'utf8');
    const t = Date.now() / 1000 - ageSeconds;
    utimesSync(path, t, t);
  }

  function names(prefix: string): string[] {
    return readdirSync(dir).filter((f) => f.startsWith(prefix));
  }

  it('listSnapshotFiles returns matching files newest-first', () => {
    makeFile('snapshot-a.json', 30);
    makeFile('snapshot-b.json', 10);
    makeFile('snapshot-c.json', 20);
    const list = listSnapshotFiles(dir, 'snapshot-');
    expect(list).toHaveLength(3);
    expect(list[0]!.path.endsWith('snapshot-b.json')).toBe(true);
    expect(list[2]!.path.endsWith('snapshot-a.json')).toBe(true);
  });

  it('listSnapshotFiles ignores other prefixes and non-json files', () => {
    makeFile('snapshot-x.json', 5);
    makeFile('corrupt-y.json', 5);
    writeFileSync(join(dir, 'snapshot-z.txt'), 'x', 'utf8');
    expect(listSnapshotFiles(dir, 'snapshot-')).toHaveLength(1);
  });

  it('listSnapshotFiles returns empty for a missing directory', () => {
    expect(listSnapshotFiles(join(dir, 'nope'), 'snapshot-')).toEqual([]);
  });

  it('pruneSnapshots keeps only the newest N and deletes the rest', () => {
    for (let i = 0; i < 20; i += 1) makeFile(`snapshot-${i}.json`, 20 - i); // i=19 newest
    pruneSnapshots(dir, 'snapshot-', 12);
    const remaining = names('snapshot-');
    expect(remaining).toHaveLength(12);
    expect(remaining).toContain('snapshot-19.json');
    expect(remaining).toContain('snapshot-8.json');
    expect(remaining).not.toContain('snapshot-7.json');
  });

  it('pruneSnapshots is a no-op when count is under the cap', () => {
    for (let i = 0; i < 5; i += 1) makeFile(`snapshot-${i}.json`, i);
    pruneSnapshots(dir, 'snapshot-', 12);
    expect(names('snapshot-')).toHaveLength(5);
  });

  it('pruning one prefix leaves the other prefix untouched', () => {
    for (let i = 0; i < 15; i += 1) makeFile(`snapshot-${i}.json`, 20 - i);
    for (let i = 0; i < 8; i += 1) makeFile(`corrupt-${i}.json`, 20 - i);
    pruneSnapshots(dir, 'snapshot-', 12);
    pruneSnapshots(dir, 'corrupt-', 5);
    expect(names('snapshot-')).toHaveLength(12);
    expect(names('corrupt-')).toHaveLength(5);
  });
});

describe('persistence corrupt-state recovery', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'yelan-recover-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** 写一份快照文件并把 mtime 设成 ageSeconds 秒前 */
  function makeSnapshot(name: string, content: string, ageSeconds: number): void {
    const path = join(dir, name);
    writeFileSync(path, content, 'utf8');
    const t = Date.now() / 1000 - ageSeconds;
    utimesSync(path, t, t);
  }

  it('recoverFromSnapshot returns the newest good snapshot, normalized', () => {
    makeSnapshot('snapshot-old.json', JSON.stringify({ users: { old: { id: 'old' } } }), 60);
    makeSnapshot('snapshot-new.json', JSON.stringify({ users: { fresh: { id: 'fresh' } } }), 10);
    const recovered = recoverFromSnapshot(dir);
    expect(recovered).not.toBeNull();
    expect(recovered!.users.fresh).toBeDefined();
    expect(recovered!.users.old).toBeUndefined();
    // normalizeLoadedState 跑过的证据：脏/缺失的 sidecarOrder 被补成 5 项
    expect(recovered!.sidecarOrder).toHaveLength(5);
  });

  it('recoverFromSnapshot skips a corrupt newest snapshot and falls back to an older good one', () => {
    makeSnapshot('snapshot-old.json', JSON.stringify({ users: { survivor: { id: 'survivor' } } }), 60);
    makeSnapshot('snapshot-new.json', '{ this is not valid json', 10);
    const recovered = recoverFromSnapshot(dir);
    expect(recovered).not.toBeNull();
    expect(recovered!.users.survivor).toBeDefined();
  });

  it('recoverFromSnapshot returns null when every snapshot is unparseable', () => {
    makeSnapshot('snapshot-a.json', '{ broken', 20);
    makeSnapshot('snapshot-b.json', 'also broken', 10);
    expect(recoverFromSnapshot(dir)).toBeNull();
  });

  it('recoverFromSnapshot returns null for an empty directory', () => {
    expect(recoverFromSnapshot(dir)).toBeNull();
  });

  it('quarantineCorruptState writes the corrupt bytes verbatim to a corrupt- file', () => {
    const raw = '{ "users": { "u1": ... truncated mid-write';
    quarantineCorruptState(dir, raw);
    const files = readdirSync(dir).filter((f) => f.startsWith('corrupt-') && f.endsWith('.json'));
    expect(files).toHaveLength(1);
    expect(readFileSync(join(dir, files[0]!), 'utf8')).toBe(raw);
  });

  it('quarantineCorruptState prunes corrupt copies to the cap and keeps the fresh one', () => {
    for (let i = 0; i < 6; i += 1) makeSnapshot(`corrupt-old-${i}.json`, '{}', 100 - i);
    const raw = 'freshly quarantined garbage';
    quarantineCorruptState(dir, raw);
    const files = readdirSync(dir).filter((f) => f.startsWith('corrupt-'));
    expect(files).toHaveLength(5);
    const survived = files.filter((f) => readFileSync(join(dir, f), 'utf8') === raw);
    expect(survived).toHaveLength(1);
  });
});
