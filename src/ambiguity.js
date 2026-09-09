/**
 * Ambiguity handling.
 *
 * The compare step now returns, per pair, every reasonable *reading* of the NL
 * requirement, each written as a Dafny contract (requires/ensures) over the
 * lemma's own parameters, plus the model's judgement of whether the lemma is
 * at least as strong as that reading ("covered").
 *
 * Optionally, discharge.js turns those judgements into proofs by asking Dafny
 * whether the lemma's contract entails each reading's contract. This module
 * merges the two sources of evidence and turns them into a status:
 *
 *   confirmed  - the lemma covers every reasonable reading
 *   disputed   - the lemma covers no reasonable reading (or the model found a
 *                discrepancy such as a tautology)
 *   ambiguous  - the lemma covers some readings but not others: the NL is
 *                ambiguous in a way that matters, and the lemma picked one side
 *
 * Proofs are one-directional: Dafny can prove that a reading IS covered, but a
 * failed proof only means "unknown", so a dispute is always a judgement.
 */

export const AMBIGUITY_POLICIES = ['flag', 'strict', 'lenient'];

/** Normalize the model's readings array (tolerates missing / malformed entries). */
export function normalizeReadings(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(r => r && typeof r === 'object' && typeof r.reading === 'string' && r.reading.trim())
    .map(r => ({
      reading: r.reading.trim(),
      requires: (typeof r.requires === 'string' && r.requires.trim()) || 'true',
      ensures: (typeof r.ensures === 'string' && r.ensures.trim()) || '',
      covered: !!r.covered,
    }));
}

/**
 * Decide a status from the model's judgement and (optionally) Dafny evidence.
 *
 * @param {{ match: boolean, nlAmbiguous?: boolean, readings?: any[], interpretation?: string }} judgement
 * @param {Array<{ status: 'covered'|'unknown'|'vacuous'|'trivial'|'error'|'skipped', error?: string }>|null} discharge
 *        one entry per reading (aligned by index), or null if discharge did not run
 * @returns {{ status: 'confirmed'|'disputed'|'ambiguous', nlAmbiguous: boolean,
 *             readings: object[], interpretation: string, evidence: 'proven'|'mixed'|'judged' }}
 */
export function decide(judgement, discharge = null) {
  const readings = normalizeReadings(judgement.readings).map((r, i) => {
    const d = discharge?.[i];
    if (!d || d.status === 'skipped') return { ...r, evidence: 'judged' };
    if (d.status === 'vacuous') return { ...r, evidence: 'vacuous', dafny: d };   // requires is unsatisfiable
    if (d.status === 'trivial') return { ...r, evidence: 'trivial', dafny: d };   // ensures follows from requires alone
    if (d.status === 'covered') return { ...r, covered: true, evidence: 'proven', dafny: d };
    return { ...r, evidence: 'judged', dafny: d };                                // unknown / error: judgement stands
  });

  // Vacuous or trivial readings cannot be evidence either way.
  const live = readings.filter(r => r.evidence === 'proven' || r.evidence === 'judged');
  const covered = live.filter(r => r.covered).length;
  const proven = live.filter(r => r.evidence === 'proven').length;

  let status;
  if (live.length > 0 && covered === live.length && proven > 0) {
    // At least one proof, and every reasonable reading is covered: proof-backed confirmation.
    // This deliberately overrides a model dispute (e.g. the model thought "stronger" was a mismatch).
    status = 'confirmed';
  } else if (live.length > 1 && covered > 0 && covered < live.length) {
    status = 'ambiguous';
  } else if (readings.length === 0 && judgement.nlAmbiguous) {
    // Model flagged ambiguity but enumerated nothing usable: trust the flag.
    status = 'ambiguous';
  } else {
    // No proof decides it: the model's overall verdict stands.
    status = judgement.match ? 'confirmed' : 'disputed';
  }

  const evidence = live.length > 0 && proven === live.length ? 'proven' : proven > 0 ? 'mixed' : 'judged';
  const interpretation = (typeof judgement.interpretation === 'string' && judgement.interpretation.trim())
    || (status === 'ambiguous' ? (live.find(r => r.covered)?.reading ?? '') : '');

  return { status, nlAmbiguous: status === 'ambiguous', readings, interpretation, evidence };
}

/** Collapse an ambiguous status according to the caller's policy. */
export function applyPolicy(status, policy = 'flag') {
  if (!AMBIGUITY_POLICIES.includes(policy)) {
    throw new Error(`Unknown ambiguity policy "${policy}" (expected ${AMBIGUITY_POLICIES.join(' | ')})`);
  }
  if (status !== 'ambiguous') return status;
  if (policy === 'strict') return 'disputed';
  if (policy === 'lenient') return 'confirmed';
  return 'ambiguous';
}

/** One-paragraph explanation of an ambiguous result, for the discrepancy field and reports. */
export function ambiguitySummary(decision) {
  const covered = decision.readings.filter(r => r.covered && (r.evidence === 'proven' || r.evidence === 'judged'));
  const uncovered = decision.readings.filter(r => !r.covered && r.evidence === 'judged');
  const q = s => `"${s}"`;
  const parts = [];
  parts.push(`Requirement is ambiguous: the lemma covers ${covered.map(r => q(r.reading)).join(', ') || '(none)'}`);
  parts.push(`but not ${uncovered.map(r => q(r.reading)).join(', ') || '(none)'}.`);
  if (decision.interpretation) parts.push(`The lemma formalizes: ${q(decision.interpretation)}.`);
  return parts.join(' ');
}
