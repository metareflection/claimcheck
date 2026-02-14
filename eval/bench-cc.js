#!/usr/bin/env node
/**
 * Claude Code benchmark runner.
 *
 * Runs claimcheck via `claude -p` for each domain/mapping pair.
 * The model sees the full prompt (Dafny code + NL requirement) in one shot —
 * no structural separation. Compare results with the API-based pipeline
 * to measure whether look-ahead matters.
 *
 * Usage:
 *   node eval/bench-cc.js --runs 1 --label cc-sonnet
 *   node eval/bench-cc.js --runs 3 --label cc-opus --model claude-opus-4-6
 */

import { execFile } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { PROJECTS, DAFNY_REPLAY } from '../test/integration/projects.js';
import { extractLemma } from '../src/extract.js';
import { CLAIMCHECK_PROMPT } from '../src/prompts.js';

const ROOT = resolve(import.meta.dirname, '..');
const REQS_DIR = resolve(ROOT, 'test/integration/reqs');
const MAPPINGS_DIR = resolve(ROOT, 'test/integration/mappings');
const CLAIMS_DIR = resolve(ROOT, 'test/integration/claims');
const RESULTS_DIR = resolve(ROOT, 'eval/results');

const ALL_DOMAINS = ['counter', 'kanban', 'colorwheel', 'canon', 'delegation-auth'];

// --- Parse args ---

const args = process.argv.slice(2);

function getArg(name, defaultVal) {
  const i = args.indexOf(name);
  if (i === -1) return defaultVal;
  return args[i + 1];
}

const runs = parseInt(getArg('--runs', '1'));
const label = getArg('--label', `cc-${Date.now()}`);
const model = getArg('--model', null);
const verbose = args.includes('--verbose');

const domainFilter = getArg('--domain', null);
const DOMAINS = domainFilter ? [domainFilter] : ALL_DOMAINS;

// --- Call claude -p ---

function callClaude(prompt) {
  const ccArgs = ['-p', prompt, '--output-format', 'text'];
  if (model) ccArgs.push('--model', model);

  return new Promise((resolve, reject) => {
    execFile('claude', ccArgs, { timeout: 120000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (verbose && stderr) process.stderr.write(stderr);
      if (err) {
        reject(new Error(`claude -p failed: ${err.message}`));
        return;
      }
      resolve(stdout);
    });
  });
}

// --- Parse verdict from markdown output ---

function parseVerdict(output) {
  // Look for **Verdict:** JUSTIFIED|PARTIALLY_JUSTIFIED|NOT_JUSTIFIED|VACUOUS
  const match = output.match(/\*\*Verdict:\*\*\s*(JUSTIFIED|PARTIALLY[_ ]JUSTIFIED|NOT[_ ]JUSTIFIED|VACUOUS)/i);
  if (match) {
    return match[1].toUpperCase().replace(/\s+/g, '_');
  }
  // Fallback: look for verdict without bold
  const fallback = output.match(/Verdict:\s*(JUSTIFIED|PARTIALLY[_ ]JUSTIFIED|NOT[_ ]JUSTIFIED|VACUOUS)/i);
  if (fallback) {
    return fallback[1].toUpperCase().replace(/\s+/g, '_');
  }
  return null;
}

// --- Main ---

async function main() {
  const projects = PROJECTS.filter(p => DOMAINS.includes(p.name));

  console.error(`Claude Code Benchmark: ${label}`);
  console.error(`  runs: ${runs}`);
  console.error(`  model: ${model || '(default)'}`);
  console.error(`  domains: ${projects.map(p => p.name).join(', ')}`);
  console.error('');

  const allResults = [];
  const totalStart = Date.now();

  for (let run = 1; run <= runs; run++) {
    console.error(`── Run ${run}/${runs} ──`);

    for (const project of projects) {
      console.error(`  ${project.name}...`);
      const domainStart = Date.now();

      // Load claims source (where lemmas live) and mapping
      const claimsPath = join(CLAIMS_DIR, `${project.name}.dfy`);
      const dfySource = await readFile(claimsPath, 'utf-8');
      const mappingPath = join(MAPPINGS_DIR, `${project.name}.json`);
      const mapping = JSON.parse(await readFile(mappingPath, 'utf-8'));

      for (const entry of mapping) {
        const code = extractLemma(dfySource, entry.lemmaName);
        if (!code) {
          console.error(`    ${entry.lemmaName}: NOT FOUND`);
          allResults.push({
            domain: project.name,
            requirement: entry.requirement,
            lemmaName: entry.lemmaName,
            expected: entry.expected ?? 'confirmed',
            status: 'error',
            verdict: null,
            run,
          });
          continue;
        }

        const prompt = CLAIMCHECK_PROMPT(project.name, entry.lemmaName, code, entry.requirement);

        try {
          const output = await callClaude(prompt);
          const verdict = parseVerdict(output);

          if (verbose) {
            console.error(`    --- ${entry.lemmaName} output ---`);
            console.error(output.slice(0, 500));
            console.error('    ---');
          }

          const status = verdict === 'JUSTIFIED' ? 'confirmed' : 'disputed';

          console.error(`    ${entry.lemmaName}: ${verdict || 'PARSE_FAILED'} → ${status}`);

          allResults.push({
            domain: project.name,
            requirement: entry.requirement,
            lemmaName: entry.lemmaName,
            expected: entry.expected ?? 'confirmed',
            status,
            verdict,
            run,
          });
        } catch (err) {
          console.error(`    ${entry.lemmaName}: ERROR — ${err.message}`);
          allResults.push({
            domain: project.name,
            requirement: entry.requirement,
            lemmaName: entry.lemmaName,
            expected: entry.expected ?? 'confirmed',
            status: 'error',
            verdict: null,
            run,
          });
        }
      }

      const domainElapsedMs = Date.now() - domainStart;
      const entries = allResults.filter(r => r.domain === project.name && r.run === run);
      const correct = entries.filter(e => isCorrect(e)).length;
      console.error(`  ${project.name}: ${correct}/${entries.length} correct (${(domainElapsedMs / 1000).toFixed(1)}s)`);
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
      model: model || '(claude-code default)',
      mode: 'claude-code',
    },
    totalElapsedMs: Date.now() - totalStart,
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
  const totalElapsedMs = Date.now() - totalStart;
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
