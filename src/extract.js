import { findMatchingBrace } from './erase.js';

/**
 * Extract a single lemma (signature + body) from Dafny source by name.
 *
 * Strategy for finding the body brace:
 * After the lemma name + params, we enter clause territory (requires, ensures,
 * decreases, modifies). Each clause continues until the next clause keyword or
 * a '{' that starts at the beginning of a line (modulo whitespace). Set
 * comprehensions inside clauses always appear mid-expression, never line-initial
 * after a clause block.
 *
 * @param {string} dfySource - full Dafny source
 * @param {string} lemmaName - name of the lemma to extract
 * @returns {string|null} the full lemma text, or null if not found
 */
export function extractLemma(dfySource, lemmaName) {
  const stripped = stripComments(dfySource);
  // Match "lemma" (with optional twostate/ghost prefix) followed by the name
  const pattern = new RegExp(
    `\\b((?:twostate\\s+)?(?:ghost\\s+)?lemma)\\s+(?:\\{:[^}]*\\}\\s*)*${escapeRegex(lemmaName)}\\b`,
    'g',
  );
  // Find the match in comment-stripped source, use position to extract from original
  let match;
  while ((match = pattern.exec(stripped)) !== null) {
    const declStart = match.index;
    const afterKeyword = match.index + match[0].length;
    const bodyStart = findBodyBrace(dfySource, afterKeyword);
    if (bodyStart === -1) continue;

    const bodyEnd = findMatchingBrace(dfySource, bodyStart);
    if (bodyEnd === -1) continue;

    return dfySource.slice(declStart, bodyEnd + 1).trim();
  }
  return null;
}

/**
 * Find the body opening brace of a lemma, skipping braces inside clause expressions.
 *
 * After the lemma name + params, we're in clause territory. Clause keywords are:
 * requires, ensures, decreases, modifies, invariant, reads.
 * The body '{' is the one that appears at the start of a line (only preceded by whitespace),
 * after all clauses. Braces inside clause expressions (set comprehensions, lambdas)
 * appear mid-line, never line-initial after a clause block.
 *
 * @param {string} src
 * @param {number} start - position after lemma name
 * @returns {number} position of body opening brace, or -1
 */
function findBodyBrace(src, start) {
  let i = start;
  // Track parenthesis/bracket depth to skip over parameter lists
  let parenDepth = 0;

  while (i < src.length) {
    const c = src[i];

    // Skip line comments
    if (src[i] === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i);
      i = nl === -1 ? src.length : nl + 1;
      continue;
    }

    // Skip block comments
    if (src[i] === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i);
      i = end === -1 ? src.length : end + 2;
      continue;
    }

    // Track parens and brackets (for parameter lists, type params, etc.)
    if (c === '(' || c === '[') { parenDepth++; i++; continue; }
    if (c === ')' || c === ']') { parenDepth--; i++; continue; }

    // Inside parens — skip everything
    if (parenDepth > 0) { i++; continue; }

    if (c === '{') {
      // Attribute block {:...} — skip it
      if (src[i + 1] === ':') {
        const braceEnd = findMatchingBrace(src, i);
        i = braceEnd === -1 ? src.length : braceEnd + 1;
        continue;
      }

      // Check if this brace is line-initial (only whitespace before it on the line)
      // OR if we're not inside any clause expression
      const lineStart = src.lastIndexOf('\n', i - 1);
      const prefix = src.slice(lineStart + 1, i);
      if (/^\s*$/.test(prefix)) {
        return i;
      }

      // Also accept: brace immediately after a clause line that ends with newline
      // This handles cases where { is on the same line after ensures/requires
      // but there's nothing else — treat it as body brace if no clause keyword precedes on this line
      const trimmedPrefix = prefix.trim();
      const clauseKeywords = ['requires', 'ensures', 'decreases', 'modifies', 'invariant', 'reads'];
      const isClauseContent = clauseKeywords.some(kw => trimmedPrefix.startsWith(kw));
      if (!isClauseContent && trimmedPrefix === '') {
        return i;
      }

      // This brace is mid-expression (set comprehension, etc.) — skip it
      const braceEnd = findMatchingBrace(src, i);
      i = braceEnd === -1 ? src.length : braceEnd + 1;
      continue;
    }

    // New declaration keyword means we overshot
    const wordMatch = src.slice(i).match(/^[a-zA-Z_]\w*/);
    if (wordMatch) {
      const word = wordMatch[0];
      const newDecl = ['lemma', 'function', 'method', 'predicate', 'datatype',
        'module', 'import', 'class', 'trait', 'const', 'type'];
      if (newDecl.includes(word) && i > start + 2) {
        // Check it's not a clause keyword
        const clauseKeywords = ['requires', 'ensures', 'decreases', 'modifies', 'invariant', 'reads',
          'returns', 'var', 'if', 'else', 'while', 'for', 'match', 'case', 'assert', 'calc',
          'forall', 'exists', 'old', 'fresh', 'true', 'false', 'null', 'this', 'set', 'map',
          'seq', 'multiset', 'iset', 'imap', 'string', 'int', 'real', 'bool', 'nat', 'char'];
        if (!clauseKeywords.includes(word)) return -1;
      }
      i += word.length;
      continue;
    }

    i++;
  }

  return -1;
}

/**
 * Replace comments with whitespace (preserving character positions).
 * Line comments (//) replaced with spaces until newline.
 * Block comments replaced with spaces (preserving newlines).
 */
function stripComments(src) {
  const chars = [...src];
  let i = 0;
  while (i < chars.length) {
    if (chars[i] === '/' && chars[i + 1] === '/') {
      while (i < chars.length && chars[i] !== '\n') {
        chars[i] = ' ';
        i++;
      }
    } else if (chars[i] === '/' && chars[i + 1] === '*') {
      chars[i] = ' '; chars[i + 1] = ' ';
      i += 2;
      while (i < chars.length) {
        if (chars[i] === '*' && chars[i + 1] === '/') {
          chars[i] = ' '; chars[i + 1] = ' ';
          i += 2;
          break;
        }
        if (chars[i] !== '\n') chars[i] = ' ';
        i++;
      }
    } else if (chars[i] === '"') {
      i++;
      while (i < chars.length && chars[i] !== '"') {
        if (chars[i] === '\\') i++;
        i++;
      }
      i++;
    } else {
      i++;
    }
  }
  return chars.join('');
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
