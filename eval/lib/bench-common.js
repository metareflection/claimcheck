/**
 * Shared utilities for claim-verification benchmarks.
 *
 * Covers: arg parsing, tool schemas, Claude Code backend,
 * verdict parsing, summary formatting, the three-mode run loop,
 * and result saving.
 */

import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { callWithTool } from '../../src/api.js';

export const RESULTS_DIR = resolve(import.meta.dirname, '../results');

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

export function parseArgs(prefix) {
  const args = process.argv.slice(2);

  function getArg(name, defaultVal) {
    const i = args.indexOf(name);
    if (i === -1) return defaultVal;
    return args[i + 1];
  }

  const mode = getArg('--mode', 'baseline');
  const backend = getArg('--backend', 'api');
  const label = getArg('--label', `${prefix}-${mode}-${Date.now()}`);
  const model = getArg('--model', 'claude-sonnet-4-5-20250929');
  const limit = parseInt(getArg('--limit', '0')) || 0;
  const offset = parseInt(getArg('--offset', '0')) || 0;
  const sample = parseInt(getArg('--sample', '0')) || 0;
  const verbose = args.includes('--verbose');
  const seed = parseInt(getArg('--seed', '42')) || 42;
  const softAgg = args.includes('--soft-agg');
  const contrastive = args.includes('--contrastive');

  return { mode, backend, label, model, limit, offset, sample, verbose, seed, softAgg, contrastive };
}

// ---------------------------------------------------------------------------
// Tool schemas
// ---------------------------------------------------------------------------

export const VERDICTS = ['SUPPORTS', 'REFUTES', 'NOT_ENOUGH_INFO'];

export const verdictTool = {
  name: 'record_verdict',
  description: 'Record your verdict on whether the evidence supports or refutes the claim.',
  input_schema: {
    type: 'object',
    required: ['reasoning', 'verdict'],
    properties: {
      reasoning: {
        type: 'string',
        description: 'Brief explanation of why the evidence does or does not support the claim.',
      },
      verdict: {
        type: 'string',
        enum: VERDICTS,
        description: 'SUPPORTS if the evidence supports the claim, REFUTES if it contradicts the claim, NOT_ENOUGH_INFO if the evidence is insufficient.',
      },
    },
  },
};

export const groundedTool = {
  name: 'record_grounded_verdict',
  description: 'Record your evidence-grounded verdict. You MUST cite evidence spans before judging.',
  input_schema: {
    type: 'object',
    required: ['assertions', 'verdict'],
    properties: {
      assertions: {
        type: 'array',
        items: {
          type: 'object',
          required: ['text', 'evidence_span', 'relationship', 'reasoning'],
          properties: {
            text: {
              type: 'string',
              description: 'One distinct assertion from the claim.',
            },
            evidence_span: {
              type: 'string',
              description: 'Exact quote from the evidence that addresses this assertion, or "no relevant evidence" if none.',
            },
            relationship: {
              type: 'string',
              enum: ['SUPPORTS', 'CONTRADICTS', 'NO_EVIDENCE'],
              description: 'Whether the evidence span supports, contradicts, or does not address this assertion.',
            },
            reasoning: {
              type: 'string',
              description: 'Brief explanation of the entailment relationship.',
            },
          },
        },
        description: 'Per-assertion evidence grounding. Cite the evidence BEFORE stating the relationship.',
      },
      verdict: {
        type: 'string',
        enum: VERDICTS,
        description: 'Final verdict derived from per-assertion judgments: all supported → SUPPORTS, any contradiction → REFUTES, insufficient coverage → NOT_ENOUGH_INFO.',
      },
    },
  },
};

/**
 * Build the grounded tool schema, optionally with soft aggregation and contrastive fields.
 */
export function buildGroundedTool({ softAgg, contrastive } = {}) {
  const verdictDesc = softAgg
    ? 'Final verdict using your best judgment: if most assertions are supported and none contradicted, SUPPORTS is appropriate even without perfect coverage. REFUTES if any assertion is contradicted. NOT_ENOUGH_INFO only if the evidence genuinely does not address the core of the claim.'
    : 'Final verdict derived from per-assertion judgments: all supported → SUPPORTS, any contradiction → REFUTES, insufficient coverage → NOT_ENOUGH_INFO.';

  const props = { ...groundedTool.input_schema.properties, verdict: { ...groundedTool.input_schema.properties.verdict, description: verdictDesc } };
  const required = [...groundedTool.input_schema.required];

  if (contrastive) {
    props.contrastive_analysis = {
      type: 'object',
      required: ['if_supports', 'if_refutes', 'if_nei'],
      properties: {
        if_supports: { type: 'string', description: 'What specific evidence would need to be true for SUPPORTS to be the correct verdict? Is that what the evidence says?' },
        if_refutes: { type: 'string', description: 'What specific evidence would need to be true for REFUTES to be the correct verdict? Is that what the evidence says?' },
        if_nei: { type: 'string', description: 'What would need to be missing or ambiguous for NOT_ENOUGH_INFO to be correct? Is that the case here?' },
      },
      description: 'Consider what each verdict would require before choosing.',
    };
    required.splice(required.indexOf('verdict'), 0, 'contrastive_analysis');
  }

  return {
    name: 'record_grounded_verdict',
    description: groundedTool.description,
    input_schema: { type: 'object', required, properties: props },
  };
}

