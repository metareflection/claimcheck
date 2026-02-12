#!/usr/bin/env node

/**
 * Reads the latest promptfoo eval output and prints a comparison table
 * across providers, showing quality scores and performance metrics.
 *
 * Usage:
 *   node compare-results.mjs                    # reads latest eval
 *   node compare-results.mjs results.json       # reads specific file
 */

import { execSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

async function loadResults(path) {
  if (path) {
    return JSON.parse(await readFile(path, 'utf-8'));
  }
  // Fetch latest eval from promptfoo
  const raw = execSync('npx promptfoo show eval --json', {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return JSON.parse(raw);
}

function extractMetrics(evalData) {
  const results = evalData.results ?? evalData;
  const table = results.table ?? results;
  const heads = table.head?.prompts ?? [];
  const bodies = table.body ?? [];

  // Map provider labels
  const providers = heads.map((h) => h.label || h.provider || h.id);

  // Per-provider aggregated metrics
  const metrics = providers.map(() => ({
    tests: 0,
    passed: 0,
    failed: 0,
    totalMs: [],
    translateMs: [],
    compareMs: [],
    inputTokens: [],
    outputTokens: [],
    coverageScores: [],
    translationScores: [],
  }));

  for (const row of bodies) {
    const outputs = row.outputs ?? [];
    for (let i = 0; i < outputs.length; i++) {
      if (i >= metrics.length) break;
      const out = outputs[i];
      const m = metrics[i];

      m.tests++;
      if (out.pass) m.passed++;
      else m.failed++;

      // Extract namedScores from assertions
      const named = out.namedScores ?? {};
      if (named.totalMs != null) m.totalMs.push(named.totalMs);
      if (named.translateMs != null) m.translateMs.push(named.translateMs);
      if (named.compareMs != null) m.compareMs.push(named.compareMs);
      if (named.inputTokens != null) m.inputTokens.push(named.inputTokens);
      if (named.outputTokens != null) m.outputTokens.push(named.outputTokens);

      // Extract individual assertion scores
      const gradingResult = out.gradingResult ?? {};
      const components = gradingResult.componentResults ?? [];
      for (const c of components) {
        const assertion = c.assertion?.value ?? '';
        if (assertion.includes('coverage-correctness')) {
          m.coverageScores.push(c.score ?? 0);
        } else if (assertion.includes('translation-quality')) {
          m.translationScores.push(c.score ?? 0);
        }
      }
    }
  }

  return { providers, metrics };
}

function avg(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function sum(arr) {
  return arr.reduce((a, b) => a + b, 0);
}

function fmt(n, decimals = 0) {
  return n.toFixed(decimals);
}

function printComparison(providers, metrics) {
  const cols = providers.map((p, i) => ({ label: p, m: metrics[i] }));

  const sep = '-'.repeat(80);

  console.log('\n' + sep);
  console.log('  EVAL COMPARISON');
  console.log(sep);

  // Header
  const labelWidth = 22;
  const colWidth = 18;
  const header =
    ''.padEnd(labelWidth) + cols.map((c) => c.label.padStart(colWidth)).join('');
  console.log(header);
  console.log(sep);

  const row = (label, values) => {
    const cells = values.map((v) => v.padStart(colWidth)).join('');
    console.log(label.padEnd(labelWidth) + cells);
  };

  // Quality
  console.log('  QUALITY');
  row(
    '  Pass rate',
    cols.map((c) => `${c.m.passed}/${c.m.tests}`),
  );
  row(
    '  Coverage avg',
    cols.map((c) => fmt(avg(c.m.coverageScores), 2)),
  );
  row(
    '  Translation avg',
    cols.map((c) => fmt(avg(c.m.translationScores), 2)),
  );

  console.log('');
  console.log('  LATENCY (ms)');
  row(
    '  Translate avg',
    cols.map((c) => fmt(avg(c.m.translateMs))),
  );
  row(
    '  Compare avg',
    cols.map((c) => fmt(avg(c.m.compareMs))),
  );
  row(
    '  Total avg',
    cols.map((c) => fmt(avg(c.m.totalMs))),
  );
  row(
    '  Total sum',
    cols.map((c) => fmt(sum(c.m.totalMs))),
  );

  console.log('');
  console.log('  TOKENS');
  row(
    '  Input total',
    cols.map((c) => fmt(sum(c.m.inputTokens))),
  );
  row(
    '  Output total',
    cols.map((c) => fmt(sum(c.m.outputTokens))),
  );
  row(
    '  Input avg/test',
    cols.map((c) => fmt(avg(c.m.inputTokens))),
  );
  row(
    '  Output avg/test',
    cols.map((c) => fmt(avg(c.m.outputTokens))),
  );

  console.log(sep);

  // Winner summary
  console.log('\n  WINNERS');
  const best = (label, fn) => {
    const values = cols.map((c, i) => ({ label: c.label, val: fn(c.m), i }));
    const winner = values.reduce((a, b) => (a.val > b.val ? a : b));
    console.log(`  ${label.padEnd(20)} ${winner.label} (${fmt(winner.val, 2)})`);
  };
  const lowest = (label, fn) => {
    const values = cols.map((c) => ({ label: c.label, val: fn(c.m) }));
    const filtered = values.filter((v) => v.val > 0);
    if (filtered.length === 0) return;
    const winner = filtered.reduce((a, b) => (a.val < b.val ? a : b));
    console.log(`  ${label.padEnd(20)} ${winner.label} (${fmt(winner.val, 0)})`);
  };

  best('Quality (coverage)', (m) => avg(m.coverageScores));
  best('Quality (translate)', (m) => avg(m.translationScores));
  lowest('Fastest (avg ms)', (m) => avg(m.totalMs));
  lowest('Cheapest (tokens)', (m) => sum(m.inputTokens) + sum(m.outputTokens));

  console.log('');
}

// Main
const filePath = process.argv[2] ?? null;
const evalData = await loadResults(filePath);
const { providers, metrics } = extractMetrics(evalData);
printComparison(providers, metrics);
