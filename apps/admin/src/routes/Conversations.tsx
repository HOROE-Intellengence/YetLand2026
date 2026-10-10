import { useState } from 'react';
import { Sessions } from './Sessions';
import { PhoneChatLogs } from './PhoneChatLogs';
import { PhoneInspections } from './PhoneInspections';
import { VoiceRecords } from './VoiceRecords';
import { ApiGatewayOverview } from './ApiGateway';
import '../components/RecordReader.css';
export function Conversations() {
  const [category, setCategory] = useState('text');
  const [textKind, setTextKind] = useState('traditional');
  return (
    <section>
      <h1>对话</h1>
      <p className="text-muted">按功能查找记录，选择列表中的会话或作品阅读正文。</p>
      <div className="conversation-tabs" aria-label="对话分类">
        {(
          [
            ['text', '文本'],
            ['voice', '语音'],
            ['api', 'API'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            className="btn"
            aria-pressed={category === value}
            onClick={() => setCategory(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {category === 'text' && (
        <>
          <label className="conversation-category">
            文本类型
            <select value={textKind} onChange={(e) => setTextKind(e.target.value)}>
              <option value="traditional">传统聊天</option>
              <option value="phone">小手机聊天</option>
              <option value="inspection">内容巡查</option>
            </select>
          </label>
          {textKind === 'traditional' ? (
            <Sessions />
          ) : textKind === 'phone' ? (
            <PhoneChatLogs />
          ) : (
            <PhoneInspections />
          )}
        </>
      )}
      {category === 'voice' && <VoiceRecords />}
      {category === 'api' && <ApiGatewayOverview />}
    </section>
  );
}
