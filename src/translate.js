import { callWithTool } from './api.js';
import { TRANSLATE_TOOL } from './schemas.js';
import { TRANSLATE_PROMPT } from './prompts.js';

/**
 * Translate formal Dafny claims to English using batched LLM calls.
 *
 * @param {{ id: string, kind: string, formalText: string, context: string }[]} items
 * @param {string} domain - domain display name
 * @param {object} [opts] - { verbose, model }
 * @returns {Promise<object[]>} items augmented with .naturalLanguage and .confidence
 */
export async function translateClaims(items, domain, opts = {}) {
  if (items.length === 0) return [];

  const model = opts.model ?? 'claude-haiku-4-5-20251001';
  const BATCH_SIZE = 10;
  const results = [...items];

  // Process in batches
  for (let start = 0; start < items.length; start += BATCH_SIZE) {
    const batch = items.slice(start, start + BATCH_SIZE);
    const batchNum = Math.floor(start / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(items.length / BATCH_SIZE);

    console.error(`[translate] Batch ${batchNum}/${totalBatches} (${batch.length} claims)...`);

    const prompt = TRANSLATE_PROMPT(domain, batch);
    const response = await callWithTool({
      model,
      prompt,
      tool: TRANSLATE_TOOL,
      toolChoice: { type: 'tool', name: 'record_translations' },
      verbose: opts.verbose,
      maxTokens: 4096,
    });

    const translations = response.input.translations;

    // Merge translations back by id
    const translationById = new Map();
    for (const t of translations) {
      translationById.set(t.id, t);
    }

    for (let i = start; i < start + batch.length && i < results.length; i++) {
      const t = translationById.get(results[i].id);
      if (t) {
        results[i] = {
          ...results[i],
          naturalLanguage: t.naturalLanguage,
          confidence: t.confidence,
        };
      } else {
        results[i] = {
          ...results[i],
          naturalLanguage: '(translation not produced)',
          confidence: 0,
        };
      }
    }
  }

  return results;
}
