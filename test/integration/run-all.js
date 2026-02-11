#!/usr/bin/env node
/**
 * Run the full claimcheck pipeline on projects with requirements files.
 * Requires:
 *   - claims JSON in test/integration/claims/ (run extract-all.js --save)
 *   - requirements files in test/integration/reqs/
 *   - ANTHROPIC_API_KEY set
 *   - dafny in PATH (for verification)
 *
 * Usage:
 *   node test/integration/run-all.js                    # all projects with reqs
 *   node test/integration/run-all.js counter             # specific project
 *   node test/integration/run-all.js --no-verify         # skip dafny verification
 *   node test/integration/run-all.js --json              # JSON output
 */

import { readFile, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { PROJECTS, DAFNY_REPLAY } from './projects.js';
import { flattenClaims } from '../../src/flatten.js';
import { translateClaims } from '../../src/translate.js';
import { compareClaims } from '../../src/compare.js';
import { proveAll } from '../../src/prove.js';
import { generateObligations, writeObligations } from '../../src/obligations.js';
import { renderReport, renderJson } from '../../src/report.js';

const CLAIMS_DIR = resolve(import.meta.dirname, 'claims');
const REQS_DIR = resolve(import.meta.dirname, 'reqs');
const OUTPUT_DIR = resolve(import.meta.dirname, 'output');

const args = process.argv.slice(2);
const projectFilter = args.find(a => !a.startsWith('--'));
const noVerify = args.includes('--no-verify');
const jsonOutput = args.includes('--json');
const verbose = args.includes('--verbose') || args.includes('-v');

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
  const opts = { verbose };

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

  // Compare
  console.error(`  comparing...`);
  const coverage = await compareClaims(translated, requirementsText, project.name, opts);
  console.error(`  proved=${coverage.proved.length} missing=${coverage.missing.length} unexpected=${coverage.unexpected.length}`);

  // Prove missing
  let proveResults = null;
  if (!noVerify && coverage.missing.length > 0) {
    const dfyPath = join(DAFNY_REPLAY, project.entry);
    const domainSource = await readFile(dfyPath, 'utf-8');

    console.error(`  proving ${coverage.missing.length} missing...`);
    proveResults = await proveAll(
      coverage.missing,
      domainSource,
      dfyPath,
      project.module,
      items,
      project.name,
      { ...opts, retries: 3 },
    );

    const proved = proveResults.filter(r => r.status === 'proved').length;
    const gaps = proveResults.filter(r => r.status === 'gap').length;
    console.error(`  proved=${proved} gaps=${gaps}`);
  }

  // Generate obligations
  let obligationsPath = null;
  const gaps = proveResults?.filter(r => r.status === 'gap') ?? [];
  if (gaps.length > 0) {
    const dfyPath = join(DAFNY_REPLAY, project.entry);
    const { mkdir: mkdirAsync } = await import('node:fs/promises');
    await mkdirAsync(OUTPUT_DIR, { recursive: true });
    const content = generateObligations(gaps, dfyPath, project.module, OUTPUT_DIR);
    if (content) {
      obligationsPath = await writeObligations(content, OUTPUT_DIR);
      // Rename to project-specific file
      const specificPath = join(OUTPUT_DIR, `${project.name}-obligations.dfy`);
      const { rename } = await import('node:fs/promises');
      await rename(obligationsPath, specificPath);
      obligationsPath = specificPath;
      console.error(`  wrote ${specificPath}`);
    }
  }

  return { coverage, proveResults, obligationsPath };
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
    console.error(`\n=== ${project.name} ===`);
    const result = await runProject(project);

    if (!result) continue;

    if (jsonOutput) {
      console.log(renderJson(result.coverage, project.name, result.proveResults, result.obligationsPath));
    } else {
      console.log(renderReport(result.coverage, project.name, result.proveResults, result.obligationsPath));
    }
    console.log('');
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
