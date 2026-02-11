import { callWithTool } from './api.js';
import { FORMALIZE_TOOL } from './schemas.js';
import { FORMALIZE_PROMPT, RETRY_PROMPT } from './prompts.js';
import { verify } from './verify.js';

/**
 * For each missing requirement, attempt to formalize and verify it.
 *
 * @param {object[]} missingItems - from compare step: [{ requirement, explanation }]
 * @param {string} domainSource - full Dafny source code
 * @param {string} domainDfyPath - absolute path to .dfy file
 * @param {string} domainModule - Dafny module name (e.g. 'CounterDomain')
 * @param {object[]} claimsIndex - flattened claims for context
 * @param {string} domain - domain name
 * @param {object} [opts] - { retries, verbose, model }
 * @returns {Promise<object[]>} results per requirement
 */
export async function proveAll(missingItems, domainSource, domainDfyPath, domainModule, claimsIndex, domain, opts = {}) {
  const maxRetries = opts.retries ?? 3;
  const results = [];

  for (const item of missingItems) {
    console.error(`\n[prove] Formalizing: "${item.requirement}"`);

    let attempt = await formalize(item.requirement, domainSource, claimsIndex, domain, opts);
    console.error(`[prove] Generated lemma: ${attempt.lemmaName}`);

    let result = await verify(attempt.dafnyCode, domainDfyPath, domainModule, opts);

    if (result.success) {
      console.error(`[prove] Verified on first attempt`);
      results.push({
        requirement: item.requirement,
        status: 'proved',
        lemmaName: attempt.lemmaName,
        dafnyCode: attempt.dafnyCode,
        reasoning: attempt.reasoning,
        attempts: 1,
      });
      continue;
    }

    let attempts = 1;
    while (!result.success && attempts < maxRetries) {
      attempts++;
      console.error(`[prove] Attempt ${attempts}/${maxRetries}...`);

      attempt = await retryFormalize(item.requirement, attempt.dafnyCode, result.error, domain, opts);
      result = await verify(attempt.dafnyCode, domainDfyPath, domainModule, opts);
    }

    if (result.success) {
      console.error(`[prove] Verified on attempt ${attempts}`);
      results.push({
        requirement: item.requirement,
        status: 'proved',
        lemmaName: attempt.lemmaName,
        dafnyCode: attempt.dafnyCode,
        reasoning: attempt.reasoning,
        attempts,
      });
    } else {
      console.error(`[prove] Failed after ${attempts} attempts`);
      results.push({
        requirement: item.requirement,
        status: 'gap',
        lemmaName: attempt.lemmaName,
        dafnyCode: attempt.dafnyCode,
        reasoning: attempt.reasoning,
        error: result.error,
        attempts,
      });
    }
  }

  return results;
}

async function formalize(requirement, domainSource, claimsIndex, domain, opts) {
  const model = opts.model ?? 'claude-sonnet-4-5-20250929';
  const prompt = FORMALIZE_PROMPT(domain, requirement, domainSource, claimsIndex);

  const response = await callWithTool({
    model,
    prompt,
    tool: FORMALIZE_TOOL,
    toolChoice: { type: 'tool', name: 'record_formalization' },
    verbose: opts.verbose,
  });

  return response.input;
}

async function retryFormalize(requirement, previousCode, dafnyError, domain, opts) {
  const model = opts.model ?? 'claude-sonnet-4-5-20250929';
  const prompt = RETRY_PROMPT(domain, requirement, previousCode, dafnyError);

  const response = await callWithTool({
    model,
    prompt,
    tool: FORMALIZE_TOOL,
    toolChoice: { type: 'tool', name: 'record_formalization' },
    verbose: opts.verbose,
  });

  return response.input;
}
