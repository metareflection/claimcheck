#!/usr/bin/env node
/**
 * VERINA ClaimCheck benchmark.
 *
 * Runs spec-verification on VERINA Lean 4 specifications to test whether
 * the formal spec (precond/postcond) matches the NL description.
 *
 * Since all VERINA pairs are intended to be correct, the confirmation
 * rate measures false positive (dispute) rate.
 *
 * Modes:
 *   naive      - single LLM call: "does spec match NL?" (no reasoning structure)
 *   baseline   - single LLM call with NL + Lean spec → verdict (mini-informalization in prompt)
 *   two-pass   - pass 1: informalize spec (blind); pass 2: compare with NL
 *
 * Usage:
 *   node eval/bench-verina.js --mode naive --concurrency 10 --label verina-naive
 *   node eval/bench-verina.js --mode baseline --concurrency 10 --label verina-baseline
 *   node eval/bench-verina.js --mode two-pass --concurrency 10 --label verina-twopass
 *   node eval/bench-verina.js --mode baseline --limit 10 --verbose --label verina-test
 *   node eval/bench-verina.js --subset basic --label verina-basic
 *   node eval/bench-verina.js --subset advanced --label verina-adv
 */

import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { callWithTool } from '../src/api.js';

const RESULTS_DIR = resolve(import.meta.dirname, 'results');
const DATASET_DIR = resolve(import.meta.dirname, '../../verina/datasets/verina');

// --- Parse args ---

const args = process.argv.slice(2);

function getArg(name, defaultVal) {
  const i = args.indexOf(name);
  if (i === -1) return defaultVal;
  return args[i + 1];
}

const mode = getArg('--mode', 'baseline');
const label = getArg('--label', `verina-${mode}-${Date.now()}`);
const model = getArg('--model', 'claude-sonnet-4-5-20250929');
const informalizeModel = getArg('--informalize-model', 'claude-haiku-4-5-20251001');
const limit = parseInt(getArg('--limit', '0')) || 0;
const offset = parseInt(getArg('--offset', '0')) || 0;
const concurrency = parseInt(getArg('--concurrency', '1')) || 1;
const subset = getArg('--subset', 'all'); // 'all', 'basic', 'advanced'
const sample = parseInt(getArg('--sample', '0')) || 0;
const seed = parseInt(getArg('--seed', '42')) || 42;
const verbose = args.includes('--verbose');

// --- Tool schemas ---

const informalizeTool = {
  name: 'record_informalization',
  description: 'Record your English back-translation of the Lean specification.',
  input_schema: {
    type: 'object',
    required: ['specName', 'naturalLanguage', 'preconditions', 'postconditions', 'strength', 'confidence'],
    properties: {
      specName: {
        type: 'string',
        description: 'Name of the specification being informalized.',
      },
      naturalLanguage: {
        type: 'string',
        description: 'Plain English statement of what the specification guarantees. Be literal about what the code says.',
      },
      preconditions: {
        type: 'string',
        description: 'What must be true of the inputs (the precondition), in English.',
      },
      postconditions: {
        type: 'string',
        description: 'What is guaranteed about the result (the postcondition), in English.',
      },
      strength: {
        type: 'string',
        enum: ['trivial', 'weak', 'moderate', 'strong'],
        description: 'How strong is this spec? "trivial" if postcondition is always true or restates precondition, "weak" if it says very little, "moderate" if substantive, "strong" if it tightly constrains behavior.',
      },
      confidence: {
        type: 'number',
        description: 'Confidence (0-1) that the back-translation is faithful to the Lean code.',
      },
    },
  },
};

