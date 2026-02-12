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
import { readFile, writeFile } from 'node:fs/promises';

async function loadResults(path) {
  if (path) {
    return JSON.parse(await readFile(path, 'utf-8'));
  }
  const raw = execSync('npx promptfoo show eval --json', {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return JSON.parse(raw);
}

function extractMetrics(evalData) {
  const inner = evalData.results ?? evalData;
  const rows = inner.results ?? [];

  // Discover providers and test names in order
  const providerOrder = [];
  const providerMap = new Map();

  for (const r of rows) {
    const label = r.provider?.label || r.provider?.id || 'unknown';
    if (!providerMap.has(label)) {
      providerMap.set(label, {
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
        perTest: [],
      });
      providerOrder.push(label);
    }

    const m = providerMap.get(label);
    m.tests++;
    if (r.success) m.passed++;
    else m.failed++;

    const named = r.namedScores ?? {};
    if (named.totalMs != null) m.totalMs.push(named.totalMs);
    if (named.translateMs != null) m.translateMs.push(named.translateMs);
    if (named.compareMs != null) m.compareMs.push(named.compareMs);
    if (named.inputTokens != null) m.inputTokens.push(named.inputTokens);
    if (named.outputTokens != null) m.outputTokens.push(named.outputTokens);

    const components = r.gradingResult?.componentResults ?? [];
    let covScore = null;
    let transScore = null;
    for (const c of components) {
      const reason = c.reason ?? '';
      if (reason.startsWith('Coverage correctness')) {
        covScore = c.score ?? 0;
        m.coverageScores.push(covScore);
      } else if (reason.startsWith('Translation quality')) {
        transScore = c.score ?? 0;
        m.translationScores.push(transScore);
      }
    }

    const testDesc = r.vars?.projectName ?? r.testCase?.description ?? '';
    m.perTest.push({
      test: testDesc,
      pass: r.success,
      coverage: covScore,
      translation: transScore,
      totalMs: named.totalMs ?? null,
      inputTokens: named.inputTokens ?? null,
      outputTokens: named.outputTokens ?? null,
    });
  }

  const providers = providerOrder;
  const metrics = providers.map((p) => providerMap.get(p));

  return { providers, metrics };
}

function avg(arr) {
  if (arr.length === 0) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function sum(arr) {
  return arr.reduce((a, b) => a + b, 0);
}

function num(n, decimals = 0) {
  if (n == null) return '-';
  return Number(n).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function pct(n) {
  if (n == null) return '-';
  return (n * 100).toFixed(0) + '%';
}

function bestIdx(values, mode = 'max') {
  let best = null;
  let bestI = -1;
  for (let i = 0; i < values.length; i++) {
    if (values[i] == null) continue;
    if (best == null || (mode === 'max' ? values[i] > best : values[i] < best)) {
      best = values[i];
      bestI = i;
    }
  }
  return bestI;
}

function printMarkdownTable(providers, metrics) {
  const cols = providers.map((p, i) => ({ label: p, m: metrics[i] }));
  const n = cols.length;

  const md = (s) => console.log(s);

  // --- Summary table ---
  md('');
  md('## Model Comparison Summary');
  md('');

  const hdr = ['Metric', ...cols.map((c) => c.label)];
  md('| ' + hdr.join(' | ') + ' |');
  md('| ' + hdr.map(() => '---').join(' | ') + ' |');

  const summaryRow = (label, values, highlight = 'max') => {
    const best = bestIdx(values, highlight);
    const cells = values.map((v, i) => {
      const s = typeof v === 'string' ? v : v;
      return i === best ? `**${s}**` : s;
    });
    md('| ' + [label, ...cells].join(' | ') + ' |');
  };

  summaryRow(
    'Pass rate',
    cols.map((c) => `${c.m.passed}/${c.m.tests}`),
    'max',
  );
  summaryRow(
    'Coverage (avg)',
    cols.map((c) => pct(avg(c.m.coverageScores))),
    'max',
  );
  summaryRow(
    'Translation (avg)',
    cols.map((c) => pct(avg(c.m.translationScores))),
    'max',
  );
  summaryRow(
    'Latency (avg ms)',
    cols.map((c) => num(avg(c.m.totalMs))),
    'min',
  );
  summaryRow(
    'Translate (avg ms)',
    cols.map((c) => num(avg(c.m.translateMs))),
    'min',
  );
  summaryRow(
    'Compare (avg ms)',
    cols.map((c) => num(avg(c.m.compareMs))),
    'min',
  );
  summaryRow(
    'Input tokens (total)',
    cols.map((c) => num(sum(c.m.inputTokens))),
    'min',
  );
  summaryRow(
    'Output tokens (total)',
    cols.map((c) => num(sum(c.m.outputTokens))),
    'min',
  );

  // --- Per-test breakdown ---
  md('');
  md('## Per-Test Breakdown');
  md('');

  const testNames = cols[0].m.perTest.map((t) => t.test);

  for (const testName of testNames) {
    md(`### ${testName}`);
    md('');
    const hdr2 = ['', ...cols.map((c) => c.label)];
    md('| ' + hdr2.join(' | ') + ' |');
    md('| ' + hdr2.map(() => '---').join(' | ') + ' |');

    const testData = cols.map((c) => c.m.perTest.find((t) => t.test === testName));

    const passValues = testData.map((t) => (t?.pass ? 'PASS' : 'FAIL'));
    md('| Result | ' + passValues.map((v) => (v === 'PASS' ? '**PASS**' : 'FAIL')).join(' | ') + ' |');

    const covValues = testData.map((t) => t?.coverage);
    summaryRow('Coverage', covValues.map((v) => pct(v)), 'max');

    const transValues = testData.map((t) => t?.translation);
    summaryRow('Translation', transValues.map((v) => pct(v)), 'max');

    const latValues = testData.map((t) => t?.totalMs);
    summaryRow('Latency (ms)', latValues.map((v) => num(v)), 'min');

    const tokValues = testData.map((t) =>
      t?.inputTokens != null ? (t.inputTokens + (t.outputTokens ?? 0)) : null,
    );
    summaryRow('Tokens', tokValues.map((v) => num(v)), 'min');

    md('');
  }

  // --- Winners ---
  md('## Winners');
  md('');

  const categories = [
    ['Best coverage', (m) => avg(m.coverageScores), 'max', pct],
    ['Best translation', (m) => avg(m.translationScores), 'max', pct],
    ['Fastest', (m) => avg(m.totalMs), 'min', (v) => num(v) + 'ms'],
    ['Cheapest', (m) => sum(m.inputTokens) + sum(m.outputTokens), 'min', (v) => num(v) + ' tokens'],
  ];

  for (const [label, fn, mode, formatter] of categories) {
    const values = cols.map((c) => fn(c.m));
    const i = bestIdx(values, mode);
    if (i >= 0) {
      md(`- **${label}**: ${cols[i].label} (${formatter(values[i])})`);
    }
  }

  md('');
}

// Main
const filePath = process.argv[2] ?? null;
const outPath = process.argv[3] ?? 'results/comparison.md';
const evalData = await loadResults(filePath);
const { providers, metrics } = extractMetrics(evalData);

// Capture output to both stdout and file
const lines = [];
const origLog = console.log;
console.log = (s) => { lines.push(s); origLog(s); };

printMarkdownTable(providers, metrics);

console.log = origLog;
await writeFile(outPath, lines.join('\n') + '\n');
console.log(`Written to ${outPath}`);
