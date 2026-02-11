#!/usr/bin/env node
/**
 * Extract claims from all dafny-replay projects.
 * Runs dafny2js --claims on each, saves to test/integration/claims/,
 * and prints a summary table.
 *
 * Usage:
 *   node test/integration/extract-all.js           # extract + summarize
 *   node test/integration/extract-all.js --save     # also save claims JSON
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { PROJECTS, DAFNY_REPLAY, DAFNY2JS } from './projects.js';

const execFileAsync = promisify(execFile);
const CLAIMS_DIR = resolve(import.meta.dirname, 'claims');
const save = process.argv.includes('--save');

async function extractClaims(project) {
  const entryPath = join(DAFNY_REPLAY, project.entry);

  try {
    const dotnet = process.env.DOTNET_PATH || 'dotnet';
    const { stdout, stderr } = await execFileAsync(dotnet, [
      'run', '--no-build', '--',
      '--file', entryPath,
      '--claims',
    ], {
      cwd: DAFNY2JS,
      timeout: 120_000,
      env: { ...process.env },
    });

    return { success: true, claims: JSON.parse(stdout), stderr };
  } catch (err) {
    const output = (err.stdout ?? '') + (err.stderr ?? '');
    return { success: false, error: output || err.message };
  }
}

function summarizeClaims(claims) {
  const preds = claims.predicates?.length ?? 0;
  const predsWithBody = claims.predicates?.filter(p => p.body || p.conjuncts)?.length ?? 0;
  const totalConjuncts = claims.predicates?.reduce((sum, p) => sum + (p.conjuncts?.length ?? 0), 0) ?? 0;
  const lemmas = claims.lemmas?.length ?? 0;
  const ensures = claims.lemmas?.reduce((sum, l) => sum + (l.ensures?.length ?? 0), 0) ?? 0;
  const fns = claims.functions?.length ?? 0;
  const axioms = claims.axioms?.length ?? 0;
  const modules = new Set([
    ...(claims.predicates ?? []).map(p => p.module),
    ...(claims.lemmas ?? []).map(l => l.module),
    ...(claims.functions ?? []).map(f => f.module),
  ]);
  return { preds, predsWithBody, totalConjuncts, lemmas, ensures, fns, axioms, modules: [...modules] };
}

async function main() {
  if (save) {
    await mkdir(CLAIMS_DIR, { recursive: true });
  }

  console.log('Extracting claims from all dafny-replay projects...\n');

  const results = [];

  for (const project of PROJECTS) {
    process.stderr.write(`  ${project.name}...`);
    const result = await extractClaims(project);

    if (!result.success) {
      process.stderr.write(` FAILED\n`);
      results.push({ project, error: result.error });
      continue;
    }

    const summary = summarizeClaims(result.claims);
    process.stderr.write(` ${summary.preds} preds, ${summary.lemmas} lemmas, ${summary.fns} fns, ${summary.axioms} axioms\n`);

    if (save) {
      const outPath = join(CLAIMS_DIR, `${project.name}.json`);
      await writeFile(outPath, JSON.stringify(result.claims, null, 2));
    }

    results.push({ project, claims: result.claims, summary });
  }

  // Print summary table
  console.log('\n## Claims Extraction Summary\n');
  console.log('| Project | Kernel | Predicates | Conjuncts | Lemmas | Ensures | Functions | Axioms | Modules |');
  console.log('|---------|--------|-----------|-----------|--------|---------|-----------|--------|---------|');

  for (const r of results) {
    if (r.error) {
      console.log(`| ${r.project.name} | ${r.project.kernel} | FAILED | | | | | | |`);
      continue;
    }
    const s = r.summary;
    console.log(`| ${r.project.name} | ${r.project.kernel} | ${s.predsWithBody}/${s.preds} | ${s.totalConjuncts} | ${s.lemmas} | ${s.ensures} | ${s.fns} | ${s.axioms} | ${s.modules.length} |`);
  }

  // Print per-project details
  console.log('\n## Per-Project Details\n');

  for (const r of results) {
    if (r.error) {
      console.log(`### ${r.project.name} — FAILED\n`);
      console.log('```');
      console.log(r.error.slice(0, 500));
      console.log('```\n');
      continue;
    }

    console.log(`### ${r.project.name}\n`);
    console.log(`Entry: \`${r.project.entry}\` | Module filter: \`${r.project.module}\` | Kernel: ${r.project.kernel}\n`);

    const c = r.claims;

    // Predicates with bodies
    const realPreds = (c.predicates ?? []).filter(p => p.body || p.conjuncts);
    if (realPreds.length > 0) {
      console.log('**Predicates:**');
      for (const p of realPreds) {
        const nc = p.conjuncts?.length ?? 0;
        console.log(`- \`${p.module}.${p.name}\` — ${nc} conjunct(s)${p.isGhost ? ' (ghost)' : ''}`);
        for (const conj of (p.conjuncts ?? [])) {
          console.log(`  - \`${conj}\``);
        }
      }
      console.log('');
    }

    // Lemmas (grouped by module, only domain module)
    const domainLemmas = (c.lemmas ?? []).filter(l => l.module === r.project.module);
    if (domainLemmas.length > 0) {
      console.log(`**Lemmas (${r.project.module}):**`);
      for (const l of domainLemmas) {
        const req = l.requires.length > 0 ? ` requires ${l.requires.join(', ')}` : '';
        console.log(`- \`${l.name}\`${req} ensures ${l.ensures.join(', ')}`);
      }
      console.log('');
    }

    // Axioms
    if ((c.axioms ?? []).length > 0) {
      console.log('**Axioms:**');
      for (const a of c.axioms) {
        console.log(`- \`${a.module}\` line ${a.line}: \`${a.content}\``);
      }
      console.log('');
    }

    console.log('---\n');
  }

  if (save) {
    console.log(`\nClaims JSON files saved to ${CLAIMS_DIR}/`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
