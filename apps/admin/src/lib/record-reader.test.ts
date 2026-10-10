import { describe, expect, it } from 'vitest';
import { latestUserInput, readingBlocks } from './record-reader';
describe('human readable records', () => {
  it('reads message arrays and omits transport metadata', () => {
    expect(
      readingBlocks(
        JSON.stringify({
          model: 'private-model',
          messages: [
            { role: 'user', content: '你好' },
            { role: 'assistant', content: '晚上好' },
          ],
        }),
      ),
    ).toEqual([
      { label: '用户', text: '你好' },
      { label: 'AI', text: '晚上好' },
    ]);
  });
  it('joins streamed deltas and renders generated structured content', () => {
    // Use real JSON encoders to match archived SSE escaping.
    const stream =
      ['{"title":"夜晚",', '"content":"正文"}']
        .map((content) => 'data: ' + JSON.stringify({ choices: [{ delta: { content } }] }) + '\n\n')
        .join('') + 'data: [DONE]\n\n';
    expect(readingBlocks(stream)).toEqual([
      { label: '标题', text: '夜晚' },
      { label: '正文', text: '正文' },
    ]);
  });
  it('does not expose malformed JSON or tool arguments', () => {
    expect(readingBlocks('{"content":')).toEqual([
      { label: '正文', text: '结构化记录不完整，无法还原正文。' },
    ]);
    const result = readingBlocks({
      choices: [
        { message: { role: 'assistant', content: null, tool_calls: [{ arguments: 'private' }] } },
      ],
    });
    expect(result).toEqual([{ label: '工具调用', text: '本轮调用了工具。' }]);
  });
  it('preserves paragraphs and labels attachments without fetching them', () => {
    expect(
      readingBlocks([
        {
          role: 'user',
          content: [
            { type: 'text', text: '第一段\n\n第二段' },
            { type: 'image_url', image_url: { url: 'https://private' } },
          ],
        },
      ]),
    ).toEqual([
      { label: '用户', text: '第一段\n\n第二段' },
      { label: '用户', text: '〔图片附件〕' },
    ]);
  });
  it('shows current input separately from replayed history', () => {
    expect(
      latestUserInput(
        JSON.stringify([
          { role: 'user', content: '旧' },
          { role: 'assistant', content: '旧回复' },
          { role: 'user', content: '新' },
        ]),
      ),
    ).toEqual([{ role: 'user', content: '新' }]);
  });
});
