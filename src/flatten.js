/**
 * Detect if a conjunct is a simple predicate call like "Alias.Name(args)".
 * Returns the predicate name or null.
 */
const PRED_CALL_RE = /^([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\.([A-Za-z_]\w*)\(.*\)$/;

function parsePredicateCall(text) {
  const m = PRED_CALL_RE.exec(text.trim());
  return m ? { alias: m[1], name: m[2] } : null;
}

/**
 * Resolve wrapper predicates that delegate to another module's predicate.
 * e.g. ColorWheelDomain.Inv has conjunct "CWSpec.Inv(m)" — resolve to
 * ColorWheelSpec.Inv's actual conjuncts.
 *
 * Returns the resolved conjuncts and the source predicate they came from,
 * or the original conjuncts if no resolution is needed.
 */
function resolveConjuncts(conjuncts, pred, allPredicates) {
  // Only resolve single-conjunct wrappers that are pure predicate calls
  if (conjuncts.length !== 1) return { conjuncts, source: pred };
  const call = parsePredicateCall(conjuncts[0]);
  if (!call) return { conjuncts, source: pred };

  // Find the target predicate by name — pick the one with real conjuncts
  // (not another wrapper, and not in the same module)
  const candidates = allPredicates.filter(p =>
    p.name === call.name &&
    p.module !== pred.module &&
    p.conjuncts &&
    p.conjuncts.length > 0,
  );

  // Among candidates, prefer one whose conjuncts aren't themselves wrapper calls
  const resolved = candidates.find(p =>
    p.conjuncts.length > 1 || !parsePredicateCall(p.conjuncts[0]),
  );

  if (resolved) {
    return { conjuncts: resolved.conjuncts, source: resolved };
  }

  return { conjuncts, source: pred };
}

/**
 * Flatten claims JSON into individual translatable items.
 * Filters to domain-specific modules (skips kernel duplicates).
 * Resolves wrapper predicates that delegate to spec-module predicates.
 *
 * @param {object} claims - parsed claims JSON from dafny2js --claims
 * @param {string} [domainModule] - if provided, only include items from this module
 * @returns {object[]} flat list of { id, kind, formalText, context }
 */
export function flattenClaims(claims, domainModule) {
  const items = [];
  const allPredicates = claims.predicates ?? [];

  for (const pred of allPredicates) {
    if (domainModule && pred.module !== domainModule) continue;
    if (!pred.body && !pred.conjuncts) continue;

    const rawConjuncts = pred.conjuncts ?? (pred.body ? [pred.body] : []);
    const { conjuncts, source } = resolveConjuncts(rawConjuncts, pred, allPredicates);

    for (let i = 0; i < conjuncts.length; i++) {
      items.push({
        id: `pred:${source.module}.${source.name}:${i}`,
        kind: 'invariant-conjunct',
        formalText: conjuncts[i],
        context: {
          predicateName: source.name,
          module: source.module,
          fullBody: source.body,
          line: source.line,
          resolvedFrom: source.module !== pred.module
            ? { module: pred.module, name: pred.name }
            : undefined,
        },
      });
    }
  }

  for (const lemma of claims.lemmas ?? []) {
    if (domainModule && lemma.module !== domainModule) continue;

    const seen = new Set();
    for (let i = 0; i < lemma.ensures.length; i++) {
      if (seen.has(lemma.ensures[i])) continue;
      seen.add(lemma.ensures[i]);
      items.push({
        id: `lemma:${lemma.module}.${lemma.name}:ensures:${i}`,
        kind: 'lemma-ensures',
        formalText: lemma.ensures[i],
        context: {
          lemmaName: lemma.name,
          module: lemma.module,
          requires: lemma.requires,
          allEnsures: lemma.ensures,
          line: lemma.line,
        },
      });
    }
  }

  for (const fn of claims.functions ?? []) {
    if (domainModule && fn.module !== domainModule) continue;

    for (let i = 0; i < fn.requires.length; i++) {
      items.push({
        id: `fn:${fn.module}.${fn.name}:requires:${i}`,
        kind: 'function-precondition',
        formalText: fn.requires[i],
        context: {
          functionName: fn.name,
          module: fn.module,
          line: fn.line,
        },
      });
    }
    for (let i = 0; i < fn.ensures.length; i++) {
      items.push({
        id: `fn:${fn.module}.${fn.name}:ensures:${i}`,
        kind: 'function-postcondition',
        formalText: fn.ensures[i],
        context: {
          functionName: fn.name,
          module: fn.module,
          line: fn.line,
        },
      });
    }
  }

  for (let i = 0; i < (claims.axioms ?? []).length; i++) {
    const a = claims.axioms[i];
    if (domainModule && a.module !== domainModule) continue;
    items.push({
      id: `axiom:${a.module}:${i}`,
      kind: 'axiom',
      formalText: a.content,
      context: {
        module: a.module,
        file: a.file,
        line: a.line,
      },
    });
  }

  return items;
}
