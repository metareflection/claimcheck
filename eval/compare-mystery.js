#!/usr/bin/env node
/**
 * Compare two mystery QA benchmark results.
 *
 * Usage:
 *   node eval/compare-mystery.js mystery-baseline mystery-two-pass
 */

import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const RESULTS_DIR = resolve(import.meta.dirname, 'results');

const [labelA, labelB] = process.argv.slice(2);

if (!labelA || !labelB) {
  console.error('Usage: node eval/compare-mystery.js <label-a> <label-b>');
  process.exit(1);
}

async function load(label) {
  const path = join(RESULTS_DIR, `${label}.json`);
  return JSON.parse(await readFile(path, 'utf-8'));
}

async function main() {
  const a = await load(labelA);
  const b = await load(labelB);

  // Index by storyId
  const mapA = new Map(a.results.map(r => [r.storyId, r]));
  const mapB = new Map(b.results.map(r => [r.storyId, r]));

  const allIds = [...new Set([...mapA.keys(), ...mapB.keys()])];

  const colA = labelA.slice(0, 16).padEnd(16);
  const colB = labelB.slice(0, 16).padEnd(16);
  console.log(`${'Story'.padEnd(45)} ${colA}  ${colB}`);
  console.log('-'.repeat(85));

  let bothCorrect = 0;
  let onlyA = 0;
  let onlyB = 0;
  let neither = 0;

  for (const id of allIds) {
    const ra = mapA.get(id);
    const rb = mapB.get(id);
    const aOk = ra?.correct ?? false;
    const bOk = rb?.correct ?? false;

    if (aOk && bOk) bothCorrect++;
    else if (aOk && !bOk) onlyA++;
    else if (!aOk && bOk) onlyB++;
    else neither++;

    let indicator = '';
    if (bOk && !aOk) indicator = ' ↑';
    else if (!bOk && aOk) indicator = ' ↓';

    const name = id.length > 43 ? id.slice(0, 43) + '..' : id;
    const aTag = ra ? (aOk ? 'Y' : 'N') : '-';
    const bTag = rb ? (bOk ? 'Y' : '-') : '-';

    // Only show disagreements and errors to keep output manageable
    if (aOk !== bOk || !ra || !rb) {
      console.log(`  ${name.padEnd(43)} ${aTag.padEnd(16)}  ${bTag}${indicator}`);
    }
  }

  console.log('\n' + '-'.repeat(85));

  const aAcc = a.correct + '/' + a.total;
  const bAcc = b.correct + '/' + b.total;
  console.log(`${'Accuracy'.padEnd(45)} ${aAcc.padEnd(16)}  ${bAcc}`);
  console.log(`${'Percent'.padEnd(45)} ${(100 * a.accuracy).toFixed(1).padEnd(16)}% ${(100 * b.accuracy).toFixed(1)}%`);

  console.log(`\nAgreement:`);
  console.log(`  Both correct:    ${bothCorrect}`);
  console.log(`  Only ${labelA}: ${onlyA}`);
  console.log(`  Only ${labelB}: ${onlyB}`);
  console.log(`  Neither:         ${neither}`);

  const timeA = a.totalElapsedMs ? `${(a.totalElapsedMs / 1000).toFixed(1)}s` : '?';
  const timeB = b.totalElapsedMs ? `${(b.totalElapsedMs / 1000).toFixed(1)}s` : '?';
  console.log(`\nConfig:`);
  console.log(`  ${labelA}: mode=${a.config.mode}, model=${a.config.model}, n=${a.total}, elapsed=${timeA}`);
  console.log(`  ${labelB}: mode=${b.config.mode}, model=${b.config.model}, n=${b.total}, elapsed=${timeB}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
