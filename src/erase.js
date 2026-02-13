/**
 * Erase lemma bodies from Dafny source, marking them as {:axiom}.
 *
 * Produces a cleaner view of the domain for the LLM:
 * all types, functions, predicates preserved; lemma proofs stripped.
 */

/**
 * Find the matching closing brace, handling nested braces, strings, and comments.
 * @param {string} src
 * @param {number} start - position of opening '{'
 * @returns {number} position of matching '}', or -1
 */
function findMatchingBrace(src, start) {
  let depth = 0;
  let i = start;
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;

  while (i < src.length) {
    const c = src[i];

    if (inLineComment) {
      if (c === '\n') inLineComment = false;
      i++;
      continue;
    }
    if (inBlockComment) {
      if (src[i] === '*' && src[i + 1] === '/') { inBlockComment = false; i += 2; continue; }
      i++;
      continue;
    }
    if (!inString && src[i] === '/' && src[i + 1] === '/') { inLineComment = true; i += 2; continue; }
    if (!inString && src[i] === '/' && src[i + 1] === '*') { inBlockComment = true; i += 2; continue; }

    if (c === '"' && !inLineComment && !inBlockComment) { inString = !inString; i++; continue; }
    if (inString) { if (c === '\\') i++; i++; continue; }

    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return i; }
    i++;
  }
  return -1;
}

/**
 * Erase all lemma bodies in Dafny source, adding {:axiom} attribute.
 *
 * Transforms:
 *   lemma Foo(...)
 *     requires ...
 *     ensures ...
 *   { ... proof ... }
 *
 * Into:
 *   lemma {:axiom} Foo(...)
 *     requires ...
 *     ensures ...
 *   { }
 *
 * @param {string} src - Dafny source code
 * @returns {string} source with lemma bodies erased
 */
export function eraseLemmaBodies(src) {
  // Find all lemma declarations: "lemma", "twostate lemma", "ghost lemma"
  const lemmaPattern = /\b((?:twostate\s+)?(?:ghost\s+)?lemma)\b/g;
  const replacements = []; // { bodyStart, bodyEnd, kwStart, kwEnd }

  let match;
  while ((match = lemmaPattern.exec(src)) !== null) {
    const kwStart = match.index;
    const kwEnd = match.index + match[0].length;

    // Skip if already has {:axiom}
    const afterKw = src.slice(kwEnd, kwEnd + 30);
    if (/^\s*\{:axiom\}/.test(afterKw)) continue;

    // Scan forward from keyword end to find body opening brace
    let j = kwEnd;
    let bodyStart = -1;

    while (j < src.length) {
      const c = src[j];

      // Skip whitespace
      if (' \t\n\r'.includes(c)) { j++; continue; }

      // Skip line comments
      if (src[j] === '/' && src[j + 1] === '/') {
        const nl = src.indexOf('\n', j);
        j = nl === -1 ? src.length : nl + 1;
        continue;
      }

      // Skip block comments
      if (src[j] === '/' && src[j + 1] === '*') {
        const end = src.indexOf('*/', j);
        j = end === -1 ? src.length : end + 2;
        continue;
      }

      if (c === '{') {
        // Attribute block {:...} — skip it
        if (src[j + 1] === ':') {
          const braceEnd = findMatchingBrace(src, j);
          j = braceEnd === -1 ? src.length : braceEnd + 1;
          continue;
        }
        bodyStart = j;
        break;
      }

      // Semicolon means no body (abstract lemma)
      if (c === ';') break;

      // New declaration keyword means we overshot
      const wordMatch = src.slice(j).match(/^[a-zA-Z_]\w*/);
      if (wordMatch) {
        const word = wordMatch[0];
        const newDecl = ['lemma', 'function', 'method', 'predicate', 'datatype',
          'module', 'import', 'class', 'trait', 'const', 'type'];
        if (newDecl.includes(word) && j > kwEnd + 2) break;
        j += word.length;
        continue;
      }

      j++;
    }

    if (bodyStart === -1) continue;

    const bodyEnd = findMatchingBrace(src, bodyStart);
    if (bodyEnd === -1) continue;

    replacements.push({ kwEnd, bodyStart, bodyEnd });
  }

  // Apply replacements in reverse order to preserve positions
  let result = src;
  for (let i = replacements.length - 1; i >= 0; i--) {
    const { kwEnd, bodyStart, bodyEnd } = replacements[i];

    // Find indentation of the body line
    const lineStart = result.lastIndexOf('\n', bodyStart);
    const linePrefix = lineStart === -1 ? '' : result.slice(lineStart + 1, bodyStart);
    const indent = linePrefix.match(/^(\s*)/)?.[1] ?? '';

    // Replace body with empty
    result = result.slice(0, bodyStart) + '{\n' + indent + '}' + result.slice(bodyEnd + 1);

    // Insert {:axiom} after 'lemma' keyword
    result = result.slice(0, kwEnd) + ' {:axiom}' + result.slice(kwEnd);
  }

  return result;
}
