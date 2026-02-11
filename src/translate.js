import { callWithTool } from './api.js';
import { TRANSLATE_TOOL } from './schemas.js';
import { TRANSLATE_PROMPT } from './prompts.js';

/**
 * Translate flattened claim items to natural language via the API.
 *
 * @param {object[]} items - from flattenClaims
 * @param {string} domain - domain name for prompt context
 * @param {object} [opts]
 * @returns {Promise<object[]>} items augmented with .naturalLanguage and .confidence
 */
export async function translateClaims(items, domain, opts = {}) {
  if (items.length === 0) return [];

  const batchSize = 10;
  const batches = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }

  console.error(`[translate] ${batches.length} batches of ${batchSize} (parallel)`);

  // Run all batches in parallel
  const batchResults = await Promise.all(
    batches.map(batch => translateBatch(batch, domain, opts))
  );

  return batchResults.flat();
}

async function translateBatch(items, domain, opts) {
  const prompt = TRANSLATE_PROMPT(domain, items);
  const model = opts.model ?? 'claude-haiku-4-5-20251001';

  const response = await callWithTool({
    model,
    prompt,
    tool: TRANSLATE_TOOL,
    toolChoice: { type: 'tool', name: 'record_translations' },
    verbose: opts.verbose,
  });

  const translations = response.input.translations ?? [];

  return items.map((item, idx) => ({
    ...item,
    naturalLanguage: translations[idx]?.naturalLanguage ?? '[translation failed]',
    confidence: translations[idx]?.confidence ?? 0,
  }));
}
