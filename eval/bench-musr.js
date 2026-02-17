#!/usr/bin/env node
/**
 * MuSR Murder Mystery benchmark runner.
 *
 * Compares approaches on MuSR murder mysteries (binary choice, ~5500 chars):
 *   - baseline: model sees story + question + choices, answers directly
 *   - single-prompt: model sees everything, prompt instructs analyze-then-choose
 *   - grounded: model must quote specific clues, analyze each, then answer
 *   - grounded --contrastive: adds per-choice evaluation before answering
 *
 * Usage:
 *   node eval/bench-musr.js --mode baseline --concurrency 10 --label musr-baseline
 *   node eval/bench-musr.js --mode grounded --concurrency 10 --label musr-grounded
 *   node eval/bench-musr.js --mode grounded --contrastive --concurrency 10 --label musr-grounded-contrastive
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { callWithTool } from '../src/api.js';

const RESULTS_DIR = resolve(import.meta.dirname, 'results');
const TASK_PATH = resolve(import.meta.dirname, '../../MuSR/datasets/murder_mystery.json');

// --- Parse args ---

const args = process.argv.slice(2);

function getArg(name, defaultVal) {
  const i = args.indexOf(name);
  if (i === -1) return defaultVal;
  return args[i + 1];
}

const mode = getArg('--mode', 'baseline');
const label = getArg('--label', `musr-${mode}-${Date.now()}`);
const model = getArg('--model', 'claude-sonnet-4-5-20250929');
const limit = parseInt(getArg('--limit', '0')) || 0;
const offset = parseInt(getArg('--offset', '0')) || 0;
const concurrency = parseInt(getArg('--concurrency', '1')) || 1;
const contrastive = args.includes('--contrastive');
const verbose = args.includes('--verbose');

// --- Tool schemas ---

function answerTool(choices) {
  return {
    name: 'record_answer',
    description: 'Record your answer to the mystery question.',
    input_schema: {
      type: 'object',
      required: ['reasoning', 'answer'],
      properties: {
        reasoning: {
          type: 'string',
          description: 'Brief explanation of the key clues that led to your answer.',
        },
        answer: {
          type: 'string',
          enum: choices,
          description: 'The most likely suspect.',
        },
      },
    },
  };
}

function groundedAnswerTool(choices) {
  return {
    name: 'record_grounded_answer',
    description: 'Record your clue-by-clue analysis and answer to the mystery.',
    input_schema: {
      type: 'object',
      required: ['clues', 'contradictions', 'answer'],
      properties: {
        clues: {
          type: 'array',
          items: {
            type: 'object',
            required: ['quote', 'implication'],
            properties: {
              quote: {
                type: 'string',
                description: 'Exact quote from the story text that constitutes a clue.',
              },
              implication: {
                type: 'string',
                description: 'What this clue implies — who it implicates or exonerates, and why.',
              },
            },
          },
          description: 'Key clues extracted from the story. Quote the exact text before analyzing.',
        },
        contradictions: {
          type: 'string',
          description: 'Which clues conflict with each other, impossible alibis, or logical inconsistencies.',
        },
        reasoning: {
          type: 'string',
          description: 'Based on the clues and contradictions, who is most likely responsible and why.',
        },
        answer: {
          type: 'string',
          enum: choices,
          description: 'The most likely suspect.',
        },
      },
    },
  };
}

function groundedContrastiveTool(choices) {
  return {
    name: 'record_grounded_answer',
    description: 'Record your clue-by-clue analysis and answer to the mystery.',
    input_schema: {
      type: 'object',
      required: ['clues', 'per_choice_analysis', 'answer'],
      properties: {
        clues: {
          type: 'array',
          items: {
            type: 'object',
            required: ['quote', 'implication'],
            properties: {
              quote: {
                type: 'string',
                description: 'Exact quote from the story text that constitutes a clue.',
              },
              implication: {
                type: 'string',
                description: 'What this clue implies — who it implicates or exonerates, and why.',
              },
            },
          },
          description: 'Key clues extracted from the story. Quote the exact text before analyzing.',
        },
        per_choice_analysis: {
          type: 'array',
          items: {
            type: 'object',
            required: ['choice', 'supporting_clues', 'contradicting_clues', 'plausibility'],
            properties: {
              choice: {
                type: 'string',
                enum: choices,
                description: 'The suspect being evaluated.',
              },
              supporting_clues: {
                type: 'string',
                description: 'Which extracted clues support this suspect being guilty, and why.',
              },
              contradicting_clues: {
                type: 'string',
                description: 'Which extracted clues suggest this suspect is innocent, and why.',
              },
              plausibility: {
                type: 'string',
                enum: ['strong', 'weak', 'eliminated'],
                description: 'How plausible it is that this suspect is the murderer.',
              },
            },
          },
          description: 'Evaluate EVERY suspect against the extracted clues before selecting.',
        },
        answer: {
          type: 'string',
          enum: choices,
          description: 'The most likely suspect.',
        },
      },
    },
  };
}

// --- Prompts ---

function baselinePrompt(story, choices) {
  const choiceList = choices.map((c, i) => `${String.fromCharCode(65 + i)}. ${c}`).join('\n');
  return `Read the following murder mystery story carefully, then answer the question.

## Story

${story}

## Question

Who is the most likely murderer?

${choiceList}

## Instructions

Think through the clues in the story step by step. Identify contradictions, alibis, timeline issues, or other evidence that points to the murderer.`;
}

function singlePrompt(story, choices) {
  const choiceList = choices.map((c, i) => `${String.fromCharCode(65 + i)}. ${c}`).join('\n');
  return `Read the following murder mystery story carefully, then answer the question.

## Story

${story}

## Question

Who is the most likely murderer?

${choiceList}

## Instructions

Before selecting an answer, you MUST complete both passes:

### Pass 1 — Analyze (do this BEFORE looking at the answer choices)

1. **Timeline**: Reconstruct the sequence of events
2. **Suspects**: List every person who could be the murderer
3. **Clues**: For each suspect, list evidence for and against them
4. **Contradictions**: Note any statements that don't add up, impossible alibis, or logical inconsistencies
5. **Conclusion**: Based purely on your analysis, who do you think is the murderer and why?

### Pass 2 — Select

Now look at the answer choices. Based on your Pass 1 analysis, select the most likely murderer.`;
}

function groundedPrompt(story, choices, useContrastive) {
  const choiceList = choices.map((c, i) => `${String.fromCharCode(65 + i)}. ${c}`).join('\n');
  const contrastiveBlock = useContrastive
    ? `\n\nAfter extracting clues, evaluate EVERY suspect against your clues. For each suspect, list which clues support their guilt and which contradict it, then rate their plausibility (strong / weak / eliminated). Only then select your answer.`
    : `\n\nAfter extracting all relevant clues, identify contradictions between them (impossible alibis, timeline conflicts, logical inconsistencies). Then select your answer based on the evidence you cited.`;

  return `Read the following murder mystery story carefully, then answer the question.

## Story

${story}

## Question

Who is the most likely murderer?

${choiceList}

## Instructions

You must analyze the story by extracting specific clues BEFORE choosing an answer. For each clue:

1. **Quote** the exact sentence or phrase from the story
2. **Analyze** what this clue implies — who it implicates or exonerates, and why

Extract at least 3 clues. Every claim you make must be grounded in a direct quote from the story.${contrastiveBlock}`;
}

// --- Run one example ---

async function runBaseline(story, choices) {
  const prompt = baselinePrompt(story, choices);
  const tool = answerTool(choices);
  const result = await callWithTool({
    model,
    prompt,
    tool,
    toolChoice: { type: 'tool', name: 'record_answer' },
    verbose,
  });
  return result.input.answer;
}

async function runSinglePrompt(story, choices) {
  const prompt = singlePrompt(story, choices);
  const tool = answerTool(choices);
  const result = await callWithTool({
    model,
    prompt,
    tool,
    toolChoice: { type: 'tool', name: 'record_answer' },
    verbose,
    maxTokens: 8192,
  });
  return result.input.answer;
}

async function runGrounded(story, choices) {
  const prompt = groundedPrompt(story, choices, contrastive);
  const tool = contrastive ? groundedContrastiveTool(choices) : groundedAnswerTool(choices);
  const result = await callWithTool({
    model,
    prompt,
    tool,
    toolChoice: { type: 'tool', name: 'record_grounded_answer' },
    verbose,
    maxTokens: 8192,
  });
  return { answer: result.input.answer, grounded: result.input };
}

// --- Main ---

async function main() {
  const taskRaw = await readFile(TASK_PATH, 'utf-8');
  let examples = JSON.parse(taskRaw);

  if (offset > 0) examples = examples.slice(offset);
  if (limit > 0) examples = examples.slice(0, limit);

  console.error(`MuSR Murder Mystery Benchmark: ${label}`);
  console.error(`  mode: ${mode}${contrastive ? ' +contrastive' : ''}`);
  console.error(`  model: ${model}`);
  console.error(`  examples: ${examples.length}${offset ? ` (offset ${offset})` : ''}`);
  console.error('');

  const allResults = new Array(examples.length);
  const totalStart = Date.now();
  let correct = 0;

  async function processExample(i) {
    const ex = examples[i];
    const q = ex.questions[0];
    const choices = q.choices;
    const correctAnswer = choices[q.answer];
    const storyId = `musr-${offset + i}`;

    console.error(`  [${i + 1}/${examples.length}] ${storyId}...`);

    const start = Date.now();
    let answer = null;
    let grounded = null;
    let error = null;

    try {
      if (mode === 'baseline') {
        answer = await runBaseline(ex.context, choices);
      } else if (mode === 'single-prompt') {
        answer = await runSinglePrompt(ex.context, choices);
      } else if (mode === 'grounded') {
        const result = await runGrounded(ex.context, choices);
        answer = result.answer;
        grounded = result.grounded;
      } else {
        throw new Error(`Unknown mode: ${mode}. Expected: baseline, single-prompt, grounded`);
      }
    } catch (err) {
      error = err.message;
      console.error(`    ERROR: ${error}`);
    }

    const elapsedMs = Date.now() - start;
    const isCorrect = answer === correctAnswer;
    if (isCorrect) correct++;

    const tag = isCorrect ? 'CORRECT' : answer ? 'WRONG' : 'PARSE_FAILED';
    console.error(`    ${tag}: "${answer}" (expected "${correctAnswer}") (${(elapsedMs / 1000).toFixed(1)}s)`);

    allResults[i] = {
      storyId,
      choices,
      correctAnswer,
      answer,
      correct: isCorrect,
      elapsedMs,
      ...(grounded ? { grounded } : {}),
      ...(error ? { error } : {}),
    };
  }

  if (concurrency <= 1) {
    for (let i = 0; i < examples.length; i++) {
      await processExample(i);
    }
  } else {
    let next = 0;
    const workers = Array.from({ length: Math.min(concurrency, examples.length) }, async () => {
      while (next < examples.length) {
        const i = next++;
        await processExample(i);
      }
    });
    await Promise.all(workers);
  }

  const totalElapsedMs = Date.now() - totalStart;

  console.error(`\nAccuracy: ${correct}/${allResults.length} (${(100 * correct / allResults.length).toFixed(1)}%)`);
  console.error(`Elapsed: ${(totalElapsedMs / 1000).toFixed(1)}s`);

  // --- Save results ---

  await mkdir(RESULTS_DIR, { recursive: true });

  const output = {
    label,
    timestamp: new Date().toISOString(),
    config: {
      mode,
      model,
      contrastive,
      total: allResults.length,
    },
    totalElapsedMs,
    accuracy: correct / allResults.length,
    correct,
    total: allResults.length,
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
