#!/usr/bin/env node
/**
 * Mystery QA benchmark runner.
 *
 * Compares approaches on BIG-bench Minute Mysteries QA (multiple choice):
 *   - baseline: model sees story + question + choices, answers directly (one call)
 *   - single-prompt: model sees everything, but prompt instructs analyze-then-choose (one call)
 *   - two-pass: model analyzes story first (no choices), then selects (two calls)
 *   - grounded: model must quote specific clues from the story, analyze each, then answer (one call)
 *
 * Supports two backends:
 *   - api: direct Anthropic API calls (faster, structured output via tool_use)
 *   - cc: claude -p (Claude Code CLI)
 *
 * Usage:
 *   node eval/bench-mystery.js --mode baseline --label mystery-baseline
 *   node eval/bench-mystery.js --mode two-pass --label mystery-two-pass
 *   node eval/bench-mystery.js --mode baseline --backend cc --label mystery-cc
 *   node eval/bench-mystery.js --mode baseline --label test --limit 5
 */

import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { callWithTool } from '../src/api.js';

const RESULTS_DIR = resolve(import.meta.dirname, 'results');
const TASK_PATH = resolve(import.meta.dirname, '../../BIG-bench/bigbench/benchmark_tasks/minute_mysteries_qa/multiplechoice/task.json');

// --- Parse args ---

const args = process.argv.slice(2);

function getArg(name, defaultVal) {
  const i = args.indexOf(name);
  if (i === -1) return defaultVal;
  return args[i + 1];
}

const mode = getArg('--mode', 'baseline');
const backend = getArg('--backend', 'api');
const label = getArg('--label', `mystery-${mode}-${Date.now()}`);
const model = getArg('--model', 'claude-sonnet-4-5-20250929');
const limit = parseInt(getArg('--limit', '0')) || 0;
const offset = parseInt(getArg('--offset', '0')) || 0;
const concurrency = parseInt(getArg('--concurrency', '1')) || 1;
const contrastive = args.includes('--contrastive');
const verbose = args.includes('--verbose');

// --- Tool schemas for structured API output ---

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
          description: 'The correct answer.',
        },
      },
    },
  };
}

const analysisTool = {
  name: 'record_analysis',
  description: 'Record your analysis of the mystery story.',
  input_schema: {
    type: 'object',
    required: ['timeline', 'suspects', 'conclusion'],
    properties: {
      timeline: {
        type: 'string',
        description: 'Reconstructed sequence of key events.',
      },
      suspects: {
        type: 'array',
        items: {
          type: 'object',
          required: ['name', 'evidence_for', 'evidence_against'],
          properties: {
            name: { type: 'string' },
            evidence_for: { type: 'string', description: 'Evidence suggesting this person is responsible.' },
            evidence_against: { type: 'string', description: 'Evidence suggesting this person is NOT responsible.' },
          },
        },
        description: 'Analysis of each suspect.',
      },
      contradictions: {
        type: 'string',
        description: 'Statements that don\'t add up, impossible alibis, or logical inconsistencies.',
      },
      conclusion: {
        type: 'string',
        description: 'Who you think is responsible and why. Be specific about which clues support this.',
      },
    },
  },
};

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
          description: 'Based on the clues and contradictions, who is responsible and why.',
        },
        answer: {
          type: 'string',
          enum: choices,
          description: 'The correct answer.',
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
                description: 'The answer choice being evaluated.',
              },
              supporting_clues: {
                type: 'string',
                description: 'Which extracted clues support this choice, and why.',
              },
              contradicting_clues: {
                type: 'string',
                description: 'Which extracted clues contradict this choice, and why.',
              },
              plausibility: {
                type: 'string',
                enum: ['strong', 'weak', 'eliminated'],
                description: 'How plausible this choice is given the evidence.',
              },
            },
          },
          description: 'Evaluate EVERY answer choice against the extracted clues before selecting.',
        },
        answer: {
          type: 'string',
          enum: choices,
          description: 'The correct answer.',
        },
      },
    },
  };
}

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

function baselinePrompt(story, choices) {
  const choiceList = choices.map((c, i) => `${String.fromCharCode(65 + i)}. ${c}`).join('\n');
  return `Read the following mystery story carefully, then answer the question at the end.

## Story

${story}

## Answer Choices

${choiceList}

## Instructions

Think through the clues in the story step by step. Identify contradictions, alibis, timeline issues, or other evidence that points to the answer.`;
}

