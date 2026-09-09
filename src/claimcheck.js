import { resetTokenUsage, getTokenUsage } from './api.js';
import { roundtripCheck, singlePromptCheck, naiveCheck } from './roundtrip.js';
import { decide, applyPolicy, ambiguitySummary } from './ambiguity.js';

/**
 * Pure JSON-in/JSON-out claimcheck audit.
 *
 * Takes pre-extracted claims (requirement + lemmaName + dafnyCode) and returns
 * audit results. No file I/O, no eval fields, no logging side effects.
 *
 * Ambiguity: the compare step returns every reasonable reading of each
 * requirement. A lemma that covers some readings but not others gets status
 * `ambiguous` (see ambiguity.js). `options.ambiguity` collapses that for
 * callers who need a binary answer:
 *   'flag'    (default) keep `ambiguous` as its own status
 *   'strict'  ambiguous counts as disputed
 *   'lenient' ambiguous counts as confirmed
 *
 * Discharge: if `options.discharge` is a function `(claim, readings) =>
 * Promise<results[]>` (see discharge.js / makeDischarger), each reading is
 * checked with Dafny and proofs override judgements. The CLI wires this up
 * from the claims file; stdin callers can pass their own.
 *
 * @param {{ claims: Array<{requirement: string, lemmaName: string, dafnyCode: string}>,
 *           domain: string,
 *           options?: {singlePrompt?: boolean, naive?: boolean, informalizeModel?: string, compareModel?: string,
 *                      model?: string, verbose?: boolean, log?: Function,
 *                      ambiguity?: 'flag'|'strict'|'lenient', discharge?: Function, dischargeConcurrency?: number} }}
 * @returns {Promise<{ results: object[], tokenUsage: {input: number, output: number} }>}
 */
export async function claimcheck({ claims, domain, options = {} }) {
  resetTokenUsage();

  const policy = options.ambiguity ?? 'flag';
  applyPolicy('ambiguous', policy); // validate early

  const errors = [];
  const valid = [];

  for (let i = 0; i < claims.length; i++) {
    const c = claims[i];
    if (!c.dafnyCode) {
      errors.push({
        requirement: c.requirement,
        lemmaName: c.lemmaName,
        status: 'error',
        error: 'Empty or missing dafnyCode',
      });
    } else {
      valid.push({ index: i, lemmaName: c.lemmaName, dafnyCode: c.dafnyCode });
    }
  }

  const requirements = claims.map(c => c.requirement);
  const check = options.naive ? naiveCheck : options.singlePrompt ? singlePromptCheck : roundtripCheck;
  const { passed, failed, ambiguous = [] } = await check(valid, requirements, domain, options);

  let entries = [...passed, ...failed, ...ambiguous];
  if (typeof options.discharge === 'function') {
    entries = await dischargeAll(entries, options);
  }

  const results = entries.map(e => toResult(e, claims, policy));
  results.push(...errors);

  // Sort by original claim order
  const nameToIndex = new Map(claims.map((c, i) => [c.lemmaName, i]));
  results.sort((a, b) => (nameToIndex.get(a.lemmaName) ?? 0) - (nameToIndex.get(b.lemmaName) ?? 0));

  return { results, tokenUsage: getTokenUsage() };
}

/** Run Dafny discharge on every entry that has readings and re-decide with the evidence. */
async function dischargeAll(entries, options) {
  const log = options.log ?? (() => {});
  const limit = Math.max(1, options.dischargeConcurrency ?? 2);
  const out = new Array(entries.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, entries.length) }, async () => {
    while (next < entries.length) {
      const i = next++;
      const e = entries[i];
      const readings = e.decision.readings;
      if (readings.length === 0) { out[i] = e; continue; }
      log(`[discharge] ${e.lemmaName}: checking ${readings.length} reading(s) with Dafny...`);
      let evidence;
      try {
        evidence = await options.discharge(e, readings);
      } catch (err) {
        evidence = readings.map(() => ({ status: 'error', probes: {}, error: err.message }));
      }
      const decision = decide(e.judgement, evidence);
      log(`[discharge] ${e.lemmaName}: ${evidence.map(d => d.status).join(', ')} → ${decision.status}`
        + (decision.status !== e.decision.status ? ` (was ${e.decision.status})` : ''));
      out[i] = { ...e, decision, dischargeEvidence: evidence };
    }
  }));
  return out;
}

function toResult(e, claims, policy) {
  const d = e.decision;
  const base = {
    requirement: claims[e.index].requirement,
    lemmaName: e.lemmaName,
    status: applyPolicy(d.status, policy),
    dafnyCode: e.dafnyCode,
    informalization: e.informalization,
    comparison: e.comparison,
    ...(d.readings.length ? { readings: d.readings, evidence: d.evidence } : {}),
    ...(d.nlAmbiguous ? { nlAmbiguous: true, interpretation: d.interpretation } : {}),
  };
  if (d.status === 'ambiguous') {
    return { ...base, discrepancy: ambiguitySummary(d), weakeningType: 'ambiguous-requirement' };
  }
  if (d.status === 'disputed') {
    return { ...base, discrepancy: e.discrepancy, weakeningType: e.weakeningType };
  }
  return base;
}
