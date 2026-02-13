import { callWithTool } from './api.js';
import { FORMALIZE_TOOL } from './schemas.js';
import { FORMALIZE_PROMPT, RETRY_PROMPT } from './prompts.js';
import { verify } from './verify.js';
import { extractLemmaSignatures, buildHintText } from './sentinel.js';

/**
 * For every requirement, attempt formal verification via strategy escalation:
 *   1. Direct  — LLM formalizes P(m) from requirement, Dafny checks requires Inv(m) ensures P(m)
 *   2. LLM-guided — LLM writes proof body
 *   3. Retry   — feed Dafny errors back
 *
 * Matched claims (predicates, lemmas, functions) are passed as hints to
 * help the LLM formalize and prove, but never used as the ensures clause.
 *
 * @param {object[]} matchEntries - from match step: [{ requirement, candidates }]
 * @param {object[]} allClaims - flattened claim items (with .naturalLanguage)
 * @param {string} domainSource - full Dafny source code
 * @param {string} domainDfyPath - absolute path to .dfy file
 * @param {string} domainModule - Dafny module name (e.g. 'CounterDomain')
 * @param {string} domain - domain display name
 * @param {object} [opts] - { retries, verbose, model }
 * @returns {Promise<object[]>} results per requirement
 */
export async function proveAll(matchEntries, allClaims, domainSource, domainDfyPath, domainModule, domain, opts = {}) {
  const maxRetries = opts.retries ?? 3;
  const signatures = extractLemmaSignatures(domainSource);
  const claimsById = new Map(allClaims.map((c) => [c.id, c]));
  const results = [];

  for (const entry of matchEntries) {
    const result = await proveRequirement(
      entry, claimsById, signatures,
      domainSource, domainDfyPath, domainModule, domain,
      maxRetries, allClaims, opts,
    );
    results.push(result);
  }

  return results;
}

async function proveRequirement(
  entry, claimsById, signatures,
  domainSource, domainDfyPath, domainModule, domain,
  maxRetries, allClaims, opts,
) {
  const { requirement, candidates } = entry;
  const strategiesTried = [];

  // ── Collect hints from all matched candidates ──

  const hints = [];

  for (const candidate of (candidates ?? [])) {
    const claim = claimsById.get(candidate.claimId);
    if (!claim) continue;

    const hint = buildHintText(candidate, claim, signatures);
    if (hint) {
      console.error(`[prove] Hint for "${requirement}": ${hint.kind} — ${candidate.claimId}`);
      hints.push(hint);
    }
  }

  // ── Strategy 1: Direct proof (LLM formalizes ensures from requirement) ──

  const hintArg = hints.length > 0 ? hints : undefined;
  console.error(`[prove] Direct proof for "${requirement}"${hintArg ? ` (with ${hintArg.length} hint(s))` : ''}`);
  let attempt = await formalize(requirement, domainSource, allClaims, domain, hintArg, opts);
  let result = await verify(attempt.dafnyCode, domainDfyPath, domainModule, opts);

  strategiesTried.push({
    strategy: 'direct',
    success: result.success,
    code: attempt.dafnyCode,
  });

  if (result.success) {
    console.error(`[prove] Direct proof verified`);
    return {
      requirement,
      status: 'proved',
      strategy: 'direct',
      lemmaName: attempt.lemmaName,
      dafnyCode: attempt.dafnyCode,
      reasoning: attempt.reasoning,
      attempts: strategiesTried.length,
      strategiesTried,
    };
  }

  // ── Strategy 2+3: LLM-guided with retries ──

  let retryCount = 0;
  while (!result.success && retryCount < maxRetries) {
    retryCount++;
    console.error(`[prove] Retry ${retryCount}/${maxRetries} for "${requirement}"`);

    attempt = await retryFormalize(requirement, attempt.dafnyCode, result.error, domain, opts);
    result = await verify(attempt.dafnyCode, domainDfyPath, domainModule, opts);

    strategiesTried.push({
      strategy: retryCount === 1 ? 'llm-guided' : 'retry',
      success: result.success,
      code: attempt.dafnyCode,
    });
  }

  if (result.success) {
    console.error(`[prove] LLM-guided proof verified`);
    return {
      requirement,
      status: 'proved',
      strategy: retryCount === 1 ? 'llm-guided' : 'retry',
      lemmaName: attempt.lemmaName,
      dafnyCode: attempt.dafnyCode,
      reasoning: attempt.reasoning,
      attempts: strategiesTried.length,
      strategiesTried,
    };
  }

  // ── All strategies exhausted ──

  console.error(`[prove] Failed after ${strategiesTried.length} attempts`);
  return {
    requirement,
    status: 'gap',
    lemmaName: attempt.lemmaName,
    dafnyCode: attempt.dafnyCode,
    reasoning: attempt.reasoning,
    error: result.error,
    attempts: strategiesTried.length,
    strategiesTried,
  };
}

async function formalize(requirement, domainSource, claimsIndex, domain, hints, opts) {
  const model = opts.model ?? 'claude-sonnet-4-5-20250929';
  const prompt = FORMALIZE_PROMPT(domain, requirement, domainSource, claimsIndex, hints);

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
