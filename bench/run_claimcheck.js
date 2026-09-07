#!/usr/bin/env node
/**
 * The claimcheck arm: informalize (frozen haiku) then compare (sonnet-4.6),
 * chunked into one API call per group of rows. This is the "claimcheck"
 * column in the paper.
 *
 * Dafny is chunked at 10 rows/call; SQL at one call per database (--chunk
 * domain), matching the Experimental Setup section. SQL is scored on the
 * spider_v4 id set -- a subset of the spider_v3 rows this actually calls the
 * API on, so nothing needs re-running when the dataset was cut to v4.
 *
 * Run standalone, this reports over its own denominator (whichever rows it
 * could answer). The paper additionally restricts both columns to rows both
 * the baseline and claimcheck answered, which moves the macro figure by at
 * most 0.1pp on this dataset.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=... node bench/run_claimcheck.js --dataset clover
 *   ANTHROPIC_API_KEY=... node bench/run_claimcheck.js --dataset spider --chunk domain
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { loadDataset } from './lib/dataset.js';
import { chunkRows } from './lib/chunker.js';
import { score } from './lib/scoring.js';
import { mapWithConcurrency, withRetry, Checkpoint } from './lib/runner.js';
import { MODELS } from './lib/models.js';
import { runInformalizeChunk, runCompareChunk } from './lib/arms.js';

const DATASETS = { clover: 'bench/data/clover_v1.jsonl', spider: 'bench/data/spider_v3.jsonl' };
const DEFAULT_CHUNK = { clover: 10, spider: 'domain' };
const RESTRICT_TO = { spider: 'bench/data/spider_v4.jsonl' };

function parseArgs(argv) {
  const get = (flag, fallback) => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
  };
  const dataset = get('--dataset', 'clover');
  if (!(dataset in DATASETS)) {
    throw new Error(`unknown --dataset "${dataset}" (expected: ${Object.keys(DATASETS).join(', ')})`);
  }
  const chunkArg = get('--chunk', String(DEFAULT_CHUNK[dataset]));
  return {
    dataset,
    chunk: chunkArg === 'domain' ? 'domain' : Number(chunkArg),
    concurrency: Number(get('--concurrency', '4')),
    resume: argv.includes('--resume'),
  };
}

async function runStep(chunks, ckptPath, runOne, cfg) {
  const ckpt = await Checkpoint.open(ckptPath);
  await mapWithConcurrency(chunks, cfg.concurrency, async (chunk, i) => {
    const key = `chunk-${i}`;
    if (cfg.resume && ckpt.done(key)) return;
    try {
      const out = await withRetry(() => runOne(chunk));
      await ckpt.record(key, out);
    } catch (err) {
      console.error(`  chunk ${i} failed: ${err.message.slice(0, 160)}`);
      await ckpt.record(key, { failed: true, predictions: chunk.map(() => null), informalizations: chunk.map(() => null) });
    }
  });
  return ckpt.entries();
}

async function main() {
  const cfg = parseArgs(process.argv.slice(2));
  const rows = await loadDataset(resolve(DATASETS[cfg.dataset]));
  console.log(`claimcheck: ${cfg.dataset}, ${rows.length} rows, chunk=${cfg.chunk}`);

  const chunks = chunkRows(rows, { chunkSize: cfg.chunk === 'domain' ? Infinity : cfg.chunk });
  console.log(`  ${chunks.length} chunks`);

  const cachePath = `bench/results/.cache_informalize_${cfg.dataset}.json`;
  console.log('  informalizing (frozen haiku)...');
  const infEntries = await runStep(
    chunks, `${cachePath}.progress`,
    (chunk) => runInformalizeChunk({ chunk, modelId: MODELS.haiku }),
    cfg,
  );
  await writeFile(cachePath, JSON.stringify(infEntries));

  console.log('  comparing (sonnet-4.6)...');
  const outPath = `bench/results/${cfg.dataset}_claimcheck.json`;
  const cmpEntries = await runStep(
    chunks, `${outPath}.progress`,
    (chunk, i) => runCompareChunk({
      chunk, modelId: MODELS.sonnet, informalizations: infEntries[`chunk-${i}`].informalizations,
    }),
    cfg,
  );

  const results = chunks.flatMap((chunk, i) => chunk.map((row, j) => ({
    row, predictedMatch: cmpEntries[`chunk-${i}`]?.predictions?.[j] ?? null,
  })));

  const keep = RESTRICT_TO[cfg.dataset]
    ? new Set((await loadDataset(resolve(RESTRICT_TO[cfg.dataset]))).map((r) => r.id))
    : null;
  const scoredResults = keep ? results.filter((r) => keep.has(r.row.id)) : results;
  const metrics = score(scoredResults);

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify({
    dataset: cfg.dataset, chunk: cfg.chunk,
    model: MODELS.sonnet, frozenInformalizer: MODELS.haiku,
    restrictedTo: RESTRICT_TO[cfg.dataset] ?? null,
    metrics,
    perRow: scoredResults.map((r) => ({
      id: r.row.id, variant: r.row.variant, cloverClass: r.row.clover_class,
      expectedMatch: r.row.expectedMatch, predictedMatch: r.predictedMatch,
    })),
  }, null, 2));

  console.log(`-> ${outPath}`);
  console.log(`n=${metrics.n} balAcc=${metrics.balancedAccuracy?.toFixed(3)} unparseable=${metrics.unparseable}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(`Error: ${err.message}`); process.exit(1); });
}
