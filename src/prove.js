import { callWithTool } from './api.js';
import { FORMALIZE_TOOL, BATCH_FORMALIZE_TOOL } from './schemas.js';
import {
  BATCH_FORMALIZE_PROMPT,
  RESOLUTION_RETRY_PROMPT,
  PROOF_PROMPT,
  PROOF_RETRY_PROMPT,
} from './prompts.js';
import { verify, resolve } from './verify.js';
import { roundtripCheck, roundtripReformalize } from './roundtrip.js';

/**
 * Two-phase pipeline: separate formalization from proofs.
 *
 * Phase 1 (batch): LLM writes all lemma signatures → resolve → verify empty bodies
 * Phase 2 (individual): for lemmas that need proof, LLM writes proof body → verify
 *
 * @param {string[]} requirements - requirement texts
 * @param {string} domainSource - Dafny source for Phase 2 (full or erased based on --erase)
 * @param {string} erasedSource - Dafny source with lemma bodies erased (Phase 1)
 * @param {string} domainDfyPath - absolute path to .dfy file
 * @param {string} domainModule - Dafny module name
 * @param {string} domain - domain display name
 * @param {object} [opts] - { verbose, model }
 * @returns {Promise<object[]>} results per requirement
 */
export async function proveAll(requirements, domainSource, erasedSource, domainDfyPath, domainModule, domain, opts = {}) {
  const results = new Array(requirements.length).fill(null);

  // ═══════════════════════════════════════════
  // Phase 1: Batch formalize + resolve + verify
  // ═══════════════════════════════════════════

  console.error(`\n[phase1] Batch formalizing ${requirements.length} requirement(s)...`);

  // Step 1: LLM produces all signatures at once
  let lemmas = await batchFormalize(requirements, erasedSource, domain, opts);

  // Step 2: Index lemmas by requirement
  const indexed = indexLemmas(lemmas, requirements);

  // Step 3: Batch resolve (typecheck all signatures together)
  const allCode = indexed.map((l) => l.dafnyCode).join('\n\n');
  const batchResolve = await resolve(allCode, domainDfyPath, domainModule, opts);

  let resolved;
  if (batchResolve.success) {
    console.error(`[phase1] All ${indexed.length} signatures resolved`);
    resolved = indexed;
  } else {
    // Resolve individually to find broken ones
    console.error(`[phase1] Batch resolve failed — resolving individually...`);
    const { passed, failed } = await resolveIndividually(indexed, domainDfyPath, domainModule, opts);
    console.error(`[phase1] Resolved: ${passed.length} ok, ${failed.length} failed`);

    if (failed.length > 0) {
      // Retry broken ones
      console.error(`[phase1] Retrying ${failed.length} resolution failure(s)...`);
      const retried = await resolutionRetry(failed, requirements, erasedSource, domain, opts);

      // Re-resolve retried lemmas
      const { passed: retriedPassed, failed: retriedFailed } =
        await resolveIndividually(retried, domainDfyPath, domainModule, opts);

      console.error(`[phase1] After retry: ${retriedPassed.length} ok, ${retriedFailed.length} still failed`);

      // Still-broken → obligation
      for (const f of retriedFailed) {
        results[f.index] = {
          requirement: requirements[f.index],
          status: 'gap',
          lemmaName: f.lemmaName,
          dafnyCode: f.dafnyCode,
          reasoning: f.reasoning,
          error: f.resolveError,
          attempts: 2,
          strategiesTried: [
            { strategy: 'formalize', success: false, code: indexed[f.index]?.dafnyCode },
            { strategy: 'resolve-retry', success: false, code: f.dafnyCode },
          ],
        };
      }

      resolved = [...passed, ...retriedPassed];
    } else {
      resolved = passed;
    }
  }

  // Step 3.5: Round-trip check (informalize → compare → re-formalize on mismatch)
  if (!opts.skipRoundtrip && resolved.length > 0) {
    console.error(`\n[roundtrip] Running round-trip check on ${resolved.length} lemma(s)...`);

    const rtResult = await roundtripCheck(resolved, requirements, domain, opts);
    let rtPassed = rtResult.passed;
    let rtFailed = rtResult.failed;

    // One retry: re-formalize failed lemmas with discrepancy feedback
    if (rtFailed.length > 0) {
      console.error(`[roundtrip] Re-formalizing ${rtFailed.length} failed lemma(s)...`);

      const reformalized = await roundtripReformalize(rtFailed, requirements, erasedSource, domain, opts);

      // Re-resolve reformalized lemmas
      const { passed: reResPassed, failed: reResFailed } =
        await resolveIndividually(reformalized, domainDfyPath, domainModule, opts);

      console.error(`[roundtrip] After re-formalize: ${reResPassed.length} resolved, ${reResFailed.length} failed resolve`);

      // Re-run round-trip check on successfully resolved reformalized lemmas
      if (reResPassed.length > 0) {
        const rtResult2 = await roundtripCheck(reResPassed, requirements, domain, opts);
        rtPassed = [...rtPassed, ...rtResult2.passed];

        // Still failing round-trip → obligation
        for (const f of rtResult2.failed) {
          console.error(`[roundtrip] Req ${f.index} still fails round-trip — obligation`);
          results[f.index] = {
            requirement: requirements[f.index],
            status: 'gap',
            strategy: 'roundtrip-fail',
            lemmaName: f.lemmaName,
            dafnyCode: f.dafnyCode,
            reasoning: f.reasoning,
            error: `Round-trip mismatch: ${f.discrepancy}`,
            discrepancy: f.discrepancy,
            weakeningType: f.weakeningType,
            attempts: 2,
            strategiesTried: [
              { strategy: 'formalize', success: true, code: rtFailed.find(rf => rf.index === f.index)?.dafnyCode },
              { strategy: 'roundtrip-reformalize', success: false, code: f.dafnyCode },
            ],
          };
        }
      }

      // Lemmas that failed re-resolution → obligation
      for (const f of reResFailed) {
        console.error(`[roundtrip] Req ${f.index} failed re-resolution — obligation`);
        results[f.index] = {
          requirement: requirements[f.index],
          status: 'gap',
          strategy: 'roundtrip-fail',
          lemmaName: f.lemmaName,
          dafnyCode: f.dafnyCode,
          reasoning: f.reasoning,
          error: `Round-trip re-formalization failed resolve: ${f.resolveError}`,
          discrepancy: rtFailed.find(rf => rf.index === f.index)?.discrepancy,
          weakeningType: rtFailed.find(rf => rf.index === f.index)?.weakeningType,
          attempts: 2,
          strategiesTried: [
            { strategy: 'formalize', success: true, code: rtFailed.find(rf => rf.index === f.index)?.dafnyCode },
            { strategy: 'roundtrip-reformalize', success: false, code: f.dafnyCode },
          ],
        };
      }

      // Lemmas that didn't even get reformalized (LLM missed them) → obligation
      const reformalizedIndices = new Set(reformalized.map(r => r.index));
      for (const f of rtFailed) {
        if (!reformalizedIndices.has(f.index) && results[f.index] === null) {
          console.error(`[roundtrip] Req ${f.index} not re-formalized — obligation`);
          results[f.index] = {
            requirement: requirements[f.index],
            status: 'gap',
            strategy: 'roundtrip-fail',
            lemmaName: f.lemmaName,
            dafnyCode: f.dafnyCode,
            reasoning: f.reasoning,
            error: `Round-trip mismatch: ${f.discrepancy}`,
            discrepancy: f.discrepancy,
            weakeningType: f.weakeningType,
            attempts: 1,
            strategiesTried: [
              { strategy: 'formalize', success: true, code: f.dafnyCode },
            ],
          };
        }
      }
    }

    // Replace resolved with only round-trip-passed lemmas
    resolved = rtPassed;
    console.error(`[roundtrip] ${resolved.length} lemma(s) passed round-trip, proceeding to verify`);
  }

  // Step 4: Verify empty bodies (batch first, then individual on failure)
  if (resolved.length > 0) {
    const verifyCode = resolved.map((l) => l.dafnyCode).join('\n\n');
    const batchVerify = await verify(verifyCode, domainDfyPath, domainModule, opts);

    if (batchVerify.success) {
      console.error(`[phase1] All ${resolved.length} lemmas verified with empty body`);
      for (const l of resolved) {
        results[l.index] = {
          requirement: requirements[l.index],
          status: 'proved',
          strategy: 'direct',
          lemmaName: l.lemmaName,
          dafnyCode: l.dafnyCode,
          reasoning: l.reasoning,
          attempts: 1,
          strategiesTried: [{ strategy: 'direct', success: true, code: l.dafnyCode }],
        };
      }
    } else {
      // Verify individually
      console.error(`[phase1] Batch verify failed — verifying individually...`);
      for (const l of resolved) {
        const vResult = await verify(l.dafnyCode, domainDfyPath, domainModule, opts);
        if (vResult.success) {
          console.error(`[phase1] Req ${l.index} verified with empty body`);
          results[l.index] = {
            requirement: requirements[l.index],
            status: 'proved',
            strategy: 'direct',
            lemmaName: l.lemmaName,
            dafnyCode: l.dafnyCode,
            reasoning: l.reasoning,
            attempts: 1,
            strategiesTried: [{ strategy: 'direct', success: true, code: l.dafnyCode }],
          };
        } else {
          // Needs proof — will go to Phase 2
          l.verifyError = vResult.error;
        }
      }
    }
  }

  // ═══════════════════════════════════════════
  // Phase 2: Write proofs for remaining lemmas
  // ═══════════════════════════════════════════

  const needProof = resolved.filter((l) => results[l.index] === null);
  if (needProof.length > 0) {
    console.error(`\n[phase2] ${needProof.length} lemma(s) need proof...`);
  }

  for (const l of needProof) {
    const requirement = requirements[l.index];
    const strategiesTried = [
      { strategy: 'direct', success: false, code: l.dafnyCode },
    ];

    // Attempt 1: Write proof
    console.error(`[phase2] Writing proof for req ${l.index}: "${requirement}"`);
    let attempt = await writeProof(requirement, l.dafnyCode, l.verifyError, domainSource, domain, opts);
    let vResult = await verify(attempt.dafnyCode, domainDfyPath, domainModule, opts);

    strategiesTried.push({
      strategy: 'proof',
      success: vResult.success,
      code: attempt.dafnyCode,
    });

    if (vResult.success) {
      console.error(`[phase2] Req ${l.index} proved`);
      results[l.index] = {
        requirement,
        status: 'proved',
        strategy: 'proof',
        lemmaName: attempt.lemmaName,
        dafnyCode: attempt.dafnyCode,
        reasoning: attempt.reasoning,
        attempts: 2,
        strategiesTried,
      };
      continue;
    }

    // Attempt 2: Retry proof
    console.error(`[phase2] Retrying proof for req ${l.index}`);
    attempt = await retryProof(requirement, attempt.dafnyCode, vResult.error, domain, opts);
    vResult = await verify(attempt.dafnyCode, domainDfyPath, domainModule, opts);

    strategiesTried.push({
      strategy: 'proof-retry',
      success: vResult.success,
      code: attempt.dafnyCode,
    });

    if (vResult.success) {
      console.error(`[phase2] Req ${l.index} proved on retry`);
      results[l.index] = {
        requirement,
        status: 'proved',
        strategy: 'proof-retry',
        lemmaName: attempt.lemmaName,
        dafnyCode: attempt.dafnyCode,
        reasoning: attempt.reasoning,
        attempts: 3,
        strategiesTried,
      };
      continue;
    }

    // Obligation
    console.error(`[phase2] Req ${l.index} failed — obligation`);
    results[l.index] = {
      requirement,
      status: 'gap',
      lemmaName: attempt.lemmaName,
      dafnyCode: attempt.dafnyCode,
      reasoning: attempt.reasoning,
      error: vResult.error,
      attempts: 3,
      strategiesTried,
    };
  }

  // Fill any requirements the LLM missed entirely
  for (let i = 0; i < requirements.length; i++) {
    if (results[i] === null) {
      console.error(`[prove] Requirement ${i} was never processed — obligation`);
      results[i] = {
        requirement: requirements[i],
        status: 'gap',
        lemmaName: null,
        dafnyCode: null,
        reasoning: 'Requirement was not covered by batch formalization',
        error: 'No lemma produced for this requirement',
        attempts: 0,
        strategiesTried: [],
      };
    }
  }

  return results;
}

