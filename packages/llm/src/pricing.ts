const PRICING: Record<string, { input: number; output: number }> = {
  'claude-sonnet': { input: 3e-6, output: 15e-6 },
  'claude-haiku': { input: 0.25e-6, output: 1.25e-6 },
  'claude-opus': { input: 15e-6, output: 75e-6 },
  'gpt-4o': { input: 2.5e-6, output: 10e-6 },
  'gpt-4o-mini': { input: 0.15e-6, output: 0.6e-6 },
  'deepseek-chat': { input: 0.14e-6, output: 0.28e-6 },
  'deepseek-reasoner': { input: 0.55e-6, output: 2.19e-6 },
  'nvidia-unlim': { input: 0, output: 0 },
  'script-fallback': { input: 0, output: 0 },
};

const FALLBACK_PRICE = { input: 1e-6, output: 1e-6 };

export function getProviderPrice(model: string | undefined): { input: number; output: number } {
  if (!model) return FALLBACK_PRICE;
  const lower = model.toLowerCase();
  for (const [key, price] of Object.entries(PRICING)) {
    if (lower.includes(key)) return price;
  }
  return FALLBACK_PRICE;
}

export function estimateInputTokens(body: { text: string; history: Array<{ content: string }> }): number {
  let chars = body.text.length;
  for (const m of body.history) chars += m.content.length;
  return Math.ceil(chars / 2) + 500;
}
