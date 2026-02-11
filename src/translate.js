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

  const results = [];
  const batchSize = 10;

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    if (opts.verbose) {
      console.error(`[translate] batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(items.length / batchSize)}`);
    }
    const translated = await translateBatch(batch, domain, opts);
    results.push(...translated);
  }

  return results;
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
