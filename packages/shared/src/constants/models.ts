export interface ModelPricing {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}

// All prices are per 1M tokens (USD)
export const MODEL_PRICING: Record<string, ModelPricing> = {
  'claude-opus-4-6':              { input: 15.00, output: 75.00, cacheRead: 1.50, cacheCreation: 18.75 },
  'claude-sonnet-4-6':            { input: 3.00,  output: 15.00, cacheRead: 0.30, cacheCreation: 3.75 },
  'claude-haiku-4-5':             { input: 0.80,  output: 4.00,  cacheRead: 0.08, cacheCreation: 1.00 },
  // Legacy models (may appear in older JSONL files)
  'claude-opus-4-5-20251101':     { input: 15.00, output: 75.00, cacheRead: 1.50, cacheCreation: 18.75 },
  'claude-sonnet-4-5-20241022':   { input: 3.00,  output: 15.00, cacheRead: 0.30, cacheCreation: 3.75 },
};

export const DEFAULT_MODEL = 'claude-opus-4-6';
