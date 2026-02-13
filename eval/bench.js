#!/usr/bin/env node
/**
 * Benchmark runner. Runs all domains N times, saves per-requirement results.
 *
 * Usage:
 *   node eval/bench.js --runs 3 --label baseline
 *   node eval/bench.js --runs 3 --label erased --erase
 *   node eval/bench.js --runs 3 --label opus --model claude-opus-4-6
 */

import { execFile } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { PROJECTS, DAFNY_REPLAY } from '../test/integration/projects.js';

const ROOT = resolve(import.meta.dirname, '..');
const REQS_DIR = resolve(ROOT, 'test/integration/reqs');
const RESULTS_DIR = resolve(ROOT, 'eval/results');
const BIN = resolve(ROOT, 'bin/claimcheck.js');

const DOMAINS = ['counter', 'kanban', 'colorwheel', 'canon', 'delegation-auth'];

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

if (args.includes('--erase')) passthrough.push('--erase');
if (args.includes('--verbose')) passthrough.push('--verbose');

const model = getArg('--model', null);
if (model) passthrough.push('--model', model);

// --- Run a single domain ---

function runDomain(project) {
  const reqsPath = join(REQS_DIR, `${project.name}.md`);
  const dfyPath = join(DAFNY_REPLAY, project.entry);

  return new Promise((resolve, reject) => {
    execFile('node', [
      BIN, '-r', reqsPath, '--dfy', dfyPath,
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
  console.error(`  passthrough: ${passthrough.join(' ') || '(none)'}`);
  console.error('');

  const allResults = [];

  for (let run = 1; run <= runs; run++) {
    console.error(`── Run ${run}/${runs} ──`);

    for (const project of projects) {
      console.error(`  ${project.name}...`);
      try {
        const result = await runDomain(project);
        const requirements = result.verification.map(v => ({
          domain: project.name,
          requirement: v.requirement,
          status: v.status,
          strategy: v.strategy || null,
          attempts: v.attempts,
          correctGap: v.correctGap || false,
          run,
        }));
        allResults.push(...requirements);

        const proved = result.verification.filter(v => v.status === 'proved').length;
        const correctGaps = result.verification.filter(v => v.correctGap).length;
        const total = result.verification.length;
        const covered = proved + correctGaps;
        console.error(`  ${project.name}: ${covered}/${total} (${proved} proved, ${correctGaps} correct gaps)`);
      } catch (err) {
        console.error(`  ${project.name}: ERROR — ${err.message}`);
      }
    }
    console.error('');
  }

  // --- Save results ---

  await mkdir(RESULTS_DIR, { recursive: true });

  const output = {
    label,
    timestamp: new Date().toISOString(),
    config: {
      runs,
      model: model || 'claude-sonnet-4-5-20250929',
      erase: args.includes('--erase'),
      passthrough,
    },
    results: allResults,
  };

  const outPath = join(RESULTS_DIR, `${label}.json`);
  await writeFile(outPath, JSON.stringify(output, null, 2));
  console.error(`Saved: ${outPath}`);

  // --- Print summary ---

  const byReq = {};
  for (const r of allResults) {
    const key = `${r.domain}/${r.requirement}`;
    if (!byReq[key]) byReq[key] = { domain: r.domain, requirement: r.requirement, passed: 0, total: 0, correctGap: r.correctGap };
    byReq[key].total++;
    if (r.status === 'proved') byReq[key].passed++;
  }

  console.error('\nSummary:');
  let currentDomain = null;
  let totalPassed = 0;
  let totalCount = 0;
  let totalCorrectGaps = 0;
  for (const entry of Object.values(byReq)) {
    if (entry.domain !== currentDomain) {
      currentDomain = entry.domain;
      console.error(`  ${currentDomain}`);
    }
    const short = entry.requirement.length > 50
      ? entry.requirement.slice(0, 50) + '...'
      : entry.requirement;
    const tag = entry.correctGap ? ' [gap]' : '';
    console.error(`    ${short.padEnd(55)} ${entry.passed}/${entry.total}${tag}`);
    totalPassed += entry.passed;
    totalCount += entry.total;
    if (entry.correctGap) totalCorrectGaps += entry.total;
  }
  const provable = totalCount - totalCorrectGaps;
  console.error(`\n  Total: ${totalPassed}/${provable} proved (${totalCorrectGaps} correct gap runs excluded)`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
