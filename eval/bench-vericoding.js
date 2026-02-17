#!/usr/bin/env node
/**
 * VeriCoding ClaimCheck benchmark.
 *
 * Runs ClaimCheck (round-trip informalization) on VeriCoding Dafny specs
 * to test whether the formal spec matches the NL description.
 *
 * Since all VeriCoding pairs are intended to be correct, the confirmation
 * rate measures false positive (dispute) rate of ClaimCheck at scale.
 *
 * Usage:
 *   node eval/bench-vericoding.js --concurrency 10 --label vericoding-roundtrip
 *   node eval/bench-vericoding.js --single-prompt --concurrency 10 --label vericoding-single
 *   node eval/bench-vericoding.js --limit 20 --verbose --label vericoding-test
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { claimcheck } from '../src/claimcheck.js';

const RESULTS_DIR = resolve(import.meta.dirname, 'results');
const TASKS_PATH = resolve(import.meta.dirname, '../../vericoding-benchmark/jsonl/dafny_tasks.jsonl');

// --- Parse args ---

const args = process.argv.slice(2);

function getArg(name, defaultVal) {
  const i = args.indexOf(name);
  if (i === -1) return defaultVal;
  return args[i + 1];
}

const label = getArg('--label', `vericoding-${Date.now()}`);
const limit = parseInt(getArg('--limit', '0')) || 0;
const offset = parseInt(getArg('--offset', '0')) || 0;
const concurrency = parseInt(getArg('--concurrency', '1')) || 1;
const singlePrompt = args.includes('--single-prompt');
const verbose = args.includes('--verbose');
const sample = parseInt(getArg('--sample', '0')) || 0;
const seed = parseInt(getArg('--seed', '42')) || 42;

// --- Load data ---

async function loadTasks() {
  const raw = await readFile(TASKS_PATH, 'utf-8');
  const lines = raw.trim().split('\n');
  let tasks = lines.map(l => JSON.parse(l));

  // Filter to tasks with NL descriptions
  tasks = tasks.filter(t => t['vc-description'] && t['vc-description'].trim());

  if (sample > 0) {
    // Seeded shuffle
    function mulberry32(a) {
      return function() {
        a |= 0; a = a + 0x6D2B79F5 | 0;
        var t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
      };
    }
    const rng = mulberry32(seed);
    for (let i = tasks.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [tasks[i], tasks[j]] = [tasks[j], tasks[i]];
    }
    tasks = tasks.slice(0, sample);
  }

  if (offset > 0) tasks = tasks.slice(offset);
  if (limit > 0) tasks = tasks.slice(0, limit);

  return tasks;
}

function taskToDafnyCode(task) {
  const parts = [];
  if (task['vc-preamble']) parts.push(task['vc-preamble']);
  if (task['vc-helpers']) parts.push(task['vc-helpers']);
  if (task['vc-spec']) parts.push(task['vc-spec']);
  return parts.join('\n\n');
}

// --- Main ---

async function main() {
  const tasks = await loadTasks();

  console.error(`VeriCoding ClaimCheck Benchmark: ${label}`);
  console.error(`  mode: ${singlePrompt ? 'single-prompt' : 'round-trip'}`);
  console.error(`  tasks: ${tasks.length}`);
  console.error('');

  const allResults = [];
  const totalStart = Date.now();
  let confirmed = 0;
  let disputed = 0;
  let errors = 0;

  // Process one at a time (each is an independent claimcheck call)
  async function processTask(task) {
    const claim = {
      requirement: task['vc-description'],
      lemmaName: task.id,
      dafnyCode: taskToDafnyCode(task),
    };

    try {
      const { results } = await claimcheck({
        claims: [claim],
        domain: 'competitive programming',
        options: {
          singlePrompt,
          verbose,
          log: verbose ? console.error.bind(console) : () => {},
        },
      });

      const r = results[0];
      if (r.status === 'confirmed') confirmed++;
      else if (r.status === 'disputed') disputed++;
      else errors++;

      return {
        id: task.id,
        source: task.source,
        description: task['vc-description'],
        status: r.status,
        informalization: r.informalization,
        comparison: r.comparison,
        ...(r.discrepancy ? { discrepancy: r.discrepancy } : {}),
        ...(r.weakeningType ? { weakeningType: r.weakeningType } : {}),
      };
    } catch (err) {
      errors++;
      console.error(`    ERROR on ${task.id}: ${err.message}`);
      return {
        id: task.id,
        source: task.source,
        description: task['vc-description'],
        status: 'error',
        error: err.message,
      };
    }
  }

  if (concurrency <= 1) {
    for (let i = 0; i < tasks.length; i++) {
      console.error(`  [${i + 1}/${tasks.length}] ${tasks[i].id}...`);
      const r = await processTask(tasks[i]);
      console.error(`    ${r.status}${r.discrepancy ? ': ' + r.discrepancy.slice(0, 80) : ''}`);
      allResults.push(r);
    }
  } else {
    let next = 0;
    const results = new Array(tasks.length);
    const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
      while (next < tasks.length) {
        const i = next++;
        console.error(`  [${i + 1}/${tasks.length}] ${tasks[i].id}...`);
        results[i] = await processTask(tasks[i]);
        console.error(`    ${results[i].status}${results[i].discrepancy ? ': ' + results[i].discrepancy.slice(0, 80) : ''}`);
      }
    });
    await Promise.all(workers);
    allResults.push(...results.filter(Boolean));
  }

  const totalElapsedMs = Date.now() - totalStart;

  console.error(`\nConfirmed: ${confirmed}/${allResults.length} (${(100 * confirmed / allResults.length).toFixed(1)}%)`);
  console.error(`Disputed: ${disputed}/${allResults.length} (${(100 * disputed / allResults.length).toFixed(1)}%)`);
  if (errors) console.error(`Errors: ${errors}`);
  console.error(`Elapsed: ${(totalElapsedMs / 1000).toFixed(1)}s`);

  // --- Save results ---

  await mkdir(RESULTS_DIR, { recursive: true });

  // Analyze dispute categories
  const disputesByType = {};
  for (const r of allResults) {
    if (r.status === 'disputed') {
      const t = r.weakeningType || 'unknown';
      disputesByType[t] = (disputesByType[t] || 0) + 1;
    }
  }

  const output = {
    label,
    timestamp: new Date().toISOString(),
    config: {
      mode: singlePrompt ? 'single-prompt' : 'round-trip',
      total: allResults.length,
    },
    totalElapsedMs,
    confirmed,
    disputed,
    errors,
    disputesByType,
    confirmationRate: confirmed / allResults.length,
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