const compareTool = {
  name: 'record_comparison',
  description: 'Record your comparison of the NL description against the back-translated specification.',
  input_schema: {
    type: 'object',
    required: ['specName', 'match', 'discrepancy', 'weakeningType', 'explanation'],
    properties: {
      specName: {
        type: 'string',
        description: 'Name of the specification being compared.',
      },
      match: {
        type: 'boolean',
        description: 'True if the specification faithfully expresses the NL description. False if there is any meaningful discrepancy.',
      },
      discrepancy: {
        type: 'string',
        description: 'If match is false, describe exactly what the spec gets wrong or misses.',
      },
      weakeningType: {
        type: 'string',
        enum: ['none', 'tautology', 'weakened-postcondition', 'narrowed-scope', 'missing-case', 'wrong-property'],
        description: 'Category of weakening detected, or "none" if match is true.',
      },
      explanation: {
        type: 'string',
        description: 'Brief explanation of the comparison reasoning.',
      },
    },
  },
};

const naiveTool = {
  name: 'record_naive_verdict',
  description: 'Record whether the Lean specification matches the NL description.',
  input_schema: {
    type: 'object',
    required: ['specName', 'verdict', 'explanation'],
    properties: {
      specName: {
        type: 'string',
        description: 'Name of the specification being checked.',
      },
      verdict: {
        type: 'string',
        enum: ['CONFIRMED', 'DISPUTED'],
        description: 'CONFIRMED if the spec captures the NL description, DISPUTED if there is a meaningful discrepancy.',
      },
      explanation: {
        type: 'string',
        description: 'Explanation of your verdict.',
      },
    },
  },
};

const baselineTool = {
  name: 'record_verdict',
  description: 'Record whether the Lean specification matches the NL description.',
  input_schema: {
    type: 'object',
    required: ['specName', 'informalization', 'verdict', 'explanation'],
    properties: {
      specName: {
        type: 'string',
        description: 'Name of the specification being checked.',
      },
      informalization: {
        type: 'string',
        description: 'Your plain English reading of what the spec guarantees.',
      },
      verdict: {
        type: 'string',
        enum: ['CONFIRMED', 'DISPUTED'],
        description: 'CONFIRMED if the spec faithfully captures the NL description, DISPUTED if there is a meaningful discrepancy.',
      },
      explanation: {
        type: 'string',
        description: 'Explanation of your verdict.',
      },
    },
  },
};

// --- Extract spec from task.lean ---

