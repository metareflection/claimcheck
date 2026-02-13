import { extractLemma } from './extract.js';
import { verify } from './verify.js';
import { roundtripCheck } from './roundtrip.js';

/**
 * Audit a set of requirement→lemma mappings.
 *
 * For each mapping entry:
 * 1. Extract lemma from .dfy source by name
 * 2. Optionally: dafny verify the lemma (confirm it's actually proved)
 * 3. Batch informalize all lemmas (haiku, 1 LLM call) — does NOT see requirements
 * 4. Batch compare back-translations against requirements (sonnet, 1 LLM call)
 * 5. Return: which mappings are trustworthy, which have discrepancies
 *
 * @param {{ requirement: string, lemmaName: string }[]} mapping
 * @param {string} dfySource - full Dafny source
 * @param {string} domainDfyPath - absolute path to .dfy file (for dafny verify)
 * @param {string} domainModule - Dafny module name
 * @param {string} domain - display name
 * @param {object} [opts] - { verbose, verify, informalizeModel, compareModel }
 * @returns {Promise<object[]>} per-mapping results
 */
export async function audit(mapping, dfySource, domainDfyPath, domainModule, domain, opts = {}) {
  const results = [];

  // Step 1: Extract each lemma from source
  console.error(`[audit] Extracting ${mapping.length} lemma(s) from source...`);
  const lemmas = [];
  for (let i = 0; i < mapping.length; i++) {
    const entry = mapping[i];
    const code = extractLemma(dfySource, entry.lemmaName);
    if (!code) {
      results.push({
        index: i,
        requirement: entry.requirement,
        lemmaName: entry.lemmaName,
        status: 'error',
        error: `Lemma "${entry.lemmaName}" not found in source`,
      });
      continue;
    }
    lemmas.push({ index: i, lemmaName: entry.lemmaName, dafnyCode: code });
  }

  console.error(`[audit] Extracted ${lemmas.length}/${mapping.length} lemma(s)`);

  // Step 2: Optionally verify each lemma with Dafny
  if (opts.verify && lemmas.length > 0) {
    console.error(`[audit] Verifying ${lemmas.length} lemma(s) with Dafny...`);
    for (const l of lemmas) {
      const result = await verify(l.dafnyCode, domainDfyPath, domainModule, opts);
      if (!result.success) {
        console.error(`[audit] Verification failed for ${l.lemmaName}: ${result.error?.slice(0, 200)}`);
        results.push({
          index: l.index,
          requirement: mapping[l.index].requirement,
          lemmaName: l.lemmaName,
          status: 'verify-failed',
          error: result.error,
          dafnyCode: l.dafnyCode,
        });
        // Remove from lemmas to skip roundtrip
        l.skip = true;
      }
    }
    const activeLemmas = lemmas.filter(l => !l.skip);
    console.error(`[audit] ${activeLemmas.length} lemma(s) verified successfully`);
  }

  const activeLemmas = lemmas.filter(l => !l.skip);

  // Step 3+4: Round-trip check (informalize + compare)
  if (activeLemmas.length > 0) {
    const requirements = mapping.map(m => m.requirement);
    const { passed, failed } = await roundtripCheck(activeLemmas, requirements, domain, opts);

    for (const p of passed) {
      results.push({
        index: p.index,
        requirement: mapping[p.index].requirement,
        lemmaName: p.lemmaName,
        status: 'confirmed',
        dafnyCode: p.dafnyCode,
        informalization: p.informalization,
        comparison: p.comparison,
      });
    }

    for (const f of failed) {
      results.push({
        index: f.index,
        requirement: mapping[f.index].requirement,
        lemmaName: f.lemmaName,
        status: 'disputed',
        dafnyCode: f.dafnyCode,
        informalization: f.informalization,
        comparison: f.comparison,
        discrepancy: f.discrepancy,
        weakeningType: f.weakeningType,
      });
    }
  }

  // Sort results by original mapping index
  results.sort((a, b) => a.index - b.index);

  return results;
}
