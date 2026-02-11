/**
 * Flatten claims JSON into individual translatable items.
 * Filters to domain-specific modules (skips kernel duplicates).
 *
 * @param {object} claims - parsed claims JSON from dafny2js --claims
 * @param {string} [domainModule] - if provided, only include items from this module
 * @returns {object[]} flat list of { id, kind, formalText, context }
 */
export function flattenClaims(claims, domainModule) {
  const items = [];

  for (const pred of claims.predicates ?? []) {
    if (domainModule && pred.module !== domainModule) continue;
    if (!pred.body && !pred.conjuncts) continue;

    const conjuncts = pred.conjuncts ?? (pred.body ? [pred.body] : []);
    for (let i = 0; i < conjuncts.length; i++) {
      items.push({
        id: `pred:${pred.module}.${pred.name}:${i}`,
        kind: 'invariant-conjunct',
        formalText: conjuncts[i],
        context: {
          predicateName: pred.name,
          module: pred.module,
          fullBody: pred.body,
          line: pred.line,
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
