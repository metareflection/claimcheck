/**
 * Sentinel proof construction — build Dafny lemmas that formally confirm
 * NL-matched claims by testing invariant implication (predicate/function claims).
 *
 * Lemma claims are NOT handled as sentinels — they are passed as proof hints
 * to the formalize step instead. See buildLemmaHintText().
 */

const BUILTIN_TYPES = new Set([
  'int', 'nat', 'bool', 'real', 'char', 'string',
  'ORDINAL', 'object',
]);

/**
 * Extract lemma signatures from Dafny source code.
 *
 * @param {string} source - Dafny source code
 * @returns {Map<string, { params: string }>} lemmaName → { params }
 */
export function extractLemmaSignatures(source) {
  const signatures = new Map();
  const re = /\blemma\s+(\w+)\s*(\([^)]*\))/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    signatures.set(m[1], { params: m[2] });
  }
  return signatures;
}

/**
 * Build sentinel Dafny code for a matched claim.
 *
 * - Predicate claims: test that Inv(m) implies the conjunct (empty body)
 * - Function contract claims: assert the contract holds (empty body)
 * - Lemma claims: returns null (handled via hint-guided formalization)
 *
 * @param {object} candidate - { claimId, confidence, explanation }
 * @param {object} claim - full flattened claim item
 * @param {Map<string,{ params: string }>} signatures - from extractLemmaSignatures
 * @returns {{ name: string, code: string } | null}
 */
export function buildSentinelCode(candidate, claim, signatures) {
  const { claimId } = candidate;

  if (claimId.startsWith('lemma:')) {
    return null;
  }

  if (claimId.startsWith('pred:')) {
    return buildPredicateSentinel(claimId, claim);
  }

  if (claimId.startsWith('fn:')) {
    return buildFunctionSentinel(claimId, claim);
  }

  return null;
}

/**
 * Build a text description of a matched lemma for use as a proof hint
 * in the formalize prompt. No Dafny code generation — just context for the LLM.
 *
 * @param {object} candidate - { claimId, confidence, explanation }
 * @param {object} claim - full flattened claim item
 * @param {Map<string,{ params: string }>} signatures - from extractLemmaSignatures
 * @returns {{ lemmaName: string, hint: string } | null}
 */
export function buildLemmaHintText(candidate, claim, signatures) {
  const parsed = parseLemmaName(candidate.claimId);
  if (!parsed) return null;

  const sig = signatures.get(parsed.lemmaName);
  if (!sig) return null;

  const dParams = requalifyParams(sig.params);
  const ensures = claim.formalText;

  return {
    lemmaName: parsed.lemmaName,
    hint: `\`${parsed.lemmaName}${dParams}\` ensures \`D.${ensures}\``,
  };
}

// ── Predicate sentinel: test that Inv implies the conjunct ──────────────

function buildPredicateSentinel(claimId, claim) {
  const name = sanitizeName(`Sentinel_${claimId}`);

  const code = `lemma ${name}(m: D.Model)
  requires D.Inv(m)
  ensures ${claim.formalText}
{}`;

  return { name, code };
}

// ── Function contract sentinel: assert the contract holds ───────────────

function buildFunctionSentinel(claimId, claim) {
  const name = sanitizeName(`Sentinel_${claimId}`);

  const code = `lemma ${name}(m: D.Model)
  requires D.Inv(m)
  ensures ${claim.formalText}
{}`;

  return { name, code };
}

// ── Helpers ─────────────────────────────────────────────────────────────

function parseLemmaName(claimId) {
  // lemma:Module.Name:ensures:0 → { module, lemmaName }
  const match = claimId.match(/^lemma:(.+)\.(\w+):ensures:\d+$/);
  if (!match) return null;
  return { module: match[1], lemmaName: match[2] };
}

function requalifyParams(paramStr) {
  // "(m: Model, a: Action)" → "(m: D.Model, a: D.Action)"
  // Skip builtins and generic containers like seq<T>, set<T>, map<K,V>
  return paramStr.replace(/:\s*(\w+)/g, (full, typeName) => {
    if (BUILTIN_TYPES.has(typeName)) return full;
    return `: D.${typeName}`;
  });
}

function extractArgNames(paramStr) {
  // "(m: Model, a: Action)" → "m, a"
  const inner = paramStr.slice(1, -1);
  if (!inner.trim()) return '';
  return inner.split(',').map((p) => p.split(':')[0].trim()).join(', ');
}

function sanitizeName(s) {
  // Turn claim IDs like "pred:Mod.Inv:0" into valid Dafny identifiers
  return s.replace(/[:.]/g, '_');
}