/**
 * Build the grounded prompt instruction block based on flags.
 */
export function groundedInstructions({ softAgg, contrastive } = {}) {
  const steps = [`1. Break the claim into its distinct assertions.
2. For each assertion, quote the specific evidence span that addresses it (or state "no relevant evidence").
3. State whether that span SUPPORTS, CONTRADICTS, or provides NO_EVIDENCE for the assertion.`];

  if (contrastive) {
    steps.push(`4. Before choosing a verdict, consider: what would the evidence need to say for each of SUPPORTS, REFUTES, and NOT_ENOUGH_INFO to be correct? Which scenario matches reality?`);
  }

  if (softAgg) {
    steps.push(`${contrastive ? '5' : '4'}. Derive the final verdict:
   - If most assertions are supported and none contradicted → SUPPORTS (perfect coverage is not required)
   - Any assertion contradicted → REFUTES
   - Evidence genuinely does not address the core claim → NOT_ENOUGH_INFO`);
  } else {
    steps.push(`${contrastive ? '5' : '4'}. Derive the final verdict:
   - All assertions supported → SUPPORTS
   - Any contradiction → REFUTES
   - Insufficient coverage → NOT_ENOUGH_INFO`);
  }

  steps.push('\nYou must cite evidence before judging. No citation, no claim of support.');

  return steps.join('\n');
}

