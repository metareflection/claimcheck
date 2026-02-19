#!/usr/bin/env node
/**
 * Benchmark runner. Runs all domains N times, saves per-requirement results.
 * Scores accuracy against expected outcomes in mapping files.
 *
 * Usage:
 *   node eval/bench.js --runs 3 --label two-pass
 *   node eval/bench.js --runs 3 --label single-prompt --single-prompt
 *   node eval/bench.js --runs 3 --label naive --naive
 *   node eval/bench.js --runs 3 --label naive --naive --concurrency 5
 *   node eval/bench.js --runs 3 --label opus --model claude-opus-4-6
 */

import { execFile } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { PROJECTS } from '../test/integration/projects.js';

const ROOT = resolve(import.meta.dirname, '..');
const MAPPINGS_DIR = resolve(ROOT, 'test/integration/mappings');
const CLAIMS_DIR = resolve(ROOT, 'test/integration/claims');
const RESULTS_DIR = resolve(ROOT, 'eval/results');
const BIN = resolve(ROOT, 'bin/claimcheck.js');

const ALL_DOMAINS = ['counter', 'kanban', 'colorwheel', 'canon', 'delegation-auth'];

// --- Parse args ---

const args = process.argv.slice(2);

function getArg(name, defaultVal) {
  const i = args.indexOf(name);
  if (i === -1) return defaultVal;
  return args[i + 1];
}

const runs = parseInt(getArg('--runs', '3'));
const label = getArg('--label', `run-${Date.now()}`);
const passthrough = [];

if (args.includes('--verbose')) passthrough.push('--verbose');
if (args.includes('--single-prompt')) passthrough.push('--single-prompt');
if (args.includes('--naive')) passthrough.push('--naive');

const model = getArg('--model', null);
if (model) passthrough.push('--model', model);

const informalizeModel = getArg('--informalize-model', null);
if (informalizeModel) passthrough.push('--informalize-model', informalizeModel);

const compareModel = getArg('--compare-model', null);
if (compareModel) passthrough.push('--compare-model', compareModel);

const concurrency = parseInt(getArg('--concurrency', '1')) || 1;
const domainFilter = getArg('--domain', null);
const DOMAINS = domainFilter ? [domainFilter] : ALL_DOMAINS;

// --- Run a single domain ---

function runDomain(project) {
  const mappingPath = join(MAPPINGS_DIR, `${project.name}.json`);
  const claimsPath = join(CLAIMS_DIR, `${project.name}.dfy`);

  return new Promise((resolve, reject) => {
    execFile('node', [
      BIN, '-m', mappingPath,
      '--dfy', claimsPath,
      '--module', project.module, '-d', project.name,
      '--json', ...passthrough,
    ], { timeout: 600000 }, (err, stdout, stderr) => {
      // Print stderr progress in real time
      if (stderr) process.stderr.write(stderr);

      if (err && !stdout) {
        reject(new Error(`${project.name}: ${err.message}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (e) {
        reject(new Error(`${project.name}: failed to parse JSON output`));
      }
    });
  });
}

// --- Main ---

async function main() {
  const projects = PROJECTS.filter(p => DOMAINS.includes(p.name));

  console.error(`Benchmark: ${label}`);
  console.error(`  runs: ${runs}`);
  console.error(`  domains: ${projects.map(p => p.name).join(', ')}`);
  console.error(`  concurrency: ${concurrency}`);
  console.error(`  passthrough: ${passthrough.join(' ') || '(none)'}`);
  console.error('');

  const allResults = [];
  const totalStart = Date.now();

  for (let run = 1; run <= runs; run++) {
    console.error(`── Run ${run}/${runs} ──`);

    async function processDomain(project) {
      console.error(`  ${project.name}...`);
      const domainStart = Date.now();
      try {
        const result = await runDomain(project);
        const elapsedMs = Date.now() - domainStart;
        const entries = result.results.map(v => ({
          domain: project.name,
          requirement: v.requirement,
          lemmaName: v.lemmaName,
          expected: v.expected ?? 'confirmed',
          status: v.status,
          run,
          elapsedMs,
        }));
        allResults.push(...entries);

        const correct = entries.filter(e => isCorrect(e)).length;
        const total = entries.length;
        console.error(`  ${project.name}: ${correct}/${total} correct (${(elapsedMs / 1000).toFixed(1)}s)`);
      } catch (err) {
        console.error(`  ${project.name}: ERROR — ${err.message}`);
      }
    }

    if (concurrency <= 1) {
      for (const project of projects) {
        await processDomain(project);
      }
    } else {
      let next = 0;
      const workers = Array.from({ length: Math.min(concurrency, projects.length) }, async () => {
        while (next < projects.length) {
          const project = projects[next++];
          await processDomain(project);
        }
      });
      await Promise.all(workers);
    }
    console.error('');
  }

  const totalElapsedMs = Date.now() - totalStart;

  // --- Save results ---

  await mkdir(RESULTS_DIR, { recursive: true });

  const output = {
    label,
    timestamp: new Date().toISOString(),
    config: {
      runs,
      model: model || 'claude-sonnet-4-5-20250929',
      passthrough,
    },
    totalElapsedMs,
    results: allResults,
  };

  const outPath = join(RESULTS_DIR, `${label}.json`);
  await writeFile(outPath, JSON.stringify(output, null, 2));
  console.error(`Saved: ${outPath}`);

  // --- Print summary ---

  const byKey = {};
  for (const r of allResults) {
    const key = `${r.domain}/${r.lemmaName}`;
    if (!byKey[key]) byKey[key] = { domain: r.domain, requirement: r.requirement, lemmaName: r.lemmaName, expected: r.expected, correct: 0, total: 0 };
    byKey[key].total++;
    if (isCorrect(r)) byKey[key].correct++;
  }

  console.error('\nSummary:');
  let currentDomain = null;
  let totalCorrect = 0;
  let totalCount = 0;
  for (const entry of Object.values(byKey)) {
    if (entry.domain !== currentDomain) {
      currentDomain = entry.domain;
      console.error(`  ${currentDomain}`);
    }
    const tag = entry.expected === 'disputed' ? ' [bogus]' : '';
    const name = entry.lemmaName.length > 40
      ? entry.lemmaName.slice(0, 40) + '...'
      : entry.lemmaName;
    console.error(`    ${name.padEnd(43)} ${entry.correct}/${entry.total}${tag}`);
    totalCorrect += entry.correct;
    totalCount += entry.total;
  }
  console.error(`\n  Accuracy: ${totalCorrect}/${totalCount}`);
  console.error(`  Elapsed: ${(totalElapsedMs / 1000).toFixed(1)}s`);
}

function isCorrect(r) {
  if (r.expected === 'disputed') return r.status === 'disputed';
  return r.status === 'confirmed';
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
