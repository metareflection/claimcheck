#!/usr/bin/env node
/**
 * SciFact benchmark runner.
 *
 * Compares approaches on the SciFact scientific claim verification task:
 *   - baseline: model sees claim + evidence sentences, judges directly (one call)
 *   - single-prompt: model sees both, but prompted to summarize evidence first (one call)
 *   - two-pass: model summarizes evidence without seeing claim, then compares (two calls)
 *
 * Backends:
 *   - api (default): direct Anthropic API with structured tool_use output
 *   - cc: claude -p (Claude Code CLI)
 *
 * Usage:
 *   node eval/bench-scifact.js --mode baseline --label scifact-baseline --limit 10
 *   node eval/bench-scifact.js --mode two-pass --label scifact-two-pass
 *   node eval/bench-scifact.js --mode single-prompt --label scifact-single
 */

import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { callWithTool } from '../src/api.js';

const RESULTS_DIR = resolve(import.meta.dirname, 'results');
const DATA_DIR = resolve(import.meta.dirname, '../data/scifact/data');

// --- Parse args ---

const args = process.argv.slice(2);

function getArg(name, defaultVal) {
  const i = args.indexOf(name);
  if (i === -1) return defaultVal;
  return args[i + 1];
}

const mode = getArg('--mode', 'baseline');
const backend = getArg('--backend', 'api');
const label = getArg('--label', `scifact-${mode}-${Date.now()}`);
const model = getArg('--model', 'claude-sonnet-4-5-20250929');
const limit = parseInt(getArg('--limit', '0')) || 0;
const offset = parseInt(getArg('--offset', '0')) || 0;
const verbose = args.includes('--verbose');

const VERDICTS = ['SUPPORTS', 'REFUTES', 'NOT_ENOUGH_INFO'];

// --- Tool schemas ---

