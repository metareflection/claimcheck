#!/usr/bin/env node
/**
 * Compare two benchmark results by accuracy.
 *
 * Usage:
 *   node eval/compare.js two-pass single-prompt
 *   node eval/compare.js two-pass cc-sonnet
 */

import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const RESULTS_DIR = resolve(import.meta.dirname, 'results');

const [labelA, labelB] = process.argv.slice(2);

if (!labelA || !labelB) {
  console.error('Usage: node eval/compare.js <label-a> <label-b>');
  process.exit(1);
}

async function load(label) {
  const path = join(RESULTS_DIR, `${label}.json`);
  return JSON.parse(await readFile(path, 'utf-8'));
}

function isCorrect(r) {
  if (r.expected === 'disputed') return r.status === 'disputed';
  return r.status === 'confirmed';
}

function aggregate(results) {
  const byKey = {};
  for (const r of results) {
    const key = `${r.domain}/${r.lemmaName}`;
    if (!byKey[key]) byKey[key] = {
      domain: r.domain,
      requirement: r.requirement,
      lemmaName: r.lemmaName,
      expected: r.expected ?? 'confirmed',
      correct: 0,
      total: 0,
    };
    byKey[key].total++;
    if (isCorrect(r)) byKey[key].correct++;
  }
  return byKey;
}

async function main() {
  const a = await load(labelA);
  const b = await load(labelB);

  const aggA = aggregate(a.results);
  const aggB = aggregate(b.results);

  // Collect all keys in order
  const allKeys = [...new Set([...Object.keys(aggA), ...Object.keys(aggB)])];
  allKeys.sort();

  // Header
  const colA = labelA.length < 12 ? labelA.padEnd(12) : labelA.slice(0, 12);
  const colB = labelB.length < 12 ? labelB.padEnd(12) : labelB.slice(0, 12);
  console.log(`${''.padEnd(50)} exp    ${colA}  ${colB}`);
  console.log('-'.repeat(90));

  let currentDomain = null;
  let totalA = { correct: 0, total: 0 };
  let totalB = { correct: 0, total: 0 };

  for (const key of allKeys) {
    const entryA = aggA[key];
    const entryB = aggB[key];
    const domain = (entryA || entryB).domain;
    const lemmaName = (entryA || entryB).lemmaName;
    const expected = (entryA || entryB).expected;

    if (domain !== currentDomain) {
      currentDomain = domain;
      console.log(`\n  ${domain}`);
    }

    const name = lemmaName.length > 40
      ? lemmaName.slice(0, 40) + '...'
      : lemmaName;
    const expTag = expected === 'disputed' ? 'bogus' : '  ok ';
    const scoreA = entryA ? `${entryA.correct}/${entryA.total}` : '-';
    const scoreB = entryB ? `${entryB.correct}/${entryB.total}` : '-';

    // Delta indicator
    const rateA = entryA ? entryA.correct / entryA.total : 0;
    const rateB = entryB ? entryB.correct / entryB.total : 0;
    let indicator = '';
    if (rateB > rateA + 0.01) indicator = ' ↑';
    else if (rateB < rateA - 0.01) indicator = ' ↓';

    if (entryA) { totalA.correct += entryA.correct; totalA.total += entryA.total; }
    if (entryB) { totalB.correct += entryB.correct; totalB.total += entryB.total; }

    console.log(`    ${name.padEnd(46)} ${expTag}  ${scoreA.padEnd(12)}  ${scoreB}${indicator}`);
  }

  console.log('\n' + '-'.repeat(90));
  console.log(`${'  Accuracy'.padEnd(57)} ${(totalA.correct + '/' + totalA.total).padEnd(12)}  ${totalB.correct}/${totalB.total}`);

  // Config diff
  const timeA = a.totalElapsedMs ? `${(a.totalElapsedMs / 1000).toFixed(1)}s` : '?';
  const timeB = b.totalElapsedMs ? `${(b.totalElapsedMs / 1000).toFixed(1)}s` : '?';
  console.log(`\nConfig:`);
  console.log(`  ${labelA}: model=${a.config.model}, runs=${a.config.runs}, elapsed=${timeA}`);
  console.log(`  ${labelB}: model=${b.config.model}, runs=${b.config.runs}, elapsed=${timeB}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
