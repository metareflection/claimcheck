#!/usr/bin/env node
/**
 * AVeriTeC benchmark runner.
 *
 * Compares approaches on the AVeriTeC real-world claim verification task:
 *   - baseline: model sees claim + evidence sentences, judges directly (one call)
 *   - single-prompt: model sees both, but prompted to summarize evidence first (one call)
 *   - two-pass: model summarizes evidence without seeing claim, then compares (two calls)
 *
 * AVeriTeC contains real-world claims verified via Q&A-style web evidence.
 * The CONFLICTING_EVIDENCE/CHERRYPICKING label (~7.6%) is mapped to
 * NOT_ENOUGH_INFO for 3-way evaluation.
 *
 * Usage:
 *   node eval/bench-averitec.js --mode baseline --label averitec-baseline
 *   node eval/bench-averitec.js --mode two-pass --label averitec-two-pass
 *   node eval/bench-averitec.js --mode grounded --label averitec-grounded --limit 10
 */

import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import {
  parseArgs, sampleEntries, runBench, groundedInstructions,
} from './lib/bench-common.js';

const DATA_DIR = resolve(import.meta.dirname, '../data/averitec');
const config = parseArgs('averitec');

// Map CONFLICTING_EVIDENCE/CHERRYPICKING → NOT_ENOUGH_INFO for 3-way evaluation
function normalizeLabel(label) {
  if (label === 'CONFLICTING_EVIDENCE/CHERRYPICKING') return 'NOT_ENOUGH_INFO';
  return label;
}

// --- Prompts ---

function baselinePrompt(claim, evidenceSentences) {
  return `You are a fact-checker verifying real-world claims using evidence gathered from the web. Determine whether the provided evidence supports, refutes, or is insufficient to evaluate the given claim.

## Claim

${claim}

## Evidence

${evidenceSentences.map((s, i) => `${i + 1}. ${s}`).join('\n')}

## Instructions

Assess whether the evidence SUPPORTS the claim, REFUTES it, or provides NOT_ENOUGH_INFO to determine either way.

Be precise about what the evidence actually says vs. what the claim asserts. Pay attention to:
- Source credibility (satirical, fictional, or unreliable sources)
- Specific facts (names, dates, numbers, locations)
- Context (claims may be taken out of context or exaggerated)
- Completeness (the evidence may address only part of the claim)`;
}

function singlePromptPrompt(claim, evidenceSentences) {
  return `You are a fact-checker verifying real-world claims using evidence gathered from the web. Determine whether the provided evidence supports, refutes, or is insufficient to evaluate the given claim.

## Claim

${claim}

## Evidence

${evidenceSentences.map((s, i) => `${i + 1}. ${s}`).join('\n')}

## Instructions

Before making your verdict, you MUST complete both passes:

### Pass 1 — Summarize the Evidence (do this BEFORE evaluating the claim)

State in your own words:
- What specific facts does the evidence establish?
- What are the key findings or information?
- What does the evidence NOT establish or leave unclear?

### Pass 2 — Compare to the Claim

Now compare your summary to the claim:
- Does the evidence directly address what the claim asserts?
- Are the specific facts correct (names, dates, numbers)?
- Is the source reliable (not satirical, fictional, or misleading)?
- Is the context right?

Verdict: SUPPORTS, REFUTES, or NOT_ENOUGH_INFO.`;
}

function groundedPrompt(claim, evidenceSentences, flags) {
  return `You are a fact-checker verifying real-world claims using evidence gathered from the web. Determine whether the evidence supports, refutes, or is insufficient to evaluate the claim.

## Claim

${claim}

## Evidence

${evidenceSentences.map((s, i) => `${i + 1}. ${s}`).join('\n')}

## Instructions

${groundedInstructions(flags)}`;
}

function summarizePrompt(evidenceSentences) {
  return `You are a careful reader. Summarize what the following evidence gathered from the web establishes.

**Important:** You will later be asked to evaluate a claim against this evidence, but you have NOT seen the claim yet. Just summarize what the evidence says.

## Evidence

${evidenceSentences.map((s, i) => `${i + 1}. ${s}`).join('\n')}

## Instructions

Summarize:
1. What specific facts do these sentences establish?
2. What key information is provided?
3. What do these sentences NOT establish or leave unclear?
4. Are there any cues about source reliability (satirical sites, fictional content, etc.)?

Be precise and stick to what the text actually says.`;
}

function comparePrompt(summary, claim) {
  return `You previously summarized evidence gathered from the web. Now evaluate whether it supports a real-world claim.

## Your Evidence Summary

${summary}

## Claim to Evaluate

${claim}

## Instructions

Based on your prior summary, does the evidence SUPPORT, REFUTE, or provide NOT_ENOUGH_INFO for this claim?

Be precise about:
- Specific facts (names, dates, numbers, locations)
- Source reliability (satirical, fictional, or unreliable sources undermine claims)
- Context (is the claim taken out of context or exaggerated?)
- Completeness (does the evidence cover the full claim?)`;
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
      justification: row.justification || '',
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
    benchName: 'AVeriTeC',
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
    entryToResult(e, verdict, isCorrect, elapsedMs, error, grounded) {
      return {
        id: e.id,
        claim: e.claim,
        expected: e.label,
        verdict,
        correct: isCorrect,
        elapsedMs,
        justification: e.justification,
        ...(grounded ? { grounded } : {}),
        ...(error ? { error } : {}),
      };
    },
  });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
