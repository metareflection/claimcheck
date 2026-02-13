import { callWithTool } from './api.js';
import { FORMALIZE_TOOL } from './schemas.js';
import { FORMALIZE_PROMPT, RETRY_PROMPT } from './prompts.js';
import { verify } from './verify.js';
import { extractLemmaSignatures, buildSentinelCode, buildLemmaHintText } from './sentinel.js';

/**
 * For every requirement, attempt formal verification via strategy escalation:
 *   1. Sentinel — build proof from matched claim (zero LLM cost)
 *   2. Direct  — LLM writes ensures, empty body
 *   3. LLM-guided — LLM writes full proof
 *   4. Retry   — feed Dafny errors back
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

  // ── Strategy 1: Sentinel proofs (pred/fn candidates) + collect lemma hints ──

  const lemmaHints = [];

  for (const candidate of (candidates ?? [])) {
    const claim = claimsById.get(candidate.claimId);
    if (!claim) continue;

    const sentinel = buildSentinelCode(candidate, claim, signatures);

    // Lemma candidates become hints for the formalize step
    if (!sentinel && candidate.claimId.startsWith('lemma:')) {
      const hint = buildLemmaHintText(candidate, claim, signatures);
      if (hint) {
        console.error(`[prove] Lemma hint for "${requirement}": ${hint.lemmaName}`);
        lemmaHints.push(hint);
      }
      continue;
    }

    if (!sentinel) continue;

    console.error(`[prove] Sentinel for "${requirement}" via ${candidate.claimId}`);
    const result = await verify(sentinel.code, domainDfyPath, domainModule, opts);

    strategiesTried.push({
      strategy: 'sentinel',
      candidateClaimId: candidate.claimId,
      success: result.success,
      code: sentinel.code,
    });

    if (result.success) {
      console.error(`[prove] Sentinel verified`);
      return {
        requirement,
        status: 'proved',
        strategy: 'sentinel',
        candidateClaimId: candidate.claimId,
        lemmaName: sentinel.name,
        dafnyCode: sentinel.code,
        reasoning: `Proved via sentinel calling ${candidate.claimId}`,
        attempts: strategiesTried.length,
        strategiesTried,
      };
    }
  }

  // ── Strategy 2: Direct proof (LLM writes ensures, empty body) ──

  const hints = lemmaHints.length > 0 ? lemmaHints : undefined;
  console.error(`[prove] Direct proof for "${requirement}"${hints ? ` (with ${hints.length} lemma hint(s))` : ''}`);
  let attempt = await formalize(requirement, domainSource, allClaims, domain, hints, opts);
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

  // ── Strategy 3+4: LLM-guided with retries ──

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

async function formalize(requirement, domainSource, claimsIndex, domain, lemmaHints, opts) {
  const model = opts.model ?? 'claude-sonnet-4-5-20250929';
  const prompt = FORMALIZE_PROMPT(domain, requirement, domainSource, claimsIndex, lemmaHints);

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
