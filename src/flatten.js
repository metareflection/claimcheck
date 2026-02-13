/**
 * Mechanical claim extraction for the bottom-up pipeline.
 *
 * Splits Dafny invariant conjuncts, lemma ensures, function contracts,
 * and axioms into flat items with structured IDs. Pure data transform — no LLM.
 *
 * @param {string} claims - Dafny source text containing claims
 * @param {string} [domainModule] - module name for ID prefixing
 * @returns {{ id: string, kind: string, formalText: string, context: string }[]}
 */
export function flattenClaims(claims, domainModule) {
  const prefix = domainModule ? `${domainModule}.` : '';
  const items = [];

  // Extract lemma ensures clauses
  const lemmaPattern = /lemma\s+(?:\{[^}]*\}\s+)?(\w+)\s*\(([^)]*)\)([\s\S]*?)(?=\n(?:lemma|function|predicate|method|datatype|module|class)\s|\n}\s*$|$)/g;
  let match;

  while ((match = lemmaPattern.exec(claims)) !== null) {
    const lemmaName = match[1];
    const params = match[2].trim();
    const body = match[3];

    // Extract requires clauses for context
    const requires = [];
    const reqPattern = /requires\s+(.+)/g;
    let reqMatch;
    while ((reqMatch = reqPattern.exec(body)) !== null) {
      requires.push(reqMatch[1].trim());
    }

    // Extract ensures clauses — split conjuncts
    const ensPattern = /ensures\s+(.+)/g;
    let ensMatch;
    let ensIdx = 0;
    while ((ensMatch = ensPattern.exec(body)) !== null) {
      const ensText = ensMatch[1].trim();

      // Split top-level && conjuncts (simple heuristic: split on && not inside parens)
      const conjuncts = splitConjuncts(ensText);

      for (const conjunct of conjuncts) {
        const id = `${prefix}${lemmaName}.ensures.${ensIdx}`;
        items.push({
          id,
          kind: 'lemma-ensures',
          formalText: conjunct,
          context: requires.length > 0
            ? `Lemma ${lemmaName}(${params}) requires ${requires.join(' && ')}`
            : `Lemma ${lemmaName}(${params})`,
        });
        ensIdx++;
      }
    }
  }

  // Extract predicate/function contracts
  const funcPattern = /(?:predicate|function)\s+(?:\{[^}]*\}\s+)?(\w+)\s*\(([^)]*)\)(?:\s*:\s*\w+)?([\s\S]*?)(?=\n(?:lemma|function|predicate|method|datatype|module|class)\s|\n}\s*$|$)/g;

  while ((match = funcPattern.exec(claims)) !== null) {
    const funcName = match[1];
    const params = match[2].trim();
    const body = match[3];

    // Extract ensures clauses
    const ensPattern = /ensures\s+(.+)/g;
    let ensMatch;
    let ensIdx = 0;
    while ((ensMatch = ensPattern.exec(body)) !== null) {
      const ensText = ensMatch[1].trim();
      const conjuncts = splitConjuncts(ensText);

      for (const conjunct of conjuncts) {
        const id = `${prefix}${funcName}.ensures.${ensIdx}`;
        items.push({
          id,
          kind: 'function-ensures',
          formalText: conjunct,
          context: `Function/predicate ${funcName}(${params})`,
        });
        ensIdx++;
      }
    }
  }

  // Extract invariant conjuncts (predicate Inv or similar)
  const invPattern = /predicate\s+(?:\{[^}]*\}\s+)?Inv\s*\(([^)]*)\)\s*\{([\s\S]*?)\n\}/g;

  while ((match = invPattern.exec(claims)) !== null) {
    const params = match[1].trim();
    const invBody = match[2].trim();

    // Split top-level conjuncts in the invariant body
    const conjuncts = splitConjuncts(invBody);

    for (let i = 0; i < conjuncts.length; i++) {
      const conjunct = conjuncts[i].trim();
      if (conjunct.length === 0) continue;

      const id = `${prefix}Inv.conjunct.${i}`;
      items.push({
        id,
        kind: 'invariant-conjunct',
        formalText: conjunct,
        context: `Invariant Inv(${params})`,
      });
    }
  }

  // Extract axioms ({:axiom} lemmas)
  const axiomPattern = /lemma\s+\{:axiom\}\s+(\w+)\s*\(([^)]*)\)([\s\S]*?)(?=\n(?:lemma|function|predicate|method|datatype|module|class)\s|\n}\s*$|$)/g;

  while ((match = axiomPattern.exec(claims)) !== null) {
    const axiomName = match[1];
    const params = match[2].trim();
    const body = match[3];

    const ensPattern = /ensures\s+(.+)/g;
    let ensMatch;
    let ensIdx = 0;
    while ((ensMatch = ensPattern.exec(body)) !== null) {
      const id = `${prefix}${axiomName}.axiom.${ensIdx}`;
      items.push({
        id,
        kind: 'axiom',
        formalText: ensMatch[1].trim(),
        context: `Axiom ${axiomName}(${params})`,
      });
      ensIdx++;
    }
  }

  return items;
}

/**
 * Split a Dafny expression on top-level && operators.
 * Respects parentheses nesting — does not split inside parens.
 */
function splitConjuncts(text) {
  const result = [];
  let depth = 0;
  let current = '';

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (ch === '(' || ch === '[') {
      depth++;
      current += ch;
    } else if (ch === ')' || ch === ']') {
      depth--;
      current += ch;
    } else if (depth === 0 && text.slice(i, i + 2) === '&&') {
      result.push(current.trim());
      current = '';
      i++; // skip second &
    } else {
      current += ch;
    }
  }

  const last = current.trim();
  if (last.length > 0) result.push(last);

  return result;
}
