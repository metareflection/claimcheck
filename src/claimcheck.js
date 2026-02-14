import { resetTokenUsage, getTokenUsage } from './api.js';
import { roundtripCheck, singlePromptCheck } from './roundtrip.js';

/**
 * Pure JSON-in/JSON-out claimcheck audit.
 *
 * Takes pre-extracted claims (requirement + lemmaName + dafnyCode) and returns
 * audit results. No file I/O, no eval fields, no logging side effects.
 *
 * @param {{ claims: Array<{requirement: string, lemmaName: string, dafnyCode: string}>,
 *           domain: string,
 *           options?: {singlePrompt?: boolean, informalizeModel?: string, compareModel?: string, model?: string, verbose?: boolean, log?: Function} }}
 * @returns {Promise<{ results: object[], tokenUsage: {input: number, output: number} }>}
 */
export async function claimcheck({ claims, domain, options = {} }) {
  resetTokenUsage();

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
  const check = options.singlePrompt ? singlePromptCheck : roundtripCheck;
  const { passed, failed } = await check(valid, requirements, domain, options);

  const results = [];

  for (const p of passed) {
    results.push({
      requirement: claims[p.index].requirement,
      lemmaName: p.lemmaName,
      status: 'confirmed',
      dafnyCode: p.dafnyCode,
      informalization: p.informalization,
      comparison: p.comparison,
    });
  }

  for (const f of failed) {
    results.push({
      requirement: claims[f.index].requirement,
      lemmaName: f.lemmaName,
      status: 'disputed',
      dafnyCode: f.dafnyCode,
      informalization: f.informalization,
      comparison: f.comparison,
      discrepancy: f.discrepancy,
      weakeningType: f.weakeningType,
    });
  }

  results.push(...errors);

  // Sort by original claim order
  const nameToIndex = new Map(claims.map((c, i) => [c.lemmaName, i]));
  results.sort((a, b) => (nameToIndex.get(a.lemmaName) ?? 0) - (nameToIndex.get(b.lemmaName) ?? 0));

  return { results, tokenUsage: getTokenUsage() };
}