function extractSpec(leanSource) {
  const parts = [];

  // Extract aux blocks that have content
  for (const auxType of ['precond_aux', 'postcond_aux', 'solution_aux']) {
    const match = leanSource.match(
      new RegExp(`-- !benchmark @start ${auxType}\\n([\\s\\S]*?)\\n-- !benchmark @end ${auxType}`)
    );
    if (match && match[1].trim()) {
      parts.push(match[1].trim());
    }
  }

  // Extract precond definition (the full def line + body)
  const precondDef = leanSource.match(
    /(@\[.*?\]\n)?def\s+\w+_precond[\s\S]*?(?=\n\n)/
  );
  if (precondDef) parts.push(precondDef[0].trim());

  // Extract function signature (just the def line, not the code body)
  const funcSig = leanSource.match(
    /def\s+(\w+)\s+\((?!.*_precond)[\s\S]*?:=\n/
  );
  if (funcSig) {
    // Get just the signature without the code body
    const sigLine = funcSig[0].replace(/\n\s*-- !benchmark @start code[\s\S]*/, '').trim();
    parts.push(sigLine);
  }

  // Extract postcond definition (the full def line + body)
  const postcondDef = leanSource.match(
    /(@\[.*?\]\n)?def\s+\w+_postcond[\s\S]*?(?=\n\n)/
  );
  if (postcondDef) parts.push(postcondDef[0].trim());

  // Extract the theorem statement (without proof)
  const theorem = leanSource.match(
    /theorem\s+\w+_spec_satisfied[\s\S]*?:= by/
  );
  if (theorem) parts.push(theorem[0].trim());

  return parts.join('\n\n');
}

// --- Load data ---

async function loadTasks() {
  const dirs = await readdir(DATASET_DIR);
  let taskDirs = dirs.filter(d => d.startsWith('verina_')).sort();

  if (subset === 'basic') {
    taskDirs = taskDirs.filter(d => d.startsWith('verina_basic_'));
  } else if (subset === 'advanced') {
    taskDirs = taskDirs.filter(d => d.startsWith('verina_advanced_'));
  }

  const tasks = [];
  for (const dir of taskDirs) {
    const taskPath = join(DATASET_DIR, dir);
    const [descRaw, taskJson, leanRaw] = await Promise.all([
      readFile(join(taskPath, 'description.txt'), 'utf-8'),
      readFile(join(taskPath, 'task.json'), 'utf-8').then(JSON.parse),
      readFile(join(taskPath, 'task.lean'), 'utf-8'),
    ]);

    const description = descRaw.trim();
    const spec = extractSpec(leanRaw);

    if (!description || !spec) continue;

    tasks.push({
      id: taskJson.id,
      name: taskJson.signature?.name ?? dir,
      description,
      spec,
      leanSource: leanRaw,
      subset: dir.startsWith('verina_advanced_') ? 'advanced' : 'basic',
    });
  }

  // Sample if requested
  if (sample > 0) {
    let s = seed | 0;
    function rand() {
      s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    for (let i = tasks.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [tasks[i], tasks[j]] = [tasks[j], tasks[i]];
    }
    tasks.splice(sample);
  }

  if (offset > 0) tasks.splice(0, offset);
  if (limit > 0) tasks.splice(limit);

  return tasks;
}

// --- Prompts ---

function naivePrompt(task) {
  return `You are checking whether a Lean 4 formal specification matches a natural language description.

## Natural Language Description

${task.description}

## Lean 4 Specification

\`\`\`lean
${task.spec}
\`\`\`

## Instructions

Does this specification faithfully capture the natural language description?

- **CONFIRMED** if yes (it may be stronger, that's fine).
- **DISPUTED** if there is a meaningful discrepancy.

Precondition dependencies on well-formedness invariants are expected and normal — don't count them as discrepancies.

Call the record_naive_verdict tool with your verdict for \`${task.name}\`.`;
}

function baselinePrompt(task) {
  return `You are reviewing whether a Lean 4 formal specification matches a natural language description.

**Key assumption:** The Lean code is correct and verified. You are NOT auditing the proof. You are checking whether the specification (precondition + postcondition) actually captures what the natural language description says.

## Natural Language Description

${task.description}

## Lean 4 Specification

\`\`\`lean
${task.spec}
\`\`\`

## Instructions

1. First, read the Lean specification carefully and state in plain English what it guarantees (the postcondition) and under what conditions (the precondition).
2. Then compare your reading against the natural language description above.
3. Verdict:
   - **CONFIRMED** if the spec faithfully captures the NL description (it may be stronger, that's fine).
   - **DISPUTED** if there is a meaningful discrepancy: the spec is weaker, proves something different, or misses key aspects of the description.

Be STRICT. A spec that is technically correct but doesn't capture the description's intent should be DISPUTED.

Call the record_verdict tool with your analysis for \`${task.name}\`.`;
}

function informalizePrompt(task) {
  return `You are reading a Lean 4 formal specification and translating it to plain English.

## Lean 4 Specification

\`\`\`lean
${task.spec}
\`\`\`

## Instructions

Produce a faithful English description of what this Lean code actually says. Be LITERAL — describe what the code guarantees, not what you think the author intended.

Specifically:
- State the preconditions (what must be true of the inputs) in English
- State the postconditions (what is guaranteed about the result) in English
- Rate the strength of the specification:
  - "trivial" if the postcondition is always true or restates the precondition
  - "weak" if it says very little (e.g. result exists but not what it equals)
  - "moderate" if it makes a substantive claim about the result
  - "strong" if it tightly constrains the result's behavior
- Flag anything suspicious: postconditions that are always true, postconditions that mirror preconditions

Do NOT guess at the original intent. Only describe what the Lean code literally says.

Call the record_informalization tool with your analysis for \`${task.name}\`.`;
}

function comparePrompt(task, informalization) {
  return `You are checking whether a Lean 4 specification faithfully expresses a natural language description.

## Original NL Description

${task.description}

## Lean 4 Specification

\`\`\`lean
${task.spec}
\`\`\`

## Back-Translation (produced WITHOUT seeing the NL description)

- **English:** ${informalization.naturalLanguage ?? '(none)'}
- **Preconditions:** ${informalization.preconditions ?? '(none)'}
- **Postconditions:** ${informalization.postconditions ?? '(none)'}
- **Strength:** ${informalization.strength ?? 'unknown'}

## Cheating Patterns to Watch For

1. **Tautology**: postcondition restates the precondition or is always true
2. **Weakened postcondition**: spec guarantees less than the description asks
3. **Narrowed scope**: spec only covers a subset of cases the description describes
4. **Missing case**: description has multiple conditions but spec only captures some
5. **Wrong property**: spec proves something related but different from what was asked

## Instructions

Be STRICT. It is better to flag a potential mismatch than to miss a real discrepancy. A spec that technically proves something true but doesn't capture the description's intent should be flagged.

However, do not flag specs just because the English phrasing differs — focus on whether the MEANING is preserved.

If the back-translation's strength is "trivial", that is almost always a mismatch unless the description itself is trivial.

Call the record_comparison tool with your analysis for \`${task.name}\`.`;
}

// --- Main ---

async function main() {
  const tasks = await loadTasks();

  console.error(`VERINA ClaimCheck Benchmark: ${label}`);
  console.error(`  mode: ${mode}`);
  console.error(`  model: ${model}${mode === 'two-pass' ? ` (informalize: ${informalizeModel})` : ''}`);
  console.error(`  subset: ${subset}`);
  console.error(`  tasks: ${tasks.length}`);
  console.error(`  concurrency: ${concurrency}`);
  console.error('');

  const allResults = new Array(tasks.length);
  const totalStart = Date.now();
  let confirmed = 0;
  let disputed = 0;
  let errors = 0;

  async function processTask(i) {
    const task = tasks[i];
    console.error(`  [${i + 1}/${tasks.length}] ${task.id} (${task.name})...`);

    try {
      if (mode === 'naive') {
        const result = await callWithTool({
          model,
          prompt: naivePrompt(task),
          tool: naiveTool,
          toolChoice: { type: 'tool', name: 'record_naive_verdict' },
          verbose,
          maxTokens: 2048,
        });

        const r = result.input;
        const status = r.verdict === 'CONFIRMED' ? 'confirmed' : 'disputed';
        if (status === 'confirmed') confirmed++;
        else disputed++;

        allResults[i] = {
          id: task.id,
          name: task.name,
          subset: task.subset,
          status,
          explanation: r.explanation,
        };

        console.error(`    ${status}${status === 'disputed' ? ': ' + r.explanation.slice(0, 80) : ''}`);

      } else if (mode === 'baseline') {
        const result = await callWithTool({
          model,
          prompt: baselinePrompt(task),
          tool: baselineTool,
          toolChoice: { type: 'tool', name: 'record_verdict' },
          verbose,
          maxTokens: 4096,
        });

        const r = result.input;
        const status = r.verdict === 'CONFIRMED' ? 'confirmed' : 'disputed';
        if (status === 'confirmed') confirmed++;
        else disputed++;

        allResults[i] = {
          id: task.id,
          name: task.name,
          subset: task.subset,
          status,
          informalization: r.informalization,
          explanation: r.explanation,
        };

        console.error(`    ${status}${status === 'disputed' ? ': ' + r.explanation.slice(0, 80) : ''}`);

      } else if (mode === 'two-pass') {
        // Pass 1: Informalize (blind)
        const inf = await callWithTool({
          model: informalizeModel,
          prompt: informalizePrompt(task),
          tool: informalizeTool,
          toolChoice: { type: 'tool', name: 'record_informalization' },
          verbose,
          maxTokens: 4096,
        });

        const informalization = inf.input;

        if (verbose) {
          console.error(`    [inf] strength=${informalization.strength} confidence=${informalization.confidence}`);
          console.error(`    [inf] ${(informalization.naturalLanguage ?? '(none)').slice(0, 100)}...`);
        }

        // Pass 2: Compare
        const cmp = await callWithTool({
          model,
          prompt: comparePrompt(task, informalization),
          tool: compareTool,
          toolChoice: { type: 'tool', name: 'record_comparison' },
          verbose,
          maxTokens: 4096,
        });

        const comparison = cmp.input;
        const status = comparison.match ? 'confirmed' : 'disputed';
        if (status === 'confirmed') confirmed++;
        else disputed++;

        const disc = comparison.discrepancy ?? '';

        allResults[i] = {
          id: task.id,
          name: task.name,
          subset: task.subset,
          status,
          informalization,
          comparison,
          ...(disc ? { discrepancy: disc } : {}),
          ...(comparison.weakeningType && comparison.weakeningType !== 'none' ? { weakeningType: comparison.weakeningType } : {}),
        };

        console.error(`    ${status}${disc ? ': ' + disc.slice(0, 80) : ''}`);

      } else {
        throw new Error(`Unknown mode: ${mode}. Expected: naive, baseline, two-pass`);
      }
    } catch (err) {
      errors++;
      console.error(`    ERROR: ${err.message}`);
      allResults[i] = {
        id: task.id,
        name: task.name,
        subset: task.subset,
        status: 'error',
        error: err.message,
      };
    }
  }

  if (concurrency <= 1) {
    for (let i = 0; i < tasks.length; i++) {
      await processTask(i);
    }
  } else {
    let next = 0;
    const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
      while (next < tasks.length) {
        const idx = next++;
        await processTask(idx);
      }
    });
    await Promise.all(workers);
  }

  const totalElapsedMs = Date.now() - totalStart;
  const results = allResults.filter(Boolean);

  // Per-subset stats
  const bySubset = {};
  for (const r of results) {
    if (!bySubset[r.subset]) bySubset[r.subset] = { confirmed: 0, disputed: 0, errors: 0, total: 0 };
    bySubset[r.subset].total++;
    if (r.status === 'confirmed') bySubset[r.subset].confirmed++;
    else if (r.status === 'disputed') bySubset[r.subset].disputed++;
    else bySubset[r.subset].errors++;
  }

  // Dispute categories
  const disputesByType = {};
  for (const r of results) {
    if (r.status === 'disputed') {
      const t = r.weakeningType || r.comparison?.weakeningType || 'unknown';
      disputesByType[t] = (disputesByType[t] || 0) + 1;
    }
  }

  console.error(`\nConfirmed: ${confirmed}/${results.length} (${(100 * confirmed / results.length).toFixed(1)}%)`);
  console.error(`Disputed: ${disputed}/${results.length} (${(100 * disputed / results.length).toFixed(1)}%)`);
  if (errors) console.error(`Errors: ${errors}`);
  for (const [sub, stats] of Object.entries(bySubset)) {
    console.error(`  ${sub}: ${stats.confirmed}/${stats.total} confirmed (${(100 * stats.confirmed / stats.total).toFixed(1)}%)`);
  }
  if (Object.keys(disputesByType).length > 0) {
    console.error(`Dispute types: ${JSON.stringify(disputesByType)}`);
  }
  console.error(`Elapsed: ${(totalElapsedMs / 1000).toFixed(1)}s`);

  // Save
  await mkdir(RESULTS_DIR, { recursive: true });

  const output = {
    label,
    timestamp: new Date().toISOString(),
    config: {
      mode,
      model,
      ...(mode === 'two-pass' ? { informalizeModel } : {}),
      subset,
      total: results.length,
    },
    totalElapsedMs,
    confirmed,
    disputed,
    errors,
    confirmationRate: confirmed / results.length,
    bySubset,
    disputesByType,
    results,
  };

  const outPath = join(RESULTS_DIR, `${label}.json`);
  await writeFile(outPath, JSON.stringify(output, null, 2));
  console.error(`Saved: ${outPath}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
