#!/usr/bin/env node
/**
 * Compare two benchmark results.
 *
 * Usage:
 *   node eval/compare.js baseline erased
 *   node eval/compare.js baseline opus
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

function aggregate(results) {
  const byReq = {};
  for (const r of results) {
    const key = `${r.domain}/${r.requirement}`;
    if (!byReq[key]) byReq[key] = { domain: r.domain, requirement: r.requirement, passed: 0, total: 0, correctGap: r.correctGap || false };
    byReq[key].total++;
    if (r.status === 'proved' || r.status === 'confirmed') byReq[key].passed++;
  }
  return byReq;
}

async function main() {
  const a = await load(labelA);
  const b = await load(labelB);

  const aggA = aggregate(a.results);
  const aggB = aggregate(b.results);

  // Collect all requirement keys in order
  const allKeys = [...new Set([...Object.keys(aggA), ...Object.keys(aggB)])];
  allKeys.sort();

  // Header
  const colA = labelA.length < 12 ? labelA.padEnd(12) : labelA.slice(0, 12);
  const colB = labelB.length < 12 ? labelB.padEnd(12) : labelB.slice(0, 12);
  console.log(`${''.padEnd(57)} ${colA}  ${colB}`);
  console.log('-'.repeat(85));

  let currentDomain = null;
  let totalA = { passed: 0, total: 0 };
  let totalB = { passed: 0, total: 0 };

  for (const key of allKeys) {
    const entryA = aggA[key];
    const entryB = aggB[key];
    const domain = (entryA || entryB).domain;
    const req = (entryA || entryB).requirement;

    if (domain !== currentDomain) {
      currentDomain = domain;
      console.log(`\n  ${domain}`);
    }

    const short = req.length > 50 ? req.slice(0, 50) + '...' : req;
    const scoreA = entryA ? `${entryA.passed}/${entryA.total}` : '-';
    const scoreB = entryB ? `${entryB.passed}/${entryB.total}` : '-';

    // Delta indicator
    const rateA = entryA ? entryA.passed / entryA.total : 0;
    const rateB = entryB ? entryB.passed / entryB.total : 0;
    let indicator = '';
    if (rateB > rateA + 0.01) indicator = ' ↑';
    else if (rateB < rateA - 0.01) indicator = ' ↓';

    const isGap = (entryA || entryB).correctGap;
    if (!isGap) {
      if (entryA) { totalA.passed += entryA.passed; totalA.total += entryA.total; }
      if (entryB) { totalB.passed += entryB.passed; totalB.total += entryB.total; }
    }

    const tag = isGap ? ' [gap]' : '';
    console.log(`    ${short.padEnd(53)} ${scoreA.padEnd(12)}  ${scoreB}${indicator}${tag}`);
  }

  console.log('\n' + '-'.repeat(85));
  console.log(`${'  Total (excl. gaps)'.padEnd(57)} ${(totalA.passed + '/' + totalA.total).padEnd(12)}  ${totalB.passed}/${totalB.total}`);

  // Config diff
  console.log(`\nConfig:`);
  console.log(`  ${labelA}: model=${a.config.model}, erase=${a.config.erase}, runs=${a.config.runs}`);
  console.log(`  ${labelB}: model=${b.config.model}, erase=${b.config.erase}, runs=${b.config.runs}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