function singlePrompt(story, choices) {
  const choiceList = choices.map((c, i) => `${String.fromCharCode(65 + i)}. ${c}`).join('\n');
  return `Read the following mystery story carefully, then answer the question at the end.

## Story

${story}

## Answer Choices

${choiceList}

## Instructions

Before selecting an answer, you MUST complete both passes:

### Pass 1 — Analyze (do this BEFORE looking at the answer choices)

1. **Timeline**: Reconstruct the sequence of events
2. **Suspects**: List every person who could be responsible
3. **Clues**: For each suspect, list evidence for and against them
4. **Contradictions**: Note any statements that don't add up, impossible alibis, or logical inconsistencies
5. **Conclusion**: Based purely on your analysis, who do you think is responsible and why?

### Pass 2 — Select

Now look at the answer choices. Based on your Pass 1 analysis, select the best answer. If your analysis pointed to someone not in the choices, reconsider the evidence for the available choices.`;
}

function analyzePrompt(story) {
  return `Read the following mystery story carefully and analyze it.

## Story

${story}

## Instructions

Do NOT try to guess from a list of choices — there are none yet. Instead, analyze the story thoroughly:

1. **Timeline**: Reconstruct the sequence of events
2. **Suspects**: List every person who could be responsible
3. **Clues**: For each suspect, list evidence for and against them
4. **Contradictions**: Note any statements that don't add up, impossible alibis, or logical inconsistencies
5. **Conclusion**: Based on your analysis, who do you think is responsible and why?

Be specific about which clues support your conclusion.`;
}

function selectPrompt(analysis, choices) {
  const choiceList = choices.map((c, i) => `${String.fromCharCode(65 + i)}. ${c}`).join('\n');
  return `You previously analyzed a mystery story. Here is your analysis:

## Your Analysis

${analysis}

## Answer Choices

Now select from these choices:

${choiceList}

## Instructions

Based on your prior analysis, select the best answer. If your analysis already identified the answer, select it. If your analysis pointed to someone not in the choices, reconsider the evidence for the available choices.`;
}

function groundedPrompt(story, choices, useContrastive) {
  const choiceList = choices.map((c, i) => `${String.fromCharCode(65 + i)}. ${c}`).join('\n');
  const contrastiveBlock = useContrastive
    ? `\n\nAfter extracting clues, evaluate EVERY answer choice against your clues. For each choice, list which clues support it and which contradict it, then rate its plausibility (strong / weak / eliminated). Only then select your answer.`
    : `\n\nAfter extracting all relevant clues, identify contradictions between them (impossible alibis, timeline conflicts, logical inconsistencies). Then select your answer based on the evidence you cited.`;

  return `Read the following mystery story carefully, then answer the question at the end.

## Story

${story}

## Answer Choices

${choiceList}

## Instructions

You must analyze the story by extracting specific clues BEFORE choosing an answer. For each clue:

1. **Quote** the exact sentence or phrase from the story
2. **Analyze** what this clue implies — who it implicates or exonerates, and why

Extract at least 3 clues. Every claim you make must be grounded in a direct quote from the story.${contrastiveBlock}`;
}

// --- Parse answer from CC text output ---

function parseAnswer(output, choices) {
  // Look for **Answer:** A or Answer: A
  const explicit = output.match(/\*?\*?Answer:?\*?\*?\s*([A-Z])\b/i);
  if (explicit) {
    const idx = explicit[1].toUpperCase().charCodeAt(0) - 65;
    if (idx >= 0 && idx < choices.length) return choices[idx];
  }

  // Fallback: look for a choice name mentioned near the end
  const lastChunk = output.slice(-500);
  for (let i = choices.length - 1; i >= 0; i--) {
    if (lastChunk.includes(choices[i])) return choices[i];
  }

  return null;
}

// --- Format analysis for Pass 2 ---

function formatAnalysis(toolInput) {
  const parts = [];
  if (toolInput.timeline) parts.push(`**Timeline:** ${toolInput.timeline}`);
  if (toolInput.suspects) {
    parts.push('**Suspects:**');
    for (const s of toolInput.suspects) {
      parts.push(`- **${s.name}**: For: ${s.evidence_for} / Against: ${s.evidence_against}`);
    }
  }
  if (toolInput.contradictions) parts.push(`**Contradictions:** ${toolInput.contradictions}`);
  if (toolInput.conclusion) parts.push(`**Conclusion:** ${toolInput.conclusion}`);
  return parts.join('\n\n');
}

