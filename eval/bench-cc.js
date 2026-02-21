#!/usr/bin/env node
/**
 * Claude Code benchmark runner.
 *
 * Runs claimcheck via `claude -p` for each domain/mapping pair,
 * using the library's --claude-code backend.
 *
 * Usage:
 *   node eval/bench-cc.js --runs 1 --label cc-sonnet
 *   node eval/bench-cc.js --runs 3 --label cc-opus --model claude-opus-4-6
 *   node eval/bench-cc.js --runs 3 --label cc-twopass --two-pass
 *   node eval/bench-cc.js --runs 3 --label cc-twopass --two-pass --informalize-model haiku --compare-model sonnet
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { PROJECTS } from '../test/integration/projects.js';
import { extractLemma } from '../src/extract.js';
import { claimcheck } from '../src/claimcheck.js';

const ROOT = resolve(import.meta.dirname, '..');
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

const useNaive = args.includes('--naive');
const useTwoPass = args.includes('--two-pass');
const useSinglePrompt = !useTwoPass && !useNaive;
const informalizeModel = getArg('--informalize-model', null);
const compareModel = getArg('--compare-model', null);
const domainFilter = getArg('--domain', null);
const DOMAINS = domainFilter ? [domainFilter] : ALL_DOMAINS;
const lemmaFilter = getArg('--lemma', null);

// --- Main ---

async function main() {
  const projects = PROJECTS.filter(p => DOMAINS.includes(p.name));

  const mode = useTwoPass ? 'two-pass' : useNaive ? 'naive' : 'single-prompt';
  console.error(`Claude Code Benchmark: ${label}`);
  console.error(`  runs: ${runs}`);
  console.error(`  mode: ${mode}`);
  console.error(`  model: ${model || '(default)'}`);
  if (useTwoPass) {
    console.error(`  informalize-model: ${informalizeModel || model || '(default)'}`);
    console.error(`  compare-model: ${compareModel || model || '(default)'}`);
  }
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
      let mapping = JSON.parse(await readFile(mappingPath, 'utf-8'));
      if (lemmaFilter) mapping = mapping.filter(e => e.lemmaName === lemmaFilter);

      // Extract lemma code for each mapping entry
      const claims = [];
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
        claims.push({
          requirement: entry.requirement,
          lemmaName: entry.lemmaName,
          dafnyCode: code,
          expected: entry.expected ?? 'confirmed',
        });
      }

      if (claims.length === 0) continue;

      try {
        const opts = {
          claudeCode: true,
          verbose,
          // Two-pass (roundtrip) is the default when neither singlePrompt nor naive is set
          singlePrompt: useSinglePrompt,
          naive: useNaive,
          ...(model ? { model } : {}),
          ...(informalizeModel ? { informalizeModel } : {}),
          ...(compareModel ? { compareModel } : {}),
        };

        const { results } = await claimcheck({
          claims,
          domain: project.name,
          options: opts,
        });

        for (const r of results) {
          const expected = claims.find(c => c.lemmaName === r.lemmaName)?.expected ?? 'confirmed';
          console.error(`    ${r.lemmaName}: ${r.status}`);
          allResults.push({
            domain: project.name,
            requirement: r.requirement,
            lemmaName: r.lemmaName,
            expected,
            status: r.status,
            verdict: r.status === 'confirmed' ? 'JUSTIFIED' : 'NOT_JUSTIFIED',
            run,
          });
        }
      } catch (err) {
        console.error(`    ERROR: ${err.message}`);
        for (const c of claims) {
          allResults.push({
            domain: project.name,
            requirement: c.requirement,
            lemmaName: c.lemmaName,
            expected: c.expected,
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
      informalizeModel: useTwoPass ? (informalizeModel || model || '(claude-code default)') : undefined,
      compareModel: useTwoPass ? (compareModel || model || '(claude-code default)') : undefined,
      mode: useTwoPass ? 'claude-code-two-pass' : useNaive ? 'claude-code-naive' : 'claude-code',
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
