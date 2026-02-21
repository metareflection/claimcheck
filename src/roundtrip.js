import { callWithTool } from './api.js';
import { callViaClaudeCode } from './claude-code-backend.js';
import { INFORMALIZE_TOOL, ROUNDTRIP_COMPARE_TOOL, CLAIMCHECK_TOOL, NAIVE_TOOL } from './schemas.js';
import {
  INFORMALIZE_PROMPT,
  ROUNDTRIP_COMPARE_PROMPT,
  CLAIMCHECK_PROMPT,
  NAIVE_PROMPT,
} from './prompts.js';

/** Pick the right backend based on opts.claudeCode. */
function getCallFn(opts) {
  return opts.claudeCode ? callViaClaudeCode : callWithTool;
}

// Default models: short names for Claude Code, full IDs for the API.
const MODEL_DEFAULTS = {
  api: { haiku: 'claude-haiku-4-5-20251001', sonnet: 'claude-sonnet-4-5-20250929' },
  cc:  { haiku: 'haiku',                     sonnet: 'sonnet' },
};

function defaultModels(opts) {
  return opts.claudeCode ? MODEL_DEFAULTS.cc : MODEL_DEFAULTS.api;
}

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

  const log = opts.log ?? (() => {});
  const defaults = defaultModels(opts);
  const informalizeModel = opts.informalizeModel ?? defaults.haiku;
  const compareModel = opts.compareModel ?? opts.model ?? defaults.sonnet;

  const call = getCallFn(opts);

  // Step 1: Informalize all lemmas (one batch call, haiku)
  log(`[roundtrip] Informalizing ${lemmas.length} lemma(s)...`);

  const informalizePrompt = INFORMALIZE_PROMPT(domain, lemmas);
  const informalizeResponse = await call({
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
      log(`[roundtrip] Pre-check: ${inf.lemmaName} rated as trivial strength`);
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
      log(`[roundtrip] Pre-check: duplicate postcondition across ${names.join(', ')}: "${post}"`);
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

  log(`[roundtrip] Comparing ${pairs.length} pair(s)...`);

  const comparePrompt = ROUNDTRIP_COMPARE_PROMPT(domain, pairs);
  const compareResponse = await call({
    model: compareModel,
    prompt: comparePrompt,
    tool: ROUNDTRIP_COMPARE_TOOL,
    toolChoice: { type: 'tool', name: 'record_roundtrip_comparisons' },
    verbose: opts.verbose,
    maxTokens: 8192,
  });

  const comparisons = compareResponse.input.comparisons;

  // Patch requirementIndex from lemmaName when using Claude Code backend
  // (text parser can't infer the index, only the name)
  if (opts.claudeCode) {
    const nameToIndex = new Map(pairs.map(p => [p.lemmaName, p.requirementIndex]));
    for (const c of comparisons) {
      if (c.requirementIndex == null) {
        c.requirementIndex = nameToIndex.get(c.lemmaName) ?? null;
      }
    }
  }

  // Index comparisons by requirement index
  const compByIndex = new Map();
  for (const c of comparisons) {
    compByIndex.set(c.requirementIndex, c);
  }

  // Partition into passed/failed — trust the compare step's judgement
  const passed = [];
  const failed = [];

  for (const l of lemmas) {
    const comp = compByIndex.get(l.index);
    const inf = informalByName.get(l.lemmaName);
    const compMatch = comp?.match ?? false;

    if (compMatch) {
      passed.push({ ...l, informalization: inf, comparison: comp });
    } else {
      failed.push({
        ...l,
        informalization: inf,
        comparison: comp,
        discrepancy: comp?.discrepancy ?? 'No comparison produced',
        weakeningType: comp?.weakeningType ?? 'none',
      });
    }
  }

  log(`[roundtrip] Passed: ${passed.length}, Failed: ${failed.length}`);
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

  const log = opts.log ?? (() => {});
  const model = opts.model ?? defaultModels(opts).sonnet;
  const call = getCallFn(opts);

  const passed = [];
  const failed = [];

  for (const l of lemmas) {
    const requirement = requirements[l.index];
    log(`[claimcheck] Checking ${l.lemmaName} against: "${requirement.slice(0, 60)}..."`);

    const prompt = CLAIMCHECK_PROMPT(domain, l.lemmaName, l.dafnyCode, requirement);
    const response = await call({
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

  log(`[claimcheck] Passed: ${passed.length}, Failed: ${failed.length}`);
  return { passed, failed };
}

/**
 * Naive claimcheck: one API call per pair, no structured reasoning.
 *
 * Just presents the lemma and requirement and asks "does this match?"
 * Serves as an ablation baseline for the structured single-prompt approach.
 *
 * @param {{ index: number, lemmaName: string, dafnyCode: string }[]} lemmas
 * @param {string[]} requirements
 * @param {string} domain
 * @param {object} [opts] - { verbose, model }
 * @returns {Promise<{ passed: object[], failed: object[] }>}
 */
export async function naiveCheck(lemmas, requirements, domain, opts = {}) {
  if (lemmas.length === 0) return { passed: [], failed: [] };

  const log = opts.log ?? (() => {});
  const model = opts.model ?? defaultModels(opts).sonnet;
  const call = getCallFn(opts);

  const passed = [];
  const failed = [];

  for (const l of lemmas) {
    const requirement = requirements[l.index];
    log(`[naive] Checking ${l.lemmaName} against: "${requirement.slice(0, 60)}..."`);

    const prompt = NAIVE_PROMPT(domain, l.lemmaName, l.dafnyCode, requirement);
    const response = await call({
      model,
      prompt,
      tool: NAIVE_TOOL,
      toolChoice: { type: 'tool', name: 'record_naive_verdict' },
      verbose: opts.verbose,
      maxTokens: 2048,
    });

    const result = response.input;

    // Minimal informalization/comparison shapes for report compatibility
    const informalization = {
      naturalLanguage: '(naive mode — no informalization)',
      preconditions: '(naive mode)',
      postcondition: '(naive mode)',
      scope: '(naive mode)',
      strength: 'unknown',
      confidence: 0,
    };

    const comparison = {
      requirementIndex: l.index,
      lemmaName: l.lemmaName,
      match: result.verdict === 'JUSTIFIED',
      discrepancy: result.verdict !== 'JUSTIFIED' ? result.explanation : '',
      weakeningType: result.verdict === 'JUSTIFIED' ? 'none' : 'unknown',
      explanation: result.explanation,
    };

    if (result.verdict === 'JUSTIFIED') {
      passed.push({ ...l, informalization, comparison });
    } else {
      failed.push({
        ...l,
        informalization,
        comparison,
        discrepancy: result.explanation,
        weakeningType: 'unknown',
      });
    }
  }

  log(`[naive] Passed: ${passed.length}, Failed: ${failed.length}`);
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