// --- Run one example ---

async function runBaseline(story, choices) {
  const prompt = baselinePrompt(story, choices);

  if (backend === 'api') {
    const tool = answerTool(choices);
    const result = await callWithTool({
      model,
      prompt,
      tool,
      toolChoice: { type: 'tool', name: 'record_answer' },
      verbose,
    });
    return result.input.answer;
  } else {
    const output = await callClaude(prompt + '\n\nState your final answer as:\n\n**Answer:** <letter>');
    return parseAnswer(output, choices);
  }
}

async function runSinglePrompt(story, choices) {
  const prompt = singlePrompt(story, choices);

  if (backend === 'api') {
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
  } else {
    const output = await callClaude(prompt + '\n\nState your final answer as:\n\n**Answer:** <letter>');
    return parseAnswer(output, choices);
  }
}

async function runTwoPass(story, choices) {
  // Pass 1: analyze without choices
  const prompt1 = analyzePrompt(story);
  let analysis;

  if (backend === 'api') {
    const result1 = await callWithTool({
      model,
      prompt: prompt1,
      tool: analysisTool,
      toolChoice: { type: 'tool', name: 'record_analysis' },
      verbose,
    });
    analysis = formatAnalysis(result1.input);

    if (verbose) {
      console.error('    --- analysis ---');
      console.error(JSON.stringify(result1.input, null, 2).slice(0, 500));
      console.error('    ---');
    }
  } else {
    analysis = await callClaude(prompt1);
    if (verbose) {
      console.error('    --- analysis ---');
      console.error(analysis.slice(-500));
      console.error('    ---');
    }
  }

  // Pass 2: select from choices
  const prompt2 = selectPrompt(analysis, choices);

  if (backend === 'api') {
    const tool = answerTool(choices);
    const result2 = await callWithTool({
      model,
      prompt: prompt2,
      tool,
      toolChoice: { type: 'tool', name: 'record_answer' },
      verbose,
    });
    return result2.input.answer;
  } else {
    const output = await callClaude(prompt2 + '\n\nState your final answer as:\n\n**Answer:** <letter>');
    return parseAnswer(output, choices);
  }
}

async function runGrounded(story, choices) {
  const prompt = groundedPrompt(story, choices, contrastive);

  if (backend === 'api') {
    const tool = contrastive ? groundedContrastiveTool(choices) : groundedAnswerTool(choices);
    const result = await callWithTool({
      model,
      prompt,
      tool,
      toolChoice: { type: 'tool', name: 'record_grounded_answer' },
      verbose,
      maxTokens: 8192,
    });
    return result.input.answer;
  } else {
    const output = await callClaude(prompt + '\n\nState your final answer as:\n\n**Answer:** <letter>');
    return parseAnswer(output, choices);
  }
}

// --- Main ---

async function main() {
  const taskRaw = await readFile(TASK_PATH, 'utf-8');
  const task = JSON.parse(taskRaw);
  let examples = task.examples;

  if (offset > 0) examples = examples.slice(offset);
  if (limit > 0) examples = examples.slice(0, limit);

  console.error(`Mystery QA Benchmark: ${label}`);
  console.error(`  mode: ${mode}`);
  console.error(`  backend: ${backend}`);
  console.error(`  model: ${model}`);
  console.error(`  examples: ${examples.length}${offset ? ` (offset ${offset})` : ''}`);
  console.error('');

  const allResults = new Array(examples.length);
  const totalStart = Date.now();
  let correct = 0;

  async function processExample(i) {
    const ex = examples[i];
    const choices = Object.keys(ex.target_scores);
    const correctAnswer = choices.find(c => ex.target_scores[c] === 1);
    const storyId = ex.comment || `example-${offset + i}`;

    console.error(`  [${i + 1}/${examples.length}] ${storyId}...`);

    const start = Date.now();
    let answer = null;
    let error = null;

    try {
      if (mode === 'baseline') {
        answer = await runBaseline(ex.input, choices);
      } else if (mode === 'single-prompt') {
        answer = await runSinglePrompt(ex.input, choices);
      } else if (mode === 'two-pass') {
        answer = await runTwoPass(ex.input, choices);
      } else if (mode === 'grounded') {
        answer = await runGrounded(ex.input, choices);
      } else {
        throw new Error(`Unknown mode: ${mode}. Expected: baseline, single-prompt, two-pass, grounded`);
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
      backend,
      model,
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
