import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { resources } from './catalog';
import { characterPreview } from './preview';

const window: Record<string, any> = {};
runInNewContext(
  readFileSync(
    new URL('../../../../prototype/community/public/previews.js', import.meta.url),
    'utf8',
  ),
  { window },
);
const ui = window.CommunityPreviews;

describe('community read-only previews', () => {
  it('projects authoring fields without notes, consent, voice configuration or private copies', () => {
    const resource = structuredClone(resources.find((r) => r.payload)!);
    resource.payload!.worldbook!.notes = 'private provenance';
    const preview = characterPreview(resource)!;
    expect(preview.name).toBe(resource.payload!.name);
    expect(preview.background).toBe(resource.payload!.worldbook!.background);
    expect(Object.keys(preview)).toEqual([
      'name',
      'background',
      'location',
      'opening',
      'principles',
      'style',
      'boundaries',
      'relationshipByUser',
      'relationshipByChar',
    ]);
    expect(JSON.stringify(preview)).not.toContain('private provenance');
  });
  it('bounds card summaries while preserving full detail text and missing opening', () => {
    const resource = structuredClone(resources.find((r) => r.payload)!);
    resource.payload!.worldbook!.background = '长'.repeat(500);
    expect(characterPreview(resource, true)!.background).toHaveLength(161);
    expect(characterPreview(resource)!.background).toHaveLength(500);
    expect(characterPreview(resource)!.opening).toBe('');
    expect(characterPreview(resources.find((r) => r.type === 'theme')!)).toBeNull();
  });
  it('renders text as text in names, settings, triggers, and descriptions', () => {
    const attack = '<img src=x onerror="alert(1)">';
    const character = ui.detail(
      { type: 'character' },
      { name: attack, background: attack, opening: attack },
    );
    const book = ui.detail({
      type: 'worldbook',
      worldbook: { entries: [{ key: attack, content: attack }] },
    });
    expect(character).toContain('&lt;img');
    expect(book).toContain('&lt;img');
    expect(character + book).not.toContain('<img');
  });
  it('rejects remote/executable wallpaper and arbitrary CSS but keeps actual theme colors', () => {
    const html = ui.detail({
      type: 'theme',
      theme: {
        name: 'test',
        cssOverrides: {
          '--c-page-body-bg': '#111a2a',
          '--c-header-bg': 'red;position:fixed',
          '--untrusted': 'url(https://bad.example)',
        },
        wallpaper: { dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' },
      },
    });
    expect(html).toContain('--c-page-body-bg:#111a2a');
    expect(html).not.toContain('position:fixed');
    expect(html).not.toContain('bad.example');
    expect(html).not.toContain('data:image/svg');
  });
  it('offers both theme scenes with a passive preview and no install controls', () => {
    const html = ui.detail(resources.find((r) => r.theme)!);
    expect(html).toContain('data-preview-scene="desktop"');
    expect(html).toContain('data-preview-scene="chat"');
    expect(html).toContain('data-preview-panel="chat" hidden');
    expect(html).not.toContain('/api/private');
  });
  it('shows all worldbook entries and correct constant/keyword counts', () => {
    const resource = resources.find((r) => r.worldbook)!;
    const html = ui.detail(resource);
    expect(html.match(/class="rp-entry"/g)).toHaveLength(resource.worldbook!.entries.length);
    for (const entry of resource.worldbook!.entries) expect(html).toContain(entry.content);
    expect(html).toContain('触发词：旧车站,末班车');
  });
});
