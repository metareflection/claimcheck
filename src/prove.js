import { callWithTool } from './api.js';
import { FORMALIZE_TOOL } from './schemas.js';
import { FORMALIZE_PROMPT, RETRY_PROMPT } from './prompts.js';
import { verify } from './verify.js';

/**
 * For every requirement, attempt formal verification:
 *   1. Formalize — LLM writes a Dafny lemma from the requirement + domain source
 *   2. Verify   — Dafny checks it
 *   3. Retry    — if failed, LLM retries once with the Dafny error
 *   4. Obligation — if still failed, emit as obligation
 *
 * Two LLM calls and two Dafny calls, max. Per requirement.
 *
 * @param {string[]} requirements - requirement texts
 * @param {string} domainSource - full Dafny source code
 * @param {string} domainDfyPath - absolute path to .dfy file
 * @param {string} domainModule - Dafny module name (e.g. 'CounterDomain')
 * @param {string} domain - domain display name
 * @param {object} [opts] - { verbose, model }
 * @returns {Promise<object[]>} results per requirement
 */
export async function proveAll(requirements, domainSource, domainDfyPath, domainModule, domain, opts = {}) {
  const results = [];

  for (const requirement of requirements) {
    const result = await proveRequirement(
      requirement, domainSource, domainDfyPath, domainModule, domain, opts,
    );
    results.push(result);
  }

  return results;
}

async function proveRequirement(requirement, domainSource, domainDfyPath, domainModule, domain, opts) {
  const strategiesTried = [];

  // ── Attempt 1: Formalize + verify ──

  console.error(`[prove] Formalizing "${requirement}"`);
  let attempt = await formalize(requirement, domainSource, domain, opts);
  let result = await verify(attempt.dafnyCode, domainDfyPath, domainModule, opts);

  strategiesTried.push({
    strategy: 'direct',
    success: result.success,
    code: attempt.dafnyCode,
  });

  if (result.success) {
    console.error(`[prove] Verified on first attempt`);
    return {
      requirement,
      status: 'proved',
      strategy: 'direct',
      lemmaName: attempt.lemmaName,
      dafnyCode: attempt.dafnyCode,
      reasoning: attempt.reasoning,
      attempts: 1,
      strategiesTried,
    };
  }

  // ── Attempt 2: Retry once with Dafny error ──

  console.error(`[prove] Retrying "${requirement}"`);
  attempt = await retryFormalize(requirement, attempt.dafnyCode, result.error, domain, opts);
  result = await verify(attempt.dafnyCode, domainDfyPath, domainModule, opts);

  strategiesTried.push({
    strategy: 'retry',
    success: result.success,
    code: attempt.dafnyCode,
  });

  if (result.success) {
    console.error(`[prove] Verified on retry`);
    return {
      requirement,
      status: 'proved',
      strategy: 'retry',
      lemmaName: attempt.lemmaName,
      dafnyCode: attempt.dafnyCode,
      reasoning: attempt.reasoning,
      attempts: 2,
      strategiesTried,
    };
  }

  // ── Obligation ──

  console.error(`[prove] Failed after 2 attempts — obligation`);
  return {
    requirement,
    status: 'gap',
    lemmaName: attempt.lemmaName,
    dafnyCode: attempt.dafnyCode,
    reasoning: attempt.reasoning,
    error: result.error,
    attempts: 2,
    strategiesTried,
  };
}

async function formalize(requirement, domainSource, domain, opts) {
  const model = opts.model ?? 'claude-sonnet-4-5-20250929';
  const prompt = FORMALIZE_PROMPT(domain, requirement, domainSource);

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