// ─── Phase 1 helpers ────────────────────────────────────────────────────────

async function batchFormalize(requirements, erasedSource, domain, opts) {
  const model = opts.model ?? 'claude-sonnet-4-5-20250929';
  const prompt = BATCH_FORMALIZE_PROMPT(domain, requirements, erasedSource);

  const response = await callWithTool({
    model,
    prompt,
    tool: BATCH_FORMALIZE_TOOL,
    toolChoice: { type: 'tool', name: 'record_formalizations' },
    verbose: opts.verbose,
    maxTokens: 8192,
  });

  return response.input.lemmas;
}

function indexLemmas(lemmas, requirements) {
  const indexed = [];

  for (const lemma of lemmas) {
    const idx = lemma.requirementIndex;
    if (idx >= 0 && idx < requirements.length) {
      indexed.push({
        index: idx,
        lemmaName: lemma.lemmaName,
        dafnyCode: lemma.dafnyCode,
        reasoning: lemma.reasoning,
      });
    }
  }

  // Fill gaps — if LLM missed a requirement, note it
  for (let i = 0; i < requirements.length; i++) {
    if (!indexed.find((l) => l.index === i)) {
      console.error(`[phase1] Warning: no lemma for requirement ${i}`);
    }
  }

  return indexed;
}

