/**
 * Find the matching closing brace, handling nested braces, strings, and comments.
 * @param {string} src
 * @param {number} start - position of opening '{'
 * @returns {number} position of matching '}', or -1
 */
export function findMatchingBrace(src, start) {
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

