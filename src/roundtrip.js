import { callWithTool } from './api.js';
import { INFORMALIZE_TOOL, ROUNDTRIP_COMPARE_TOOL, CLAIMCHECK_TOOL } from './schemas.js';
import {
  INFORMALIZE_PROMPT,
  ROUNDTRIP_COMPARE_PROMPT,
  CLAIMCHECK_PROMPT,
} from './prompts.js';

/**
 * Run the round-trip check on lemmas.
 *
 * 1. Informalize: LLM reads each lemma → English back-translation (does NOT see original requirements)
 * 2. Compare: LLM checks original requirement vs back-translation
 * 3. Pre-checks: flag trivial-strength informalizations, detect duplicate postconditions
 *
 * @param {{ index: number, lemmaName: string, dafnyCode: string }[]} lemmas
 * @param {string[]} requirements
 * @param {string} domain
 * @param {object} [opts] - { verbose, informalizeModel, compareModel }
 * @returns {Promise<{ passed: object[], failed: object[] }>}
 */
export async function roundtripCheck(lemmas, requirements, domain, opts = {}) {
  if (lemmas.length === 0) return { passed: [], failed: [] };

  const informalizeModel = opts.informalizeModel ?? 'claude-haiku-4-5-20251001';
  const compareModel = opts.compareModel ?? opts.model ?? 'claude-sonnet-4-5-20250929';

  // Step 1: Informalize all lemmas (one batch call, haiku)
  console.error(`[roundtrip] Informalizing ${lemmas.length} lemma(s)...`);

  const informalizePrompt = INFORMALIZE_PROMPT(domain, lemmas);
  const informalizeResponse = await callWithTool({
    model: informalizeModel,
    prompt: informalizePrompt,
    tool: INFORMALIZE_TOOL,
    toolChoice: { type: 'tool', name: 'record_informalizations' },
    verbose: opts.verbose,
    maxTokens: 8192,
  });

  const informalizations = informalizeResponse.input.informalizations;

  // Index informalizations by lemma name
  const informalByName = new Map();
  for (const inf of informalizations) {
    informalByName.set(inf.lemmaName, inf);
  }

  // Pre-check: flag trivial-strength informalizations
  const trivialNames = new Set();
  for (const inf of informalizations) {
    if (inf.strength === 'trivial') {
      console.error(`[roundtrip] Pre-check: ${inf.lemmaName} rated as trivial strength`);
      trivialNames.add(inf.lemmaName);
    }
  }

  // Pre-check: detect duplicate postconditions across different requirements
  const postByText = new Map();
  for (const inf of informalizations) {
    const key = inf.postcondition?.toLowerCase().trim();
    if (key) {
      if (!postByText.has(key)) postByText.set(key, []);
      postByText.get(key).push(inf.lemmaName);
    }
  }
  for (const [post, names] of postByText) {
    if (names.length > 1) {
      console.error(`[roundtrip] Pre-check: duplicate postcondition across ${names.join(', ')}: "${post}"`);
    }
  }

  // Step 2: Compare original requirements vs back-translations (one batch call, sonnet)
  const pairs = lemmas.map((l) => ({
    requirementIndex: l.index,
    requirement: requirements[l.index],
    lemmaName: l.lemmaName,
    dafnyCode: l.dafnyCode,
    informalization: informalByName.get(l.lemmaName) ?? {
      naturalLanguage: '(no back-translation produced)',
      preconditions: 'unknown',
      postcondition: 'unknown',
      scope: 'unknown',
      strength: 'trivial',
      confidence: 0,
    },
  }));

  console.error(`[roundtrip] Comparing ${pairs.length} pair(s)...`);

  const comparePrompt = ROUNDTRIP_COMPARE_PROMPT(domain, pairs);
  const compareResponse = await callWithTool({
    model: compareModel,
    prompt: comparePrompt,
    tool: ROUNDTRIP_COMPARE_TOOL,
    toolChoice: { type: 'tool', name: 'record_roundtrip_comparisons' },
    verbose: opts.verbose,
    maxTokens: 8192,
  });

  const comparisons = compareResponse.input.comparisons;

  // Index comparisons by requirement index
  const compByIndex = new Map();
  for (const c of comparisons) {
    compByIndex.set(c.requirementIndex, c);
  }

  // Partition into passed/failed
  const passed = [];
  const failed = [];

  for (const l of lemmas) {
    const comp = compByIndex.get(l.index);
    const inf = informalByName.get(l.lemmaName);

    // Auto-fail if trivial strength and no explicit pass
    const isTrivial = trivialNames.has(l.lemmaName);
    const compMatch = comp?.match ?? false;

    if (compMatch && !isTrivial) {
      passed.push({ ...l, informalization: inf, comparison: comp });
    } else {
      failed.push({
        ...l,
        informalization: inf,
        comparison: comp,
        discrepancy: comp?.discrepancy ?? (isTrivial ? 'Lemma rated as trivially weak — ensures clause may not express the requirement' : 'No comparison produced'),
        weakeningType: comp?.weakeningType ?? (isTrivial ? 'tautology' : 'none'),
      });
    }
  }

  console.error(`[roundtrip] Passed: ${passed.length}, Failed: ${failed.length}`);
  return { passed, failed };
}

