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

import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { parseArgs, runBench, groundedInstructions } from './lib/bench-common.js';

const DATA_DIR = resolve(import.meta.dirname, '../data/scifact/data');
const config = parseArgs('scifact');

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

function groundedPrompt(claim, title, evidenceSentences, flags) {
  return `You are a scientific fact-checker. Determine whether the evidence from a research paper supports, refutes, or is insufficient to evaluate the claim.

## Claim

${claim}

## Evidence

**Paper title:** ${title}

**Highlighted sentences:**

${evidenceSentences.map((s, i) => `${i + 1}. ${s}`).join('\n')}

## Instructions

${groundedInstructions(flags)}`;
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

  if (config.offset > 0) entries = entries.slice(config.offset);
  if (config.limit > 0) entries = entries.slice(0, config.limit);

  await runBench({
    benchName: 'SciFact',
    config,
    entries,
    makePrompts(e) {
      return {
        baseline: baselinePrompt(e.claim, e.title, e.evidenceSentences),
        singlePrompt: singlePromptPrompt(e.claim, e.title, e.evidenceSentences),
        summarize: summarizePrompt(e.title, e.evidenceSentences),
        compare: (summary) => comparePrompt(summary, e.claim),
        grounded: groundedPrompt(e.claim, e.title, e.evidenceSentences, config),
      };
    },
    entryToResult(e, verdict, isCorrect, elapsedMs, error) {
      return {
        claimId: e.id,
        claim: e.claim,
        docId: e.docId,
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