const verdictTool = {
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

const summarizeTool = {
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

// --- Claude Code backend ---

function callClaude(prompt) {
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

// --- Prompts ---

function baselinePrompt(claim, title, evidenceSentences) {
  return `You are a scientific fact-checker. Determine whether the highlighted evidence from a research paper supports, refutes, or is insufficient to evaluate the given claim.

## Claim

${claim}

## Evidence

**Paper title:** ${title}

**Highlighted sentences:**

${evidenceSentences.map((s, i) => `${i + 1}. ${s}`).join('\n')}

## Instructions

Assess whether the evidence SUPPORTS the claim, REFUTES it, or provides NOT_ENOUGH_INFO to determine either way.

Be precise about what the evidence actually says vs. what the claim asserts. Pay attention to:
- Directionality (increases vs decreases)
- Specificity (the evidence may be about a related but different thing)
- Strength of evidence (association vs causation)
- Scope (the evidence may cover only part of the claim)`;
}

function singlePromptPrompt(claim, title, evidenceSentences) {
  return `You are a scientific fact-checker. Determine whether the highlighted evidence from a research paper supports, refutes, or is insufficient to evaluate the given claim.

## Claim

${claim}

## Evidence

**Paper title:** ${title}

**Highlighted sentences:**

${evidenceSentences.map((s, i) => `${i + 1}. ${s}`).join('\n')}

## Instructions

Before making your verdict, you MUST complete both passes:

### Pass 1 — Summarize the Evidence (do this BEFORE evaluating the claim)

State in your own words:
- What specific factual claims does the evidence make?
- What are the key findings?
- What does the evidence NOT establish or leave unclear?

### Pass 2 — Compare to the Claim

Now compare your summary to the claim:
- Does the evidence directly address what the claim asserts?
- Is the directionality correct (increases vs decreases)?
- Is the specificity right (same entities, same context)?
- Is the strength appropriate (association vs causation)?

Verdict: SUPPORTS, REFUTES, or NOT_ENOUGH_INFO.`;
}

function summarizePrompt(title, evidenceSentences) {
  return `You are a scientific reader. Summarize what the following highlighted sentences from a research paper establish.

**Important:** You will later be asked to evaluate a claim against this evidence, but you have NOT seen the claim yet. Just summarize what the evidence says.

## Evidence

**Paper title:** ${title}

**Highlighted sentences:**

${evidenceSentences.map((s, i) => `${i + 1}. ${s}`).join('\n')}

## Instructions

Summarize:
1. What specific factual claims do these sentences make?
2. What are the key findings?
3. What do these sentences NOT establish or leave unclear?

Be precise and stick to what the text actually says.`;
}

function comparePrompt(summary, claim) {
  return `You previously summarized evidence from a research paper. Now evaluate whether it supports a scientific claim.

## Your Evidence Summary

${summary}

## Claim to Evaluate

${claim}

## Instructions

Based on your prior summary, does the evidence SUPPORT, REFUTE, or provide NOT_ENOUGH_INFO for this claim?

Be precise about:
- Directionality (increases vs decreases)
- Specificity (is the evidence about the same thing the claim asserts?)
- Strength (association vs causation)
- Scope (does the evidence cover the full claim or only part?)`;
}

// --- Parse verdict from text output ---

function parseVerdict(output) {
  const explicit = output.match(/\*?\*?Verdict:?\*?\*?\s*(SUPPORTS?|REFUTES?|NOT[_ ]ENOUGH[_ ]INFO)/i);
  if (explicit) {
    return normalizeVerdict(explicit[1]);
  }

  // Fallback: last occurrence
  const all = [...output.matchAll(/\b(SUPPORTS?|REFUTES?|NOT[_ ]ENOUGH[_ ]INFO)\b/gi)];
  if (all.length > 0) {
    return normalizeVerdict(all[all.length - 1][0]);
  }

  return null;
}

function normalizeVerdict(v) {
  v = v.toUpperCase().replace(/\s+/g, '_');
  if (v === 'SUPPORT') return 'SUPPORTS';
  if (v === 'REFUTE') return 'REFUTES';
  return v;
}

// --- Format summary for pass 2 ---

function formatSummary(toolInput) {
  const parts = [];
  if (toolInput.factual_claims?.length) {
    parts.push('**Factual claims:**');
    for (const c of toolInput.factual_claims) parts.push(`- ${c}`);
  }
  if (toolInput.key_findings) parts.push(`**Key findings:** ${toolInput.key_findings}`);
  if (toolInput.limitations) parts.push(`**Limitations:** ${toolInput.limitations}`);
  return parts.join('\n\n');
}

// --- Run one example ---

async function runBaseline(claim, title, evidenceSentences) {
  const prompt = baselinePrompt(claim, title, evidenceSentences);

  if (backend === 'api') {
    const result = await callWithTool({
      model, prompt, tool: verdictTool,
      toolChoice: { type: 'tool', name: 'record_verdict' },
      verbose,
    });
    return normalizeVerdict(result.input.verdict);
  } else {
    const output = await callClaude(prompt + '\n\nState your final verdict as: **Verdict:** SUPPORTS | REFUTES | NOT_ENOUGH_INFO');
    return parseVerdict(output);
  }
}

async function runSinglePrompt(claim, title, evidenceSentences) {
  const prompt = singlePromptPrompt(claim, title, evidenceSentences);

  if (backend === 'api') {
    const result = await callWithTool({
      model, prompt, tool: verdictTool,
      toolChoice: { type: 'tool', name: 'record_verdict' },
      verbose, maxTokens: 8192,
    });
    return normalizeVerdict(result.input.verdict);
  } else {
    const output = await callClaude(prompt + '\n\nState your final verdict as: **Verdict:** SUPPORTS | REFUTES | NOT_ENOUGH_INFO');
    return parseVerdict(output);
  }
}

async function runTwoPass(claim, title, evidenceSentences) {
  // Pass 1: summarize evidence without seeing claim
  const prompt1 = summarizePrompt(title, evidenceSentences);
  let summary;

  if (backend === 'api') {
    const result1 = await callWithTool({
      model, prompt: prompt1, tool: summarizeTool,
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
    summary = await callClaude(prompt1);
    if (verbose) {
      console.error('    --- summary ---');
      console.error(summary.slice(-500));
      console.error('    ---');
    }
  }

  // Pass 2: compare summary to claim
  const prompt2 = comparePrompt(summary, claim);

  if (backend === 'api') {
    const result2 = await callWithTool({
      model, prompt: prompt2, tool: verdictTool,
      toolChoice: { type: 'tool', name: 'record_verdict' },
      verbose,
    });
    return normalizeVerdict(result2.input.verdict);
  } else {
    const output = await callClaude(prompt2 + '\n\nState your final verdict as: **Verdict:** SUPPORTS | REFUTES | NOT_ENOUGH_INFO');
    return parseVerdict(output);
  }
}

// --- Load data ---

async function loadData() {
  // Load corpus into a map
  const corpusRaw = await readFile(join(DATA_DIR, 'corpus.jsonl'), 'utf-8');
  const corpus = new Map();
  for (const line of corpusRaw.trim().split('\n')) {
    const doc = JSON.parse(line);
    corpus.set(String(doc.doc_id), doc);
  }

  // Load dev claims
  const claimsRaw = await readFile(join(DATA_DIR, 'claims_dev.jsonl'), 'utf-8');
  const claims = [];
  for (const line of claimsRaw.trim().split('\n')) {
    claims.push(JSON.parse(line));
  }

  return { corpus, claims };
}

/**
 * Flatten claims into evaluable entries.
 * Each entry = one claim + one evidence doc + label.
 * Claims with no evidence get label NOT_ENOUGH_INFO (no evidence sentences).
 */
function flattenClaims(claims, corpus) {
  const entries = [];

  for (const claim of claims) {
    if (Object.keys(claim.evidence).length === 0) {
      // NEI claim — pick the first cited doc for context, but no rationale sentences
      const docId = String(claim.cited_doc_ids[0]);
      const doc = corpus.get(docId);
      if (!doc) continue;
      entries.push({
        id: claim.id,
        claim: claim.claim,
        docId,
        title: doc.title,
        abstract: doc.abstract,
        evidenceSentences: [],
        label: 'NOT_ENOUGH_INFO',
      });
    } else {
      // Claims with evidence — one entry per evidence doc
      for (const [docId, evidenceSets] of Object.entries(claim.evidence)) {
        const doc = corpus.get(docId);
        if (!doc) continue;

        // Merge all rationale sentence indices for this doc
        const sentenceIndices = new Set();
        let label = null;
        for (const ev of evidenceSets) {
          for (const idx of ev.sentences) sentenceIndices.add(idx);
          // Use first label (they should all agree per doc)
          if (!label) label = ev.label === 'SUPPORT' ? 'SUPPORTS' : 'REFUTES';
        }

        const evidenceSentences = [...sentenceIndices]
          .sort((a, b) => a - b)
          .map(i => doc.abstract[i])
          .filter(Boolean);

        entries.push({
          id: claim.id,
          claim: claim.claim,
          docId,
          title: doc.title,
          abstract: doc.abstract,
          evidenceSentences,
          label,
        });
      }
    }
  }

  return entries;
}

// --- Main ---

async function main() {
  const { corpus, claims } = await loadData();
  let entries = flattenClaims(claims, corpus);

  // For NEI claims without evidence sentences, we give the full abstract
  // so the model can determine there's not enough info
  for (const e of entries) {
    if (e.evidenceSentences.length === 0) {
      e.evidenceSentences = e.abstract;
    }
  }

  if (offset > 0) entries = entries.slice(offset);
  if (limit > 0) entries = entries.slice(0, limit);

  console.error(`SciFact Benchmark: ${label}`);
  console.error(`  mode: ${mode}`);
  console.error(`  backend: ${backend}`);
  console.error(`  model: ${model}`);
  console.error(`  entries: ${entries.length}${offset ? ` (offset ${offset})` : ''}`);
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
      if (mode === 'baseline') {
        verdict = await runBaseline(e.claim, e.title, e.evidenceSentences);
      } else if (mode === 'single-prompt') {
        verdict = await runSinglePrompt(e.claim, e.title, e.evidenceSentences);
      } else if (mode === 'two-pass') {
        verdict = await runTwoPass(e.claim, e.title, e.evidenceSentences);
      } else {
        throw new Error(`Unknown mode: ${mode}. Expected: baseline, single-prompt, two-pass`);
      }
    } catch (err) {
      error = err.message;
      console.error(`    ERROR: ${error}`);
    }

    const elapsedMs = Date.now() - start;
    const isCorrect = verdict === e.label;
    if (isCorrect) correct++;

    const tag = isCorrect ? 'CORRECT' : verdict ? 'WRONG' : 'PARSE_FAILED';
    console.error(`    ${tag}: "${verdict}" (expected "${e.label}") (${(elapsedMs / 1000).toFixed(1)}s)`);

    allResults.push({
      claimId: e.id,
      claim: e.claim,
      docId: e.docId,
      expected: e.label,
      verdict,
      correct: isCorrect,
      elapsedMs,
      ...(error ? { error } : {}),
    });
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

  // --- Save results ---

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

main().catch(err => {
  console.error(err);
  process.exit(1);
});
