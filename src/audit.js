import { extractLemma } from './extract.js';
import { verify } from './verify.js';
import { claimcheck } from './claimcheck.js';

/**
 * Audit a set of requirement→lemma mappings.
 *
 * Thin wrapper over claimcheck() that handles:
 * 1. Lemma extraction from .dfy source
 * 2. Optional Dafny verification
 * 3. Threading eval fields (expected) back into results
 *
 * @param {{ requirement: string, lemmaName: string, expected?: string }[]} mapping
 * @param {string} dfySource - full Dafny source
 * @param {string} domainDfyPath - absolute path to .dfy file (for dafny verify)
 * @param {string} [domainModule] - Dafny module name (only needed for --verify)
 * @param {string} domain - display name
 * @param {object} [opts] - { verbose, verify, informalizeModel, compareModel, singlePrompt, model }
 * @returns {Promise<object[]>} per-mapping results
 */
export async function audit(mapping, dfySource, domainDfyPath, domainModule, domain, opts = {}) {
  const log = opts.log ?? console.error;
  const earlyResults = [];

  // Step 1: Extract each lemma from source
  log(`[audit] Extracting ${mapping.length} lemma(s) from source...`);
  const claims = [];
  for (let i = 0; i < mapping.length; i++) {
    const entry = mapping[i];
    const code = extractLemma(dfySource, entry.lemmaName);
    if (!code) {
      earlyResults.push({
        index: i,
        requirement: entry.requirement,
        lemmaName: entry.lemmaName,
        expected: entry.expected ?? 'confirmed',
        status: 'error',
        error: `Lemma "${entry.lemmaName}" not found in source`,
      });
      continue;
    }
    claims.push({ index: i, requirement: entry.requirement, lemmaName: entry.lemmaName, dafnyCode: code });
  }

  log(`[audit] Extracted ${claims.length}/${mapping.length} lemma(s)`);

  // Step 2: Optionally verify each lemma with Dafny
  if (opts.verify && claims.length > 0) {
    log(`[audit] Verifying ${claims.length} lemma(s) with Dafny...`);
    for (const c of claims) {
      const result = await verify(c.dafnyCode, domainDfyPath, domainModule, opts);
      if (!result.success) {
        log(`[audit] Verification failed for ${c.lemmaName}: ${result.error?.slice(0, 200)}`);
        earlyResults.push({
          index: c.index,
          requirement: c.requirement,
          lemmaName: c.lemmaName,
          expected: mapping[c.index].expected ?? 'confirmed',
          status: 'verify-failed',
          error: result.error,
          dafnyCode: c.dafnyCode,
        });
        c.skip = true;
      }
    }
    const active = claims.filter(c => !c.skip);
    log(`[audit] ${active.length} lemma(s) verified successfully`);
  }

  const activeClaims = claims.filter(c => !c.skip);

  // Step 3: Core claimcheck (informalize + compare)
  let auditResults = [];
  if (activeClaims.length > 0) {
    const { results } = await claimcheck({
      claims: activeClaims,
      domain,
      options: { ...opts, log },
    });
    auditResults = results;
  }

  // Merge: add expected field back, combine with early results
  const allResults = [...earlyResults];
  for (const r of auditResults) {
    // Find original mapping index
    const claim = activeClaims.find(c => c.lemmaName === r.lemmaName);
    const idx = claim?.index ?? 0;
    allResults.push({
      ...r,
      index: idx,
      expected: mapping[idx].expected ?? 'confirmed',
    });
  }

  allResults.sort((a, b) => a.index - b.index);
  return allResults;
}
