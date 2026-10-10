import { readingBlocks } from '../lib/record-reader';
import './RecordReader.css';
export function RecordReader({ value, label = '正文' }: { value: unknown; label?: string }) {
  const blocks = readingBlocks(value, label);
  return (
    <div className="record-reader">
      {blocks.length ? (
        blocks.map((block, index) => (
          <section
            className={`record-message${block.label === '用户' ? ' record-message-user' : ''}`}
            key={index}
          >
            <h4>{block.label}</h4>
            <div className="record-prose">{block.text}</div>
          </section>
        ))
      ) : (
        <p className="text-muted">暂无可阅读内容。</p>
      )}
    </div>
  );
}
