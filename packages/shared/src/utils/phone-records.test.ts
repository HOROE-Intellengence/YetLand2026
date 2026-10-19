import { describe,expect,it } from 'vitest';
import { inferPhoneSource,semanticPhoneBlocks } from './phone-records';
describe('phone record interpretation',()=>{
  it('keeps origin inference conservative and ignores shared authoritative role instructions',()=>{
    expect(inferPhoneSource(JSON.stringify([{role:'system',content:'角色喜欢抖音、游戏和访谈'},{role:'user',content:'晚安'}]))).toBe('unknown');
    expect(inferPhoneSource('[]','game:save-1')).toBe('game');
    expect(inferPhoneSource(JSON.stringify([{role:'system',content:'共同设定'},{role:'user',content:'[抖音] 给这条视频评论'}]))).toBe('douyin');
  });
  it('reconstructs semantic output through ordinary and streaming envelopes',()=>{
    expect(semanticPhoneBlocks(JSON.stringify({choices:[{message:{content:'{"choice":2,"say":"好牌。"}'}}]}))).toEqual([{label:'出牌',text:'2'},{label:'角色吐槽',text:'好牌。'}]);
    const sse='data: '+JSON.stringify({choices:[{delta:{content:'{"messages":["晚安。","早点休息。"],"sticker":"x"}'}}]})+'\n\ndata: [DONE]\n\n';
    expect(semanticPhoneBlocks(sse)).toEqual([{label:'角色私信',text:'晚安。'},{label:'角色私信',text:'早点休息。'}]);
    expect(semanticPhoneBlocks('{"actions":[]}')[0]?.text).toBe('本轮没有执行互动动作。');
  });
});