async function resolveIndividually(lemmas, domainDfyPath, domainModule, opts) {
  const passed = [];
  const failed = [];

  for (const l of lemmas) {
    const result = await resolve(l.dafnyCode, domainDfyPath, domainModule, opts);
    if (result.success) {
      passed.push(l);
    } else {
      failed.push({ ...l, resolveError: result.error });
    }
  }

  return { passed, failed };
}

async function resolutionRetry(failed, requirements, erasedSource, domain, opts) {
  const model = opts.model ?? 'claude-sonnet-4-5-20250929';
  const failures = failed.map((f) => ({
    index: f.index,
    requirement: requirements[f.index],
    dafnyCode: f.dafnyCode,
    error: f.resolveError,
  }));

  const prompt = RESOLUTION_RETRY_PROMPT(domain, failures, erasedSource);

  const response = await callWithTool({
    model,
    prompt,
    tool: BATCH_FORMALIZE_TOOL,
    toolChoice: { type: 'tool', name: 'record_formalizations' },
    verbose: opts.verbose,
    maxTokens: 8192,
  });

  // Map retried lemmas back, preserving original index
  return response.input.lemmas.map((lemma) => ({
    index: lemma.requirementIndex,
    lemmaName: lemma.lemmaName,
    dafnyCode: lemma.dafnyCode,
    reasoning: lemma.reasoning,
  }));
}

// ─── Phase 2 helpers ────────────────────────────────────────────────────────

async function writeProof(requirement, signature, verifyError, domainSource, domain, opts) {
  const model = opts.model ?? 'claude-sonnet-4-5-20250929';
  const prompt = PROOF_PROMPT(domain, requirement, signature, verifyError, domainSource);

  const response = await callWithTool({
    model,
    prompt,
    tool: FORMALIZE_TOOL,
    toolChoice: { type: 'tool', name: 'record_formalization' },
    verbose: opts.verbose,
  });

  return response.input;
}

async function retryProof(requirement, previousCode, dafnyError, domain, opts) {
  const model = opts.model ?? 'claude-sonnet-4-5-20250929';
  const prompt = PROOF_RETRY_PROMPT(domain, requirement, previousCode, dafnyError);

  const response = await callWithTool({
    model,
    prompt,
    tool: FORMALIZE_TOOL,
    toolChoice: { type: 'tool', name: 'record_formalization' },
    verbose: opts.verbose,
  });

  return response.input;
}
