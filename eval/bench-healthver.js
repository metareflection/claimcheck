#!/usr/bin/env node
/**
 * HealthVer benchmark runner.
 *
 * Compares approaches on the HealthVer health claim verification task:
 *   - baseline: model sees claim + evidence sentences, judges directly (one call)
 *   - single-prompt: model sees both, but prompted to summarize evidence first (one call)
 *   - two-pass: model summarizes evidence without seeing claim, then compares (two calls)
 *
 * HealthVer verifies health/COVID-19 claims against PubMed abstracts,
 * making it complementary to SciFact (same domain, different source).
 *
 * Usage:
 *   node eval/bench-healthver.js --mode baseline --label healthver-baseline
 *   node eval/bench-healthver.js --mode two-pass --label healthver-two-pass
 *   node eval/bench-healthver.js --mode baseline --limit 10
 */

import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import {
  parseArgs, sampleEntries, runBench,
} from './lib/bench-common.js';

const DATA_DIR = resolve(import.meta.dirname, '../data/healthver');
const config = parseArgs('healthver');

// --- Prompts (scientific domain, similar to SciFact) ---

function baselinePrompt(claim, title, evidenceSentences) {
  return `You are a scientific fact-checker specializing in health claims. Determine whether the highlighted evidence from a research paper supports, refutes, or is insufficient to evaluate the given claim.

## Claim

${claim}

## Evidence

**Paper title:** ${title}

**Evidence sentences:**

${evidenceSentences.map((s, i) => `${i + 1}. ${s}`).join('\n')}

## Instructions

Assess whether the evidence SUPPORTS the claim, REFUTES it, or provides NOT_ENOUGH_INFO to determine either way.

Be precise about what the evidence actually says vs. what the claim asserts. Pay attention to:
- Directionality (increases vs decreases, effective vs ineffective)
- Specificity (the evidence may be about a related but different condition or treatment)
- Strength of evidence (association vs causation, preliminary vs conclusive)
- Scope (the evidence may cover only part of the claim)`;
}

function singlePromptPrompt(claim, title, evidenceSentences) {
  return `You are a scientific fact-checker specializing in health claims. Determine whether the highlighted evidence from a research paper supports, refutes, or is insufficient to evaluate the given claim.

## Claim

${claim}

## Evidence

**Paper title:** ${title}

**Evidence sentences:**

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
- Is the directionality correct?
- Is the specificity right (same condition, treatment, population)?
- Is the strength appropriate (association vs causation)?

Verdict: SUPPORTS, REFUTES, or NOT_ENOUGH_INFO.`;
}

function groundedPrompt(claim, title, evidenceSentences) {
  return `You are a scientific fact-checker specializing in health claims. Determine whether the evidence from a research paper supports, refutes, or is insufficient to evaluate the claim.

## Claim

${claim}

## Evidence

**Paper title:** ${title}

**Evidence sentences:**

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

function summarizePrompt(title, evidenceSentences) {
  return `You are a scientific reader. Summarize what the following evidence sentences from a research paper establish.

**Important:** You will later be asked to evaluate a claim against this evidence, but you have NOT seen the claim yet. Just summarize what the evidence says.

## Evidence

**Paper title:** ${title}

**Evidence sentences:**

${evidenceSentences.map((s, i) => `${i + 1}. ${s}`).join('\n')}

## Instructions

Summarize:
1. What specific factual claims do these sentences make?
2. What are the key findings?
3. What do these sentences NOT establish or leave unclear?

Be precise and stick to what the text actually says.`;
}

function comparePrompt(summary, claim) {
  return `You previously summarized evidence from a research paper. Now evaluate whether it supports a health claim.

## Your Evidence Summary

${summary}

## Claim to Evaluate

${claim}

## Instructions

Based on your prior summary, does the evidence SUPPORT, REFUTE, or provide NOT_ENOUGH_INFO for this claim?

Be precise about:
- Directionality (increases vs decreases, effective vs ineffective)
- Specificity (is the evidence about the same condition/treatment the claim asserts?)
- Strength (association vs causation, preliminary vs conclusive)
- Scope (does the evidence cover the full claim or only part?)`;
}

// --- Load data ---

async function loadData() {
  const raw = await readFile(join(DATA_DIR, 'dev.jsonl'), 'utf-8');
  const entries = [];

  for (const line of raw.trim().split('\n')) {
    const row = JSON.parse(line);

    // Use evidence_sentences if available, otherwise fall back to abstract
    const evidenceSentences = row.evidence_sentences?.length > 0
      ? row.evidence_sentences
      : row.abstract || [];

    entries.push({
      id: row.id,
      claim: row.claim,
      title: row.title || '',
      evidenceSentences,
      abstract: row.abstract || [],
      label: row.label,
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
    benchName: 'HealthVer',
    config,
    entries,
    makePrompts(e) {
      const ev = e.evidenceSentences.length > 0
        ? e.evidenceSentences
        : e.abstract.length > 0 ? e.abstract : ['[No specific evidence provided]'];
      return {
        baseline: baselinePrompt(e.claim, e.title, ev),
        singlePrompt: singlePromptPrompt(e.claim, e.title, ev),
        summarize: summarizePrompt(e.title, ev),
        compare: (summary) => comparePrompt(summary, e.claim),
        grounded: groundedPrompt(e.claim, e.title, ev),
      };
    },
    entryToResult(e, verdict, isCorrect, elapsedMs, error) {
      return {
        id: e.id,
        claim: e.claim,
        title: e.title,
        expected: e.label,
        verdict,
        correct: isCorrect,
        elapsedMs,
        ...(error ? { error } : {}),
      };
    },
  });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
