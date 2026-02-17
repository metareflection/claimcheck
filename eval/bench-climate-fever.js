#!/usr/bin/env node
/**
 * Climate-FEVER benchmark runner.
 *
 * Compares approaches on the Climate-FEVER climate claim verification task:
 *   - baseline: model sees claim + evidence sentences, judges directly (one call)
 *   - single-prompt: model sees both, but prompted to summarize evidence first (one call)
 *   - two-pass: model summarizes evidence without seeing claim, then compares (two calls)
 *
 * Climate-FEVER verifies climate-related claims against Wikipedia evidence,
 * with per-evidence source labels. The DISPUTED label (~10%) is mapped to
 * NOT_ENOUGH_INFO for 3-way evaluation.
 *
 * Usage:
 *   node eval/bench-climate-fever.js --mode baseline --label cf-baseline --sample 500
 *   node eval/bench-climate-fever.js --mode two-pass --label cf-two-pass
 *   node eval/bench-climate-fever.js --mode grounded --label cf-grounded --limit 10
 */

import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import {
  parseArgs, sampleEntries, runBench, groundedInstructions,
} from './lib/bench-common.js';

const DATA_DIR = resolve(import.meta.dirname, '../data/climate-fever');
const config = parseArgs('climate-fever');
// Default sample of 500 for Climate-FEVER (1,535 entries)
if (!config.sample && !config.limit) config.sample = 500;

// Map DISPUTED → NOT_ENOUGH_INFO for 3-way evaluation
function normalizeLabel(label) {
  if (label === 'DISPUTED') return 'NOT_ENOUGH_INFO';
  return label;
}

// --- Prompts ---

function baselinePrompt(claim, evidenceSentences, sources) {
  const sourceNote = sources.length > 0
    ? `\n\n**Sources:** ${[...new Set(sources.map(s => s.article))].join(', ')}`
    : '';
  return `You are a fact-checker specializing in climate and environmental claims. Determine whether the provided evidence from Wikipedia supports, refutes, or is insufficient to evaluate the given claim.

## Claim

${claim}

## Evidence
${sourceNote}

**Evidence sentences:**

${evidenceSentences.map((s, i) => `${i + 1}. ${s}`).join('\n')}

## Instructions

Assess whether the evidence SUPPORTS the claim, REFUTES it, or provides NOT_ENOUGH_INFO to determine either way.

Be precise about what the evidence actually says vs. what the claim asserts. Pay attention to:
- Scientific consensus vs. fringe claims
- Specificity (the evidence may address a related but different aspect of climate science)
- Scope (the evidence may cover only part of the claim)
- Causation vs. correlation`;
}

function singlePromptPrompt(claim, evidenceSentences, sources) {
  const sourceNote = sources.length > 0
    ? `\n\n**Sources:** ${[...new Set(sources.map(s => s.article))].join(', ')}`
    : '';
  return `You are a fact-checker specializing in climate and environmental claims. Determine whether the provided evidence from Wikipedia supports, refutes, or is insufficient to evaluate the given claim.

## Claim

${claim}

## Evidence
${sourceNote}

**Evidence sentences:**

${evidenceSentences.map((s, i) => `${i + 1}. ${s}`).join('\n')}

## Instructions

Before making your verdict, you MUST complete both passes:

### Pass 1 — Summarize the Evidence (do this BEFORE evaluating the claim)

State in your own words:
- What specific facts does the evidence establish about climate or the environment?
- What key findings or data are presented?
- What does the evidence NOT establish or leave unclear?

### Pass 2 — Compare to the Claim

Now compare your summary to the claim:
- Does the evidence directly address what the claim asserts?
- Is the scientific basis correct?
- Is the scope right (same phenomenon, same timeframe)?

Verdict: SUPPORTS, REFUTES, or NOT_ENOUGH_INFO.`;
}

function groundedPrompt(claim, evidenceSentences, sources, flags) {
  const sourceNote = sources.length > 0
    ? `\n\n**Sources:** ${[...new Set(sources.map(s => s.article))].join(', ')}`
    : '';
  return `You are a fact-checker specializing in climate and environmental claims. Determine whether the evidence from Wikipedia supports, refutes, or is insufficient to evaluate the claim.

## Claim

${claim}

## Evidence
${sourceNote}

**Evidence sentences:**

${evidenceSentences.map((s, i) => `${i + 1}. ${s}`).join('\n')}

## Instructions

${groundedInstructions(flags)}`;
}

function summarizePrompt(evidenceSentences, sources) {
  const sourceNote = sources.length > 0
    ? `\n\n**Sources:** ${[...new Set(sources.map(s => s.article))].join(', ')}`
    : '';
  return `You are a careful reader. Summarize what the following evidence sentences from Wikipedia establish about climate or the environment.

**Important:** You will later be asked to evaluate a claim against this evidence, but you have NOT seen the claim yet. Just summarize what the evidence says.

## Evidence
${sourceNote}

**Evidence sentences:**

${evidenceSentences.map((s, i) => `${i + 1}. ${s}`).join('\n')}

## Instructions

Summarize:
1. What specific facts do these sentences establish?
2. What key data or scientific findings are presented?
3. What do these sentences NOT establish or leave unclear?

Be precise and stick to what the text actually says.`;
}

function comparePrompt(summary, claim) {
  return `You previously summarized evidence from Wikipedia. Now evaluate whether it supports a climate-related claim.

## Your Evidence Summary

${summary}

## Claim to Evaluate

${claim}

## Instructions

Based on your prior summary, does the evidence SUPPORT, REFUTE, or provide NOT_ENOUGH_INFO for this claim?

Be precise about:
- Scientific consensus vs. fringe claims
- Specificity (is the evidence about the same aspect of climate science?)
- Scope (does the evidence cover the full claim or only part?)
- Causation vs. correlation`;
}

// --- Load data ---

async function loadData() {
  const raw = await readFile(join(DATA_DIR, 'dev.jsonl'), 'utf-8');
  const entries = [];

  for (const line of raw.trim().split('\n')) {
    const row = JSON.parse(line);
    entries.push({
      id: row.id,
      claim: row.claim,
      label: normalizeLabel(row.label),
      evidenceSentences: row.evidence_sentences || [],
      sources: row.evidence_sources || [],
    });
  }

  return entries;
}

// --- Main ---

async function main() {
  let entries = await loadData();

  if (config.sample > 0) entries = sampleEntries(entries, config.sample, config.seed);
  if (config.offset > 0) entries = entries.slice(config.offset);
  if (config.limit > 0) entries = entries.slice(0, config.limit);

  await runBench({
    benchName: 'Climate-FEVER',
    config,
    entries,
    makePrompts(e) {
      const ev = e.evidenceSentences.length > 0
        ? e.evidenceSentences
        : ['[No specific evidence provided]'];
      return {
        baseline: baselinePrompt(e.claim, ev, e.sources),
        singlePrompt: singlePromptPrompt(e.claim, ev, e.sources),
        summarize: summarizePrompt(ev, e.sources),
        compare: (summary) => comparePrompt(summary, e.claim),
        grounded: groundedPrompt(e.claim, ev, e.sources, config),
      };
    },
  });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
