import { describe, expect, it } from 'vitest';
import { inspectionRecord, inspectionText, kvInspectionRecords } from './phone-inspection-records';
describe('phone content inspection adapters', () => {
  it('does not collect API configuration, credentials or unrelated storage', () => {
    expect(kvInspectionRecords('ai_phone_api_configs_v1', '[{"apiKey":"secret"}]')).toEqual([]);
    expect(inspectionText({ content: '正文', apiKey: 'secret', token: 'private', backendLogs: ['raw output'], nativeToolResult: { content: 'secret' } })).toBe('内容：正文');
    expect(inspectionText('Bearer abcdefghijklmnopqrstuvwxyz sk-abcdefghijklmnopqrstuvwxyz')).not.toContain('abcdefghijklmnopqrstuvwxyz');
  });
  it('keeps editable private role settings while skipping platform-only roles', () => {
    const rows = kvInspectionRecords('ai_phone_characters_v1', JSON.stringify([{ id: 'public', canEdit: false }, { id: 'private', name: '自定义角色', canEdit: true, persona: '用户角色设定' }]));
    expect(rows).toHaveLength(1); expect(rows[0].kind).toBe('role'); expect(rows[0].sections.some(section => section.text === '用户角色设定')).toBe(true);
  });
  it('archives each work individually and leaves technical logs out of creative content', () => {
    const rows = kvInspectionRecords('ai_phone_cocreate_library_v1', JSON.stringify({ sessions: [{ id: 'work-1', title: '桥上的故事', partnerCharacterId: 'role-1', chapters: [{ title: '第一章', content: '正文内容' }], backendLogs: [{ rawOutput: 'diagnostic' }] }] }));
    expect(rows[0].title).toBe('桥上的故事'); expect(rows[0].characterIds).toEqual(['role-1']);
    expect(rows[0].sections.map(section => section.text).join('')).toContain('正文内容'); expect(JSON.stringify(rows)).not.toContain('diagnostic');
  });
  it('marks bounded records as partial without mutating local content', () => {
    const content = '文'.repeat(200001); const row = inspectionRecord('story', 'story', { id: 'test', title: '长篇' }, [{ title: '正文', text: content }])!;
    expect(row.truncated).toBe(true); expect(row.sections[0].text.length).toBe(200000); expect(content.length).toBe(200001);
  });
  it('keeps world descriptions and user text rules readable', () => {
    const rows = kvInspectionRecords('ai_phone_character_worlds_v1', JSON.stringify([{ id: 'world', name: '星河', description: '用户世界背景', memberIds: ['private'], relations: [{ label: '同行伙伴' }] }]));
    expect(rows[0].kind).toBe('worldview'); expect(rows[0].characterIds).toEqual(['private']); expect(JSON.stringify(rows)).toContain('同行伙伴');
    expect(inspectionText({ secret: '角色尚未揭露的身世' })).toContain('角色尚未揭露的身世');
  });
});
