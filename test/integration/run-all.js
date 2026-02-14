#!/usr/bin/env node
/**
 * Run the claimcheck audit pipeline on all test projects with mapping files.
 *
 * Usage:
 *   node test/integration/run-all.js                # all projects
 *   node test/integration/run-all.js counter         # specific project
 *   node test/integration/run-all.js --json          # JSON output
 *   node test/integration/run-all.js --verbose       # verbose logging
 */

import { main } from '../../src/main.js';
import { access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { PROJECTS, DAFNY_REPLAY } from './projects.js';

const MAPPINGS_DIR = resolve(import.meta.dirname, 'mappings');
const CLAIMS_DIR = resolve(import.meta.dirname, 'claims');

const args = process.argv.slice(2);
const projectFilter = args.find(a => !a.startsWith('--'));
const passthrough = args.filter(a => a.startsWith('--'));

async function fileExists(path) {
  try { await access(path); return true; } catch { return false; }
}

// Projects that have mapping files
const PROJECTS_WITH_REQS = PROJECTS.filter(p =>
  ['counter', 'kanban', 'colorwheel', 'canon', 'delegation-auth'].includes(p.name)
);

async function run() {
  const projects = projectFilter
    ? PROJECTS_WITH_REQS.filter(p => p.name === projectFilter)
    : PROJECTS_WITH_REQS;

  if (projects.length === 0) {
    const available = PROJECTS_WITH_REQS.map(p => p.name).join(', ');
    console.error(`No project matching "${projectFilter}". Available: ${available}`);
    process.exit(1);
  }

  for (const project of projects) {
    const mappingPath = join(MAPPINGS_DIR, `${project.name}.json`);
    const claimsPath = join(CLAIMS_DIR, `${project.name}.dfy`);

    if (!await fileExists(mappingPath)) {
      console.error(`\n=== ${project.name} [skip] no mapping file ===`);
      continue;
    }
    if (!await fileExists(claimsPath)) {
      console.error(`\n=== ${project.name} [skip] no claims file ===`);
      continue;
    }

    console.error(`\n${'='.repeat(60)}`);
    console.error(`=== ${project.name}`);
    console.error(`${'='.repeat(60)}`);

    await main([
      '-m', mappingPath,
      '--dfy', claimsPath,
      '--module', project.module,
      '-d', project.name,
      ...passthrough,
    ]);
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
