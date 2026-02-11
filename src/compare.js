import { callWithTool } from './api.js';
import { COMPARE_TOOL } from './schemas.js';
import { COMPARE_PROMPT } from './prompts.js';

/**
 * Compare translated claims against user requirements.
 *
 * @param {object[]} translatedItems - items with .naturalLanguage
 * @param {string} requirementsText - raw markdown requirements
 * @param {string} domain
 * @param {object} [opts]
 * @returns {Promise<object>} { proved, missing, unexpected, summary }
 */
export async function compareClaims(translatedItems, requirementsText, domain, opts = {}) {
  const model = opts.model ?? 'claude-sonnet-4-5-20250929';
  const prompt = COMPARE_PROMPT(domain, translatedItems, requirementsText);

  const response = await callWithTool({
    model,
    prompt,
    tool: COMPARE_TOOL,
    toolChoice: { type: 'tool', name: 'record_coverage' },
    verbose: opts.verbose,
  });

  return response.input;
}
