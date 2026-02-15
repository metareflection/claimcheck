#!/usr/bin/env node
/**
 * FEVER benchmark runner.
 *
 * Compares approaches on the FEVER fact verification task (Wikipedia claims):
 *   - baseline: model sees claim + evidence sentences, judges directly (one call)
 *   - single-prompt: model sees both, but prompted to summarize evidence first (one call)
 *   - two-pass: model summarizes evidence without seeing claim, then compares (two calls)
 *
 * Usage:
 *   node eval/bench-fever.js --mode baseline --label fever-baseline --sample 500
 *   node eval/bench-fever.js --mode two-pass --label fever-two-pass
 *   node eval/bench-fever.js --mode baseline --limit 10
 */

import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import {
  parseArgs, sampleEntries, runBench,
} from './lib/bench-common.js';

const DATA_DIR = resolve(import.meta.dirname, '../data/fever');
const config = parseArgs('fever');
// Default sample of 500 for FEVER (large dataset)
if (!config.sample && !config.limit) config.sample = 500;

// --- Prompts ---

function baselinePrompt(claim, evidenceSentences) {
  return `You are a fact-checker. Determine whether the provided evidence from Wikipedia supports, refutes, or is insufficient to evaluate the given claim.

## Claim

${claim}

## Evidence

${evidenceSentences.map((s, i) => `${i + 1}. ${s}`).join('\n')}

## Instructions

Assess whether the evidence SUPPORTS the claim, REFUTES it, or provides NOT_ENOUGH_INFO to determine either way.

Be precise about what the evidence actually says vs. what the claim asserts. Pay attention to:
- Specific facts (names, dates, numbers)
- Scope (the evidence may cover only part of the claim)
- Negation and qualifiers`;
}

function singlePromptPrompt(claim, evidenceSentences) {
  return `You are a fact-checker. Determine whether the provided evidence from Wikipedia supports, refutes, or is insufficient to evaluate the given claim.

## Claim

${claim}

## Evidence

${evidenceSentences.map((s, i) => `${i + 1}. ${s}`).join('\n')}

## Instructions

Before making your verdict, you MUST complete both passes:

### Pass 1 — Summarize the Evidence (do this BEFORE evaluating the claim)

State in your own words:
- What specific facts does the evidence establish?
- What key information is provided?
- What does the evidence NOT establish or leave unclear?

### Pass 2 — Compare to the Claim

Now compare your summary to the claim:
- Does the evidence directly address what the claim asserts?
- Are the specific facts correct (names, dates, numbers)?
- Is the scope right?

Verdict: SUPPORTS, REFUTES, or NOT_ENOUGH_INFO.`;
}

function groundedPrompt(claim, evidenceSentences) {
  return `You are a fact-checker. Determine whether the evidence from Wikipedia supports, refutes, or is insufficient to evaluate the claim.

## Claim

${claim}

## Evidence

${evidenceSentences.map((s, i) => `${i + 1}. ${s}`).join('\n')}

## Instructions

1. Break the claim into its distinct assertions.
2. For each assertion, quote the specific evidence span that addresses it (or state "no relevant evidence").
3. State whether that span SUPPORTS, CONTRADICTS, or provides NO_EVIDENCE for the assertion.
4. Derive the final verdict:
   - All assertions supported → SUPPORTS
   - Any contradiction → REFUTES
   - Insufficient coverage → NOT_ENOUGH_INFO

You must cite evidence before judging. No citation, no claim of support.`;
}

function summarizePrompt(evidenceSentences) {
  return `You are a careful reader. Summarize what the following evidence sentences from Wikipedia establish.

**Important:** You will later be asked to evaluate a claim against this evidence, but you have NOT seen the claim yet. Just summarize what the evidence says.

## Evidence

${evidenceSentences.map((s, i) => `${i + 1}. ${s}`).join('\n')}

## Instructions

Summarize:
1. What specific facts do these sentences establish?
2. What key information is provided?
3. What do these sentences NOT establish or leave unclear?

Be precise and stick to what the text actually says.`;
}

function comparePrompt(summary, claim) {
  return `You previously summarized evidence from Wikipedia. Now evaluate whether it supports a claim.

## Your Evidence Summary

${summary}

## Claim to Evaluate

${claim}

## Instructions

Based on your prior summary, does the evidence SUPPORT, REFUTE, or provide NOT_ENOUGH_INFO for this claim?

Be precise about:
- Specific facts (names, dates, numbers)
- Scope (does the evidence cover the full claim or only part?)
- Negation and qualifiers`;
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
      label: row.label,
      evidenceSentences: row.evidence_sentences,
    });
  }

  return entries;
}

// --- Main ---

async function main() {
  let entries = await loadData();

  // Filter out entries with no evidence for SUPPORTS/REFUTES
  // (NOT_ENOUGH_INFO claims legitimately have no evidence)
  entries = entries.filter(e =>
    e.label === 'NOT_ENOUGH_INFO' || e.evidenceSentences.length > 0
  );

  if (config.sample > 0) entries = sampleEntries(entries, config.sample, config.seed);
  if (config.offset > 0) entries = entries.slice(config.offset);
  if (config.limit > 0) entries = entries.slice(0, config.limit);

  await runBench({
    benchName: 'FEVER',
    config,
    entries,
    makePrompts(e) {
      const ev = e.evidenceSentences.length > 0
        ? e.evidenceSentences
        : ['[No specific evidence provided]'];
      return {
        baseline: baselinePrompt(e.claim, ev),
        singlePrompt: singlePromptPrompt(e.claim, ev),
        summarize: summarizePrompt(ev),
        compare: (summary) => comparePrompt(summary, e.claim),
        grounded: groundedPrompt(e.claim, ev),
      };
    },
  });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
