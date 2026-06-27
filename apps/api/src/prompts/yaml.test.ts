import { describe, expect, it } from 'vitest';
import { parseTinyYaml } from './yaml';

describe('parseTinyYaml', () => {
  it('parses scalar values', () => {
    const result = parseTinyYaml('name: shen\nrarity: paid\nprice: 100');
    expect(result.name).toBe('shen');
    expect(result.rarity).toBe('paid');
    expect(result.price).toBe(100);
  });

  it('parses booleans', () => {
    const result = parseTinyYaml('active: true\nhidden: false');
    expect(result.active).toBe(true);
    expect(result.hidden).toBe(false);
  });

  it('parses multiline strings with |', () => {
    const result = parseTinyYaml('greeting: |\n  你好\n  欢迎回来\n');
    expect(result.greeting).toBe('你好\n欢迎回来\n');
  });

  it('parses arrays', () => {
    const result = parseTinyYaml('tags:\n  - romance\n  - drama\n  - comedy');
    const tags = result.tags as string[];
    expect(Array.isArray(tags)).toBe(true);
    expect(tags).toEqual(['romance', 'drama', 'comedy']);
  });

  it('parses nested objects', () => {
    const result = parseTinyYaml('voice:\n  pitch: medium\n  speed: fast\n  forbidden:\n    - a\n    - b');
    const voice = result.voice as Record<string, unknown>;
    expect(voice.pitch).toBe('medium');
    expect(voice.speed).toBe('fast');
    expect(Array.isArray(voice.forbidden)).toBe(true);
  });

  it('parses quoted strings', () => {
    const result = parseTinyYaml(`name: "shen"\ndesc: 'hello world'`);
    expect(result.name).toBe('shen');
    expect(result.desc).toBe('hello world');
  });

  it('parses deeply nested structures', () => {
    const yaml = `
character:
  id: shen
  opening_lines:
    first_visit: 你终于来了
    return_visit: 又见面了
  voice:
    style: gentle
    forbidden_phrases:
      - 宝贝
      - 亲爱的
  style_tags:
    - romance
    - historical
`;
    const result = parseTinyYaml(yaml);
    const char = result.character as Record<string, unknown>;
    expect(char.id).toBe('shen');
    const opening = char.opening_lines as Record<string, unknown>;
    expect(opening.first_visit).toBe('你终于来了');
    expect(opening.return_visit).toBe('又见面了');
    const voice = char.voice as Record<string, unknown>;
    expect(voice.style).toBe('gentle');
    expect(voice.forbidden_phrases).toEqual(['宝贝', '亲爱的']);
  });

  it('returns {} for empty string', () => {
    expect(parseTinyYaml('')).toEqual({});
  });

  it('returns {} for null/undefined YAML result', () => {
    expect(parseTinyYaml('null')).toEqual({});
  });

  it('throws on non-object top-level YAML', () => {
    expect(() => parseTinyYaml('- item1\n- item2')).toThrow('YAML 顶层必须是 object');
    expect(() => parseTinyYaml('42')).toThrow('YAML 顶层必须是 object');
    expect(() => parseTinyYaml('"a string"')).toThrow('YAML 顶层必须是 object');
  });

  it('handles YAML with comments', () => {
    const result = parseTinyYaml('# comment\nname: shen # inline comment\nrarity: paid');
    expect(result.name).toBe('shen');
    expect(result.rarity).toBe('paid');
  });

  it('handles YAML with empty lines', () => {
    const result = parseTinyYaml('\n\nname: shen\n\nrarity: paid\n\n');
    expect(result.name).toBe('shen');
    expect(result.rarity).toBe('paid');
  });
});
