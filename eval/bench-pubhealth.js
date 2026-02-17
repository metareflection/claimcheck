#!/usr/bin/env node
/**
 * PubHealth benchmark runner.
 *
 * Compares approaches on the PubHealth public health claim verification task:
 *   - baseline: model sees claim + evidence sentences, judges directly (one call)
 *   - single-prompt: model sees both, but prompted to summarize evidence first (one call)
 *   - two-pass: model summarizes evidence without seeing claim, then compares (two calls)
 *
 * PubHealth contains public health claims verified by journalists.
 * The MIXTURE label (~15%) is mapped to NOT_ENOUGH_INFO for 3-way evaluation.
 * Entries with malformed labels are filtered out.
 *
 * Usage:
 *   node eval/bench-pubhealth.js --mode baseline --label pubhealth-baseline --sample 500
 *   node eval/bench-pubhealth.js --mode two-pass --label pubhealth-two-pass
 *   node eval/bench-pubhealth.js --mode grounded --label pubhealth-grounded --limit 10
 */

import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import {
  parseArgs, sampleEntries, runBench, groundedInstructions,
} from './lib/bench-common.js';

const DATA_DIR = resolve(import.meta.dirname, '../data/pubhealth');
const config = parseArgs('pubhealth');
// Default sample of 500 for PubHealth (2,454 entries)
if (!config.sample && !config.limit) config.sample = 500;

const VALID_LABELS = new Set(['SUPPORTS', 'REFUTES', 'NOT_ENOUGH_INFO', 'MIXTURE']);

// Map MIXTURE → NOT_ENOUGH_INFO for 3-way evaluation
function normalizeLabel(label) {
  if (label === 'MIXTURE') return 'NOT_ENOUGH_INFO';
  return label;
}

// --- Prompts ---

function baselinePrompt(claim, evidenceSentences) {
  return `You are a public health fact-checker. Determine whether the provided evidence from journalist investigations supports, refutes, or is insufficient to evaluate the given health claim.

## Claim

${claim}

## Evidence

${evidenceSentences.map((s, i) => `${i + 1}. ${s}`).join('\n')}

## Instructions

Assess whether the evidence SUPPORTS the claim, REFUTES it, or provides NOT_ENOUGH_INFO to determine either way.

Be precise about what the evidence actually says vs. what the claim asserts. Pay attention to:
- Health-specific accuracy (medical claims require precise evidence)
- Source credibility and verification status
- Scope (the evidence may cover only part of the claim)
- Nuance (health claims are often partially true or misleading)`;
}

function singlePromptPrompt(claim, evidenceSentences) {
  return `You are a public health fact-checker. Determine whether the provided evidence from journalist investigations supports, refutes, or is insufficient to evaluate the given health claim.

## Claim

${claim}

## Evidence

${evidenceSentences.map((s, i) => `${i + 1}. ${s}`).join('\n')}

## Instructions

Before making your verdict, you MUST complete both passes:

### Pass 1 — Summarize the Evidence (do this BEFORE evaluating the claim)

State in your own words:
- What specific facts does the evidence establish?
- What did the investigation find?
- What does the evidence NOT establish or leave unclear?

### Pass 2 — Compare to the Claim

Now compare your summary to the claim:
- Does the evidence directly address what the claim asserts?
- Are the health-related details accurate?
- Is the scope right (same condition, treatment, or population)?

Verdict: SUPPORTS, REFUTES, or NOT_ENOUGH_INFO.`;
}

function groundedPrompt(claim, evidenceSentences, flags) {
  return `You are a public health fact-checker. Determine whether the evidence from journalist investigations supports, refutes, or is insufficient to evaluate the claim.

## Claim

${claim}

## Evidence

${evidenceSentences.map((s, i) => `${i + 1}. ${s}`).join('\n')}

## Instructions

${groundedInstructions(flags)}`;
}

function summarizePrompt(evidenceSentences) {
  return `You are a careful reader. Summarize what the following evidence from a journalist investigation establishes.

**Important:** You will later be asked to evaluate a claim against this evidence, but you have NOT seen the claim yet. Just summarize what the evidence says.

## Evidence

${evidenceSentences.map((s, i) => `${i + 1}. ${s}`).join('\n')}

## Instructions

Summarize:
1. What specific facts do these sentences establish?
2. What did the investigation find?
3. What do these sentences NOT establish or leave unclear?

Be precise and stick to what the text actually says.`;
}

function comparePrompt(summary, claim) {
  return `You previously summarized evidence from a journalist investigation. Now evaluate whether it supports a public health claim.

## Your Evidence Summary

${summary}

## Claim to Evaluate

${claim}

## Instructions

Based on your prior summary, does the evidence SUPPORT, REFUTE, or provide NOT_ENOUGH_INFO for this claim?

Be precise about:
- Health-specific accuracy (medical claims require precise evidence)
- Source credibility and verification status
- Scope (does the evidence cover the full claim or only part?)
- Nuance (health claims are often partially true or misleading)`;
}

// --- Load data ---

async function loadData() {
  const raw = await readFile(join(DATA_DIR, 'dev.jsonl'), 'utf-8');
  const entries = [];

  for (const line of raw.trim().split('\n')) {
    const row = JSON.parse(line);

    // Filter out entries with malformed labels
    if (!VALID_LABELS.has(row.label)) continue;

    entries.push({
      id: row.id,
      claim: row.claim,
      label: normalizeLabel(row.label),
      evidenceSentences: row.evidence_sentences || [],
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
    benchName: 'PubHealth',
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
        grounded: groundedPrompt(e.claim, ev, config),
      };
    },
  });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
