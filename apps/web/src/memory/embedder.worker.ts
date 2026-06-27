/// <reference lib="webworker" />
// transformers.js + bge-small-zh-v1.5 (~90MB)
// 跑在 Web Worker 内，主线程通过 postMessage 提交文本，得到 Float32Array
// TODO: import { pipeline } from '@xenova/transformers'
//       const extractor = await pipeline('feature-extraction', 'Xenova/bge-small-zh-v1.5');

self.onmessage = async (_e: MessageEvent<{ id: string; text: string }>) => {
  // const { id, text } = e.data;
  // const out = await extractor(text, { pooling: 'mean', normalize: true });
  // (self as DedicatedWorkerGlobalScope).postMessage({ id, embedding: out.data });
};
