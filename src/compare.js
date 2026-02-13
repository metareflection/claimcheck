import { callWithTool } from './api.js';
import { COMPARE_TOOL } from './schemas.js';
import { COMPARE_PROMPT } from './prompts.js';

/**
 * Compare translated claims against requirements to assess coverage.
 *
 * @param {{ id: string, naturalLanguage: string, kind: string }[]} translatedItems
 * @param {string} requirementsText - raw requirements markdown
 * @param {string} domain - domain display name
 * @param {object} [opts] - { verbose, model }
 * @returns {Promise<{ proved: object[], missing: object[], unexpected: object[], summary: string }>}
 */
export async function compareClaims(translatedItems, requirementsText, domain, opts = {}) {
  if (translatedItems.length === 0) {
    return {
      proved: [],
      missing: [],
      unexpected: [],
      summary: 'No claims to compare.',
    };
  }

  const model = opts.model ?? 'claude-sonnet-4-5-20250929';

  console.error(`[compare] Comparing ${translatedItems.length} claim(s) against requirements...`);

  const prompt = COMPARE_PROMPT(domain, translatedItems, requirementsText);
  const response = await callWithTool({
    model,
    prompt,
    tool: COMPARE_TOOL,
    toolChoice: { type: 'tool', name: 'record_coverage' },
    verbose: opts.verbose,
    maxTokens: 8192,
  });

  return response.input;
}
