/**
 * Claim hints — build text descriptions of matched claims for the formalize prompt.
 *
 * All matched claims (predicate conjuncts, lemma postconditions, function contracts)
 * are passed as hints to the LLM. The LLM writes `ensures P(m)` from the requirement
 * and uses the hints for context. Dafny checks whether P(m) actually follows.
 *
 * No Dafny code is generated here — just context for the LLM.
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
 * Build a text hint from a matched claim for use in the formalize prompt.
 *
 * @param {object} candidate - { claimId, confidence, explanation }
 * @param {object} claim - full flattened claim item
 * @param {Map<string,{ params: string }>} signatures - from extractLemmaSignatures
 * @returns {{ kind: string, hint: string } | null}
 */
export function buildHintText(candidate, claim, signatures) {
  const { claimId } = candidate;

  if (claimId.startsWith('lemma:')) {
    return buildLemmaHint(claimId, claim, signatures);
  }

  if (claimId.startsWith('pred:')) {
    return buildPredicateHint(claimId, claim);
  }

  if (claimId.startsWith('fn:')) {
    return buildFunctionHint(claimId, claim);
  }

  return null;
}

// ── Predicate hint: invariant conjunct ──────────────────────────────────

function buildPredicateHint(claimId, claim) {
  return {
    kind: 'invariant conjunct',
    hint: `Invariant conjunct: \`${claim.formalText}\``,
  };
}

// ── Function contract hint ──────────────────────────────────────────────

function buildFunctionHint(claimId, claim) {
  const fnName = claimId.replace(/^fn:/, '').replace(/:(requires|ensures):\d+$/, '');
  return {
    kind: 'function contract',
    hint: `Function contract (\`${fnName}\`): \`${claim.formalText}\``,
  };
}

// ── Lemma hint: signature + ensures ─────────────────────────────────────

function buildLemmaHint(claimId, claim, signatures) {
  const parsed = parseLemmaName(claimId);
  if (!parsed) return null;

  const sig = signatures.get(parsed.lemmaName);
  if (!sig) return null;

  const dParams = requalifyParams(sig.params);

  return {
    kind: 'proved lemma',
    hint: `Proved lemma: \`${parsed.lemmaName}${dParams}\` ensures \`D.${claim.formalText}\``,
  };
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
