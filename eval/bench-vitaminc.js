#!/usr/bin/env node
/**
 * VitaminC benchmark runner.
 *
 * Compares approaches on the VitaminC contrastive fact verification task:
 *   - baseline: model sees claim + evidence passage, judges directly (one call)
 *   - single-prompt: model sees both, but prompted to summarize evidence first (one call)
 *   - two-pass: model summarizes evidence without seeing claim, then compares (two calls)
 *
 * VitaminC uses contrastive evidence pairs where minimal edits flip the label,
 * making it a strong test of whether two-pass prevents anchoring bias.
 *
 * Usage:
 *   node eval/bench-vitaminc.js --mode baseline --label vitaminc-baseline --sample 500
 *   node eval/bench-vitaminc.js --mode two-pass --label vitaminc-two-pass
 *   node eval/bench-vitaminc.js --mode baseline --limit 10
 */

import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import {
  parseArgs, sampleEntries, runBench,
} from './lib/bench-common.js';

const DATA_DIR = resolve(import.meta.dirname, '../data/vitaminc');
const config = parseArgs('vitaminc');
// Default sample of 500 for VitaminC (large dataset)
if (!config.sample && !config.limit) config.sample = 500;

// --- Prompts ---

function baselinePrompt(claim, evidence, page) {
  const pageNote = page ? `\n\n**Source:** ${page.replace(/_/g, ' ')}` : '';
  return `You are a fact-checker. Determine whether the provided evidence supports, refutes, or is insufficient to evaluate the given claim.

## Claim

${claim}

## Evidence
${pageNote}
${evidence}

## Instructions

Assess whether the evidence SUPPORTS the claim, REFUTES it, or provides NOT_ENOUGH_INFO to determine either way.

Be precise about what the evidence actually says vs. what the claim asserts. Pay close attention to:
- Specific numbers, dates, and names (small differences matter)
- Qualifiers and hedging language
- Scope (the evidence may cover only part of the claim)`;
}

function singlePromptPrompt(claim, evidence, page) {
  const pageNote = page ? `\n\n**Source:** ${page.replace(/_/g, ' ')}` : '';
  return `You are a fact-checker. Determine whether the provided evidence supports, refutes, or is insufficient to evaluate the given claim.

## Claim

${claim}

## Evidence
${pageNote}
${evidence}

## Instructions

Before making your verdict, you MUST complete both passes:

### Pass 1 — Summarize the Evidence (do this BEFORE evaluating the claim)

State in your own words:
- What specific facts does the evidence establish?
- What key numbers, dates, or names are mentioned?
- What does the evidence NOT establish or leave unclear?

### Pass 2 — Compare to the Claim

Now compare your summary to the claim:
- Does the evidence directly address what the claim asserts?
- Do the specific details match exactly?
- Are there subtle differences in numbers, dates, or scope?

Verdict: SUPPORTS, REFUTES, or NOT_ENOUGH_INFO.`;
}

function groundedPrompt(claim, evidence, page) {
  const pageNote = page ? `\n\n**Source:** ${page.replace(/_/g, ' ')}` : '';
  return `You are a fact-checker. Determine whether the evidence supports, refutes, or is insufficient to evaluate the claim.

## Claim

${claim}

## Evidence
${pageNote}
${evidence}

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

function summarizePrompt(evidence, page) {
  const pageNote = page ? `\n\n**Source:** ${page.replace(/_/g, ' ')}` : '';
  return `You are a careful reader. Summarize what the following evidence passage establishes.

**Important:** You will later be asked to evaluate a claim against this evidence, but you have NOT seen the claim yet. Just summarize what the evidence says.

## Evidence
${pageNote}
${evidence}

## Instructions

Summarize:
1. What specific facts does this passage establish?
2. What key numbers, dates, or names are mentioned?
3. What does this passage NOT establish or leave unclear?

Be precise and stick to what the text actually says. Pay special attention to exact numbers and dates.`;
}

function comparePrompt(summary, claim) {
  return `You previously summarized an evidence passage. Now evaluate whether it supports a claim.

## Your Evidence Summary

${summary}

## Claim to Evaluate

${claim}

## Instructions

Based on your prior summary, does the evidence SUPPORT, REFUTE, or provide NOT_ENOUGH_INFO for this claim?

Be precise about:
- Specific numbers, dates, and names (small differences matter)
- Qualifiers and hedging
- Scope (does the evidence cover the full claim?)`;
}

// --- Load data ---

async function loadData() {
  const raw = await readFile(join(DATA_DIR, 'val.jsonl'), 'utf-8');
  const entries = [];

  for (const line of raw.trim().split('\n')) {
    const row = JSON.parse(line);
    entries.push({
      id: row.id,
      claim: row.claim,
      label: row.label,
      evidence: row.evidence,
      page: row.page || '',
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
    benchName: 'VitaminC',
    config,
    entries,
    makePrompts(e) {
      return {
        baseline: baselinePrompt(e.claim, e.evidence, e.page),
        singlePrompt: singlePromptPrompt(e.claim, e.evidence, e.page),
        summarize: summarizePrompt(e.evidence, e.page),
        compare: (summary) => comparePrompt(summary, e.claim),
        grounded: groundedPrompt(e.claim, e.evidence, e.page),
      };
    },
  });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
