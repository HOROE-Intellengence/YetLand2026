// 低端机降级：jieba 分词 + BM25 替代向量召回
// 触发: hardware_concurrency < 4 || deviceMemory < 2
export function shouldFallback(): boolean {
  const cpu = navigator.hardwareConcurrency ?? 4;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
  return cpu < 4 || mem < 2;
}

// TODO: 实现 BM25
