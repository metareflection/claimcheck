import { callWithTool } from './api.js';
import { MATCH_TOOL } from './schemas.js';
import { MATCH_PROMPT } from './prompts.js';

/**
 * Match translated claims against user requirements, producing candidate
 * hints for formal verification — not final verdicts.
 *
 * @param {object[]} translatedItems - items with .naturalLanguage
 * @param {string} requirementsText - raw markdown requirements
 * @param {string} domain
 * @param {object} [opts]
 * @returns {Promise<{ matches: object[], unexpected: object[], summary: string }>}
 */
export async function matchClaims(translatedItems, requirementsText, domain, opts = {}) {
  const model = opts.model ?? 'claude-sonnet-4-5-20250929';
  const prompt = MATCH_PROMPT(domain, translatedItems, requirementsText);

  const response = await callWithTool({
    model,
    prompt,
    tool: MATCH_TOOL,
    toolChoice: { type: 'tool', name: 'record_matches' },
    verbose: opts.verbose,
  });

  return response.input;
}