export const summarizeTool = {
  name: 'record_summary',
  description: 'Record your summary of what the evidence text establishes.',
  input_schema: {
    type: 'object',
    required: ['factual_claims', 'key_findings', 'limitations'],
    properties: {
      factual_claims: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of specific factual claims made in the evidence text.',
      },
      key_findings: {
        type: 'string',
        description: 'Summary of what the evidence establishes, in your own words.',
      },
      limitations: {
        type: 'string',
        description: 'What the evidence does NOT establish or leaves unclear.',
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Claude Code backend
// ---------------------------------------------------------------------------

export function callClaude(prompt, { model, verbose } = {}) {
  const ccArgs = ['-p', prompt, '--output-format', 'text', '--max-turns', '1', '--tools', ''];
  if (model) ccArgs.push('--model', model);

  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.CLAUDECODE;
    const proc = spawn('claude', ccArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => { stdout += d; });
    proc.stderr.on('data', d => { stderr += d; });

    if (verbose) {
      proc.stderr.on('data', d => process.stderr.write(d));
    }

    proc.on('close', code => {
      if (code !== 0) {
        reject(new Error(`claude -p failed: ${stderr || `exit code ${code}`}`));
      } else {
        resolve(stdout);
      }
    });
    proc.on('error', err => {
      reject(new Error(`Failed to spawn claude: ${err.message}`));
    });
  });
}

// ---------------------------------------------------------------------------
// Verdict parsing
// ---------------------------------------------------------------------------

export function normalizeVerdict(v) {
  v = v.toUpperCase().replace(/\s+/g, '_');
  if (v === 'SUPPORT') return 'SUPPORTS';
  if (v === 'REFUTE') return 'REFUTES';
  return v;
}

export function parseVerdict(output) {
  const explicit = output.match(/\*?\*?Verdict:?\*?\*?\s*(SUPPORTS?|REFUTES?|NOT[_ ]ENOUGH[_ ]INFO)/i);
  if (explicit) {
    return normalizeVerdict(explicit[1]);
  }

  const all = [...output.matchAll(/\b(SUPPORTS?|REFUTES?|NOT[_ ]ENOUGH[_ ]INFO)\b/gi)];
  if (all.length > 0) {
    return normalizeVerdict(all[all.length - 1][0]);
  }

  return null;
}

// ---------------------------------------------------------------------------
// Summary formatting (for two-pass)
// ---------------------------------------------------------------------------

export function formatSummary(toolInput) {
  const parts = [];
  if (toolInput.factual_claims?.length) {
    parts.push('**Factual claims:**');
    for (const c of toolInput.factual_claims) parts.push(`- ${c}`);
  }
  if (toolInput.key_findings) parts.push(`**Key findings:** ${toolInput.key_findings}`);
  if (toolInput.limitations) parts.push(`**Limitations:** ${toolInput.limitations}`);
  return parts.join('\n\n');
}

// ---------------------------------------------------------------------------
// Deterministic sampling
// ---------------------------------------------------------------------------

export function sampleEntries(entries, n, seed) {
  if (n <= 0 || n >= entries.length) return entries;
  // Simple seeded shuffle (Mulberry32 PRNG)
  let s = seed | 0;
  function rand() {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const shuffled = [...entries];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, n);
}

// ---------------------------------------------------------------------------
// Three-mode runner
// ---------------------------------------------------------------------------

/**
 * Run one entry through the baseline/single-prompt/two-pass pipeline.
 *
 * @param {object} opts
 * @param {string} opts.mode         - 'baseline' | 'single-prompt' | 'two-pass'
 * @param {string} opts.backend      - 'api' | 'cc'
 * @param {string} opts.model
 * @param {boolean} opts.verbose
 * @param {object} prompts           - { baseline, singlePrompt, summarize, compare }
 *   Each is a string (the fully-rendered prompt for this entry).
 */
export async function runOne({ mode, backend, model, verbose, softAgg, contrastive }, prompts) {
  if (mode === 'baseline') {
    return runBaseline({ backend, model, verbose }, prompts.baseline);
  } else if (mode === 'single-prompt') {
    return runSinglePrompt({ backend, model, verbose }, prompts.singlePrompt);
  } else if (mode === 'two-pass') {
    return runTwoPass({ backend, model, verbose }, prompts.summarize, claim =>
      prompts.compare(claim),
    );
  } else if (mode === 'grounded') {
    return runGrounded({ backend, model, verbose, softAgg, contrastive }, prompts.grounded);
  } else {
    throw new Error(`Unknown mode: ${mode}. Expected: baseline, single-prompt, two-pass, grounded`);
  }
}

async function runBaseline({ backend, model, verbose }, prompt) {
  if (backend === 'api') {
    const result = await callWithTool({
      model, prompt, tool: verdictTool,
      toolChoice: { type: 'tool', name: 'record_verdict' },
      verbose,
    });
    return normalizeVerdict(result.input.verdict);
  } else {
    const output = await callClaude(
      prompt + '\n\nState your final verdict as: **Verdict:** SUPPORTS | REFUTES | NOT_ENOUGH_INFO',
      { model, verbose },
    );
    return parseVerdict(output);
  }
}

async function runGrounded({ backend, model, verbose, softAgg, contrastive }, prompt) {
  if (backend === 'api') {
    const tool = (softAgg || contrastive) ? buildGroundedTool({ softAgg, contrastive }) : groundedTool;
    const result = await callWithTool({
      model, prompt, tool,
      toolChoice: { type: 'tool', name: 'record_grounded_verdict' },
      verbose, maxTokens: 8192,
    });
    return normalizeVerdict(result.input.verdict);
  } else {
    const output = await callClaude(
      prompt + '\n\nState your final verdict as: **Verdict:** SUPPORTS | REFUTES | NOT_ENOUGH_INFO',
      { model, verbose },
    );
    return parseVerdict(output);
  }
}

async function runSinglePrompt({ backend, model, verbose }, prompt) {
  if (backend === 'api') {
    const result = await callWithTool({
      model, prompt, tool: verdictTool,
      toolChoice: { type: 'tool', name: 'record_verdict' },
      verbose, maxTokens: 8192,
    });
    return normalizeVerdict(result.input.verdict);
  } else {
    const output = await callClaude(
      prompt + '\n\nState your final verdict as: **Verdict:** SUPPORTS | REFUTES | NOT_ENOUGH_INFO',
      { model, verbose },
    );
    return parseVerdict(output);
  }
}

async function runTwoPass({ backend, model, verbose }, summarizePrompt, makeComparePrompt) {
  // Pass 1: summarize evidence without seeing claim
  let summary;

  if (backend === 'api') {
    const result1 = await callWithTool({
      model, prompt: summarizePrompt, tool: summarizeTool,
      toolChoice: { type: 'tool', name: 'record_summary' },
      verbose,
    });
    summary = formatSummary(result1.input);

    if (verbose) {
      console.error('    --- summary ---');
      console.error(JSON.stringify(result1.input, null, 2).slice(0, 500));
      console.error('    ---');
    }
  } else {
    summary = await callClaude(summarizePrompt, { model, verbose });
    if (verbose) {
      console.error('    --- summary ---');
      console.error(summary.slice(-500));
      console.error('    ---');
    }
  }

  // Pass 2: compare summary to claim
  const comparePrompt = makeComparePrompt(summary);

  if (backend === 'api') {
    const result2 = await callWithTool({
      model, prompt: comparePrompt, tool: verdictTool,
      toolChoice: { type: 'tool', name: 'record_verdict' },
      verbose,
    });
    return normalizeVerdict(result2.input.verdict);
  } else {
    const output = await callClaude(
      comparePrompt + '\n\nState your final verdict as: **Verdict:** SUPPORTS | REFUTES | NOT_ENOUGH_INFO',
      { model, verbose },
    );
    return parseVerdict(output);
  }
}

// ---------------------------------------------------------------------------
// Main eval loop
// ---------------------------------------------------------------------------

/**
 * @param {object} opts
 * @param {string} opts.benchName   - e.g. 'SciFact', 'FEVER'
 * @param {object} opts.config      - parsed args from parseArgs()
 * @param {Array}  opts.entries     - array of { id, claim, label, ... }
 * @param {function} opts.makePrompts - (entry) => { baseline, singlePrompt, summarize, compare }
 *   where compare is (summary) => string
 * @param {function} [opts.entryToResult] - (entry, verdict, elapsedMs, error) => result object
 */
export async function runBench({ benchName, config, entries, makePrompts, entryToResult }) {
  const { mode, backend, model, label, verbose, softAgg, contrastive } = config;

  console.error(`${benchName} Benchmark: ${label}`);
  console.error(`  mode: ${mode}${softAgg ? ' +soft-agg' : ''}${contrastive ? ' +contrastive' : ''}`);
  console.error(`  backend: ${backend}`);
  console.error(`  model: ${model}`);
  console.error(`  entries: ${entries.length}`);
  console.error('');

  const allResults = [];
  const totalStart = Date.now();
  let correct = 0;

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    console.error(`  [${i + 1}/${entries.length}] claim ${e.id} (${e.label})...`);

    const start = Date.now();
    let verdict = null;
    let error = null;

    try {
      const prompts = makePrompts(e);
      verdict = await runOne({ mode, backend, model, verbose, softAgg, contrastive }, prompts);
    } catch (err) {
      error = err.message;
      console.error(`    ERROR: ${error}`);
    }

    const elapsedMs = Date.now() - start;
    const isCorrect = verdict === e.label;
    if (isCorrect) correct++;

    const tag = isCorrect ? 'CORRECT' : verdict ? 'WRONG' : 'PARSE_FAILED';
    console.error(`    ${tag}: "${verdict}" (expected "${e.label}") (${(elapsedMs / 1000).toFixed(1)}s)`);

    const result = entryToResult
      ? entryToResult(e, verdict, isCorrect, elapsedMs, error)
      : {
          id: e.id,
          claim: e.claim,
          expected: e.label,
          verdict,
          correct: isCorrect,
          elapsedMs,
          ...(error ? { error } : {}),
        };

    allResults.push(result);
  }

  const totalElapsedMs = Date.now() - totalStart;

  // Per-label accuracy
  const byLabel = {};
  for (const v of VERDICTS) {
    const subset = allResults.filter(r => r.expected === v);
    const subCorrect = subset.filter(r => r.correct).length;
    byLabel[v] = { correct: subCorrect, total: subset.length };
    if (subset.length > 0) {
      console.error(`  ${v}: ${subCorrect}/${subset.length} (${(100 * subCorrect / subset.length).toFixed(1)}%)`);
    }
  }

  console.error(`\nAccuracy: ${correct}/${allResults.length} (${(100 * correct / allResults.length).toFixed(1)}%)`);
  console.error(`Elapsed: ${(totalElapsedMs / 1000).toFixed(1)}s`);

  // Save results
  await mkdir(RESULTS_DIR, { recursive: true });

  const output = {
    label,
    timestamp: new Date().toISOString(),
    config: { mode, backend, model, total: allResults.length },
    totalElapsedMs,
    accuracy: correct / allResults.length,
    correct,
    total: allResults.length,
    byLabel,
    results: allResults,
  };

  const outPath = join(RESULTS_DIR, `${label}.json`);
  await writeFile(outPath, JSON.stringify(output, null, 2));
  console.error(`Saved: ${outPath}`);
}
