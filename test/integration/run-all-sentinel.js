#!/usr/bin/env node
/**
 * Run the NEW sentinel proof pipeline on all projects with requirements files.
 * Uses: flatten → translate → match → prove → obligations → report
 *
 * (The original run-all.js uses the legacy compare pipeline.)
 *
 * Requires:
 *   - claims JSON in test/integration/claims/ (run extract-all.js --save)
 *   - requirements files in test/integration/reqs/
 *   - ANTHROPIC_API_KEY set
 *   - dafny in PATH (for verification)
 *
 * Usage:
 *   node test/integration/run-all-sentinel.js                 # all projects with reqs
 *   node test/integration/run-all-sentinel.js counter          # specific project
 *   node test/integration/run-all-sentinel.js --no-verify      # match only, skip dafny
 *   node test/integration/run-all-sentinel.js --json           # JSON output
 *   node test/integration/run-all-sentinel.js --model claude-opus-4-6  # override model
 */

import { readFile, access, mkdir, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { PROJECTS, DAFNY_REPLAY } from './projects.js';
import { flattenClaims } from '../../src/flatten.js';
import { translateClaims } from '../../src/translate.js';
import { matchClaims } from '../../src/match.js';
import { proveAll } from '../../src/prove.js';
import { generateObligations, writeObligations } from '../../src/obligations.js';
import { renderReport, renderJson } from '../../src/report.js';

const CLAIMS_DIR = resolve(import.meta.dirname, 'claims');
const REQS_DIR = resolve(import.meta.dirname, 'reqs');
const OUTPUT_DIR = resolve(import.meta.dirname, 'output');

const args = process.argv.slice(2);
const noVerify = args.includes('--no-verify');
const jsonOutput = args.includes('--json');
const verbose = args.includes('--verbose') || args.includes('-v');
const modelIdx = args.findIndex(a => a === '--model');
const model = modelIdx !== -1 ? args[modelIdx + 1] : undefined;

// Positional project filter: skip flag values (--flag) and their arguments (--model X)
const flagsWithValue = new Set(['--model']);
let projectFilter;
for (let i = 0; i < args.length; i++) {
  if (flagsWithValue.has(args[i])) { i++; continue; }
  if (args[i].startsWith('--')) continue;
  projectFilter = args[i];
  break;
}

async function fileExists(path) {
  try { await access(path); return true; } catch { return false; }
}

async function runProject(project) {
  const claimsPath = join(CLAIMS_DIR, `${project.name}.json`);
  const reqsPath = join(REQS_DIR, `${project.name}.md`);

  if (!await fileExists(claimsPath)) {
    console.error(`  [skip] no claims file — run extract-all.js --save`);
    return null;
  }
  if (!await fileExists(reqsPath)) {
    console.error(`  [skip] no requirements file at ${reqsPath}`);
    return null;
  }

  const claims = JSON.parse(await readFile(claimsPath, 'utf-8'));
  const requirementsText = await readFile(reqsPath, 'utf-8');
  const opts = { verbose, retries: 3, ...(model ? { model } : {}) };

  // Flatten
  const items = flattenClaims(claims, project.module);
  console.error(`  ${items.length} claim items`);

  if (items.length === 0) {
    console.error(`  [skip] no claims after filtering to ${project.module}`);
    return null;
  }

  // Translate
  console.error(`  translating...`);
  const translated = await translateClaims(items, project.name, opts);

  // Match (candidate hints, not verdicts)
  console.error(`  matching...`);
  const matchResult = await matchClaims(translated, requirementsText, project.name, opts);
  matchResult.matches ??= [];
  matchResult.unexpected ??= [];
  const withCandidates = matchResult.matches.filter(m => (m.candidates?.length ?? 0) > 0).length;
  console.error(`  ${matchResult.matches.length} requirements (${withCandidates} with candidates), ${matchResult.unexpected.length} unexpected`);

  // Prove all requirements via strategy escalation
  let proveResults = null;
  if (!noVerify) {
    const dfyPath = join(DAFNY_REPLAY, project.entry);
    const domainSource = await readFile(dfyPath, 'utf-8');

    console.error(`  proving ${matchResult.matches.length} requirements...`);
    proveResults = await proveAll(
      matchResult.matches,
      translated,
      domainSource,
      dfyPath,
      project.module,
      project.name,
      opts,
    );

    const proved = proveResults.filter(r => r.status === 'proved');
    const gaps = proveResults.filter(r => r.status === 'gap');
    const direct = proved.filter(r => r.strategy === 'direct').length;
    const llmGuided = proved.filter(r => r.strategy === 'llm-guided' || r.strategy === 'retry').length;
    console.error(`  proved=${proved.length} (${direct} direct, ${llmGuided} llm-guided), gaps=${gaps.length}`);
  }

  // Generate obligations
  let obligationsPath = null;
  const gaps = proveResults?.filter(r => r.status === 'gap') ?? [];
  if (gaps.length > 0) {
    const dfyPath = join(DAFNY_REPLAY, project.entry);
    await mkdir(OUTPUT_DIR, { recursive: true });
    const content = generateObligations(gaps, dfyPath, project.module, OUTPUT_DIR);
    if (content) {
      obligationsPath = await writeObligations(content, OUTPUT_DIR);
      const specificPath = join(OUTPUT_DIR, `${project.name}-obligations.dfy`);
      await rename(obligationsPath, specificPath);
      obligationsPath = specificPath;
      console.error(`  wrote ${specificPath}`);
    }
  }

  return { matchResult, proveResults, obligationsPath };
}

async function main() {
  const projects = projectFilter
    ? PROJECTS.filter(p => p.name === projectFilter)
    : PROJECTS;

  if (projects.length === 0) {
    console.error(`No project matching "${projectFilter}". Available: ${PROJECTS.map(p => p.name).join(', ')}`);
    process.exit(1);
  }

  for (const project of projects) {
    console.error(`\n=== ${project.name} (sentinel pipeline) ===`);
    const result = await runProject(project);

    if (!result) continue;

    if (jsonOutput) {
      console.log(renderJson(result.matchResult, project.name, result.proveResults, result.obligationsPath));
    } else {
      console.log(renderReport(result.matchResult, project.name, result.proveResults, result.obligationsPath));
    }
    console.log('');
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
