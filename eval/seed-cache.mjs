#!/usr/bin/env node
/**
 * Seed the eval cache by running the flatten → translate → compare pipeline
 * for each project and saving the outputs.
 *
 * Usage:
 *   node eval/seed-cache.mjs              # all projects
 *   node eval/seed-cache.mjs counter      # specific project
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { flattenClaims } from '../src/flatten.js';
import { translateClaims } from '../src/translate.js';
import { compareClaims } from '../src/compare.js';

const ROOT = resolve(import.meta.dirname, '..');
const CLAIMS_DIR = join(ROOT, 'test/integration/claims');
const REQS_DIR = join(ROOT, 'test/integration/reqs');
const CACHE_DIR = join(ROOT, 'eval/cache');

const PROJECTS = [
  { name: 'counter', module: 'CounterDomain' },
  { name: 'kanban', module: 'KanbanDomain' },
  { name: 'colorwheel', module: 'ColorWheelDomain' },
  { name: 'canon', module: 'CanonDomain' },
  { name: 'delegation-auth', module: 'DelegationAuthDomain' },
];

async function seedProject(project) {
  const claimsPath = join(CLAIMS_DIR, `${project.name}.json`);
  const reqsPath = join(REQS_DIR, `${project.name}.md`);

  const claims = JSON.parse(await readFile(claimsPath, 'utf-8'));
  const requirementsText = await readFile(reqsPath, 'utf-8');

  // Flatten
  const items = flattenClaims(claims, project.module);
  console.error(`  ${items.length} flattened claims`);

  if (items.length === 0) {
    console.error(`  [skip] no claims`);
    return;
  }

  // Translate
  console.error(`  translating...`);
  const translated = await translateClaims(items, project.name);

  // Compare
  console.error(`  comparing...`);
  const coverage = await compareClaims(translated, requirementsText, project.name);
  const proved = coverage.proved ?? [];
  const missing = coverage.missing ?? [];
  const unexpected = coverage.unexpected ?? [];
  console.error(`  proved=${proved.length} missing=${missing.length} unexpected=${unexpected.length}`);

  // Save to cache
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(
    join(CACHE_DIR, `${project.name}-translated.json`),
    JSON.stringify(translated, null, 2),
  );
  await writeFile(
    join(CACHE_DIR, `${project.name}-coverage.json`),
    JSON.stringify(coverage, null, 2),
  );
  console.error(`  cached.`);
}

async function main() {
  const filter = process.argv[2];
  const projects = filter
    ? PROJECTS.filter(p => p.name === filter)
    : PROJECTS;

  if (projects.length === 0) {
    console.error(`No project matching "${filter}"`);
    process.exit(1);
  }

  for (const project of projects) {
    console.error(`\n=== ${project.name} ===`);
    await seedProject(project);
  }

  console.error('\nCache seeded successfully.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
