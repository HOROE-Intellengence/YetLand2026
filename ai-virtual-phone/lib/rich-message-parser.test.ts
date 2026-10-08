import { describe, expect, it, vi } from 'vitest';
vi.mock('./custom-app-storage', () => ({ loadInstalledCustomApps: () => [] }));
// These cases isolate media parsing; they do not test action dispatch.
vi.mock('./action-parser', () => ({ stripActionShells: (text: string) => text }));
import { parseAIResponse } from './rich-message-parser';

describe('phone rich message protocol regression', () => {
  it.each([
    ['[红包:8.88:祝好]', 'red_packet'],
    ['[转账:12:午饭]', 'transfer'],
    ['[礼物:纸鹤]', 'gift'],
    ['[照片:紫色纸鹤]', 'image'],
    ['[位置:星河桥]', 'location'],
    ['[表情包:开心]', 'sticker'],
    ['[引用:明天见]好的', 'quote'],
    ['[语音条:明天见]', 'audio'],
    ['[音乐:晴天-周杰伦]', 'music'],
  ])('parses %s without exposing protocol as ordinary text', (input, type) => {
    expect(parseAIResponse(input, []).parts).toEqual([expect.objectContaining({mediaType: type})]);
  });
  it('keeps text around multiple media and drops invisible empty bubbles', () => {
    const parsed = parseAIResponse('你好\n\n[红包:8.88:祝好]\n\n\u200b\n\n[位置:星河桥]\n\n明天见', []);
    expect(parsed.parts.map(p => p.mediaType || p.content)).toEqual(['你好','red_packet','location','明天见']);
    expect(parsed.parts[1].mediaData).toMatchObject({amount:8.88,status:'pending'});
  });
  it('preserves unknown protocol text', () => {
    expect(parseAIResponse('[未知格式:测试]', []).parts[0].content).toContain('[未知格式:测试]');
  });
});
