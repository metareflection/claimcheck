#!/usr/bin/env node
/**
 * The bare zero-shot baseline: one artifact, one requirement, one YES/NO,
 * no chunking, full dataset. This is the "baseline" column in the paper.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=... node bench/run_baseline.js --dataset clover
 *   ANTHROPIC_API_KEY=... node bench/run_baseline.js --dataset spider
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { loadDataset } from './lib/dataset.js';
import { score } from './lib/scoring.js';
import { mapWithConcurrency, withRetry, Checkpoint } from './lib/runner.js';
import { callModel, MODELS } from './lib/models.js';
import { NAIVE_BARE_TOOL } from '../src/schemas.js';
import { NAIVE_BARE_PROMPT, langOf } from '../src/prompts.js';

const DATASETS = { clover: 'bench/data/clover_v1.jsonl', spider: 'bench/data/spider_v3.jsonl' };

const LANG_KEY_MAP = { lean4: 'lean', dafny: 'dafny', sql: 'sql', isabelle: 'isabelle' };
const langKeyFor = (row) => LANG_KEY_MAP[row.language] ?? 'dafny';

function parseArgs(argv) {
  const get = (flag, fallback) => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
  };
  const dataset = get('--dataset', 'clover');
  if (!(dataset in DATASETS)) {
    throw new Error(`unknown --dataset "${dataset}" (expected: ${Object.keys(DATASETS).join(', ')})`);
  }
  return { dataset, concurrency: Number(get('--concurrency', '3')), resume: argv.includes('--resume') };
}

async function runOneRow(row) {
  const contextBlock = row.context || '';
  const prompt = NAIVE_BARE_PROMPT(row.formal, row.informal, langKeyFor(row), contextBlock);
  const res = await callModel({ modelId: MODELS.sonnet, prompt, tool: NAIVE_BARE_TOOL });
  const answer = res.toolInput?.answer;
  const predictedMatch = answer === 'YES' ? true : answer === 'NO' ? false : null;
  return { ...res, predictedMatch };
}

async function main() {
  const cfg = parseArgs(process.argv.slice(2));
  const rows = await loadDataset(resolve(DATASETS[cfg.dataset]));
  console.log(`baseline: ${cfg.dataset}, ${rows.length} rows, model ${MODELS.sonnet}`);

  const outPath = `bench/results/${cfg.dataset}_baseline.json`;
  const ckpt = await Checkpoint.open(`${outPath}.progress`);
  await mapWithConcurrency(rows, cfg.concurrency, async (row, i) => {
    const key = `row-${i}`;
    if (cfg.resume && ckpt.done(key)) return;
    try {
      const out = await withRetry(() => runOneRow(row));
      await ckpt.record(key, { predictedMatch: out.predictedMatch, latencyMs: out.latencyMs });
    } catch (err) {
      console.error(`  row ${i} (${row.id}) failed: ${err.message.slice(0, 160)}`);
      await ckpt.record(key, { predictedMatch: null, latencyMs: 0 });
    }
    if ((i + 1) % 50 === 0) console.log(`  ${i + 1}/${rows.length}`);
  });

  const entries = ckpt.entries();
  const results = rows.map((row, i) => ({
    row, predictedMatch: entries[`row-${i}`]?.predictedMatch ?? null,
  }));
  const metrics = score(results);

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify({
    dataset: cfg.dataset, model: MODELS.sonnet, metrics,
    perRow: results.map((r) => ({
      id: r.row.id, variant: r.row.variant, cloverClass: r.row.clover_class,
      expectedMatch: r.row.expectedMatch, predictedMatch: r.predictedMatch,
    })),
  }, null, 2));

  console.log(`-> ${outPath}`);
  console.log(`balAcc=${metrics.balancedAccuracy?.toFixed(3)} unparseable=${metrics.unparseable}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(`Error: ${err.message}`); process.exit(1); });
}