/**
 * Single-prompt claimcheck: one API call per requirement-lemma pair.
 *
 * Uses the claimcheck-prompt.md approach: the model informalizes the lemma
 * first (without seeing the NL requirement), then compares. Separation is
 * prompt-level, not structural.
 *
 * @param {{ index: number, lemmaName: string, dafnyCode: string }[]} lemmas
 * @param {string[]} requirements
 * @param {string} domain
 * @param {object} [opts] - { verbose, model }
 * @returns {Promise<{ passed: object[], failed: object[] }>}
 */
export async function singlePromptCheck(lemmas, requirements, domain, opts = {}) {
  if (lemmas.length === 0) return { passed: [], failed: [] };

  const model = opts.model ?? 'claude-sonnet-4-5-20250929';

  const passed = [];
  const failed = [];

  for (const l of lemmas) {
    const requirement = requirements[l.index];
    console.error(`[claimcheck] Checking ${l.lemmaName} against: "${requirement.slice(0, 60)}..."`);

    const prompt = CLAIMCHECK_PROMPT(domain, l.lemmaName, l.dafnyCode, requirement);
    const response = await callWithTool({
      model,
      prompt,
      tool: CLAIMCHECK_TOOL,
      toolChoice: { type: 'tool', name: 'record_claimcheck' },
      verbose: opts.verbose,
      maxTokens: 4096,
    });

    const result = response.input;

    // Map to informalization shape for report compatibility
    const informalization = {
      naturalLanguage: result.informalization,
      preconditions: '(see informalization)',
      postcondition: '(see informalization)',
      scope: '(see informalization)',
      strength: result.vacuous ? 'trivial' : 'moderate',
      confidence: 1,
    };

    // Map to comparison shape for report compatibility
    const comparison = {
      requirementIndex: l.index,
      lemmaName: l.lemmaName,
      match: result.verdict === 'JUSTIFIED',
      discrepancy: result.verdict !== 'JUSTIFIED' ? result.ensuresExplanation : '',
      weakeningType: verdictToWeakeningType(result),
      explanation: result.ensuresExplanation,
      // Preserve the richer claimcheck fields
      claimcheck: result,
    };

    if (result.verdict === 'JUSTIFIED') {
      passed.push({ ...l, informalization, comparison });
    } else {
      failed.push({
        ...l,
        informalization,
        comparison,
        discrepancy: result.ensuresExplanation || result.vacuousExplanation || result.surprisingRestrictions,
        weakeningType: verdictToWeakeningType(result),
      });
    }
  }

  console.error(`[claimcheck] Passed: ${passed.length}, Failed: ${failed.length}`);
  return { passed, failed };
}

function verdictToWeakeningType(result) {
  if (result.verdict === 'JUSTIFIED') return 'none';
  if (result.verdict === 'VACUOUS') return 'tautology';
  if (result.ensuresMatchesNL === 'No') return 'wrong-property';
  if (result.ensuresMatchesNL === 'Partially') return 'weakened-postcondition';
  if (result.surprisingRestrictions !== 'None') return 'narrowed-scope';
  return 'weakened-postcondition';
}
