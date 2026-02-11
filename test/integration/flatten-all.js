#!/usr/bin/env node
/**
 * Flatten claims from all projects and show what claimcheck sees.
 * Requires claims JSON files in test/integration/claims/ (run extract-all.js --save first).
 *
 * Usage:
 *   node test/integration/flatten-all.js
 */

import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { PROJECTS } from './projects.js';
import { flattenClaims } from '../../src/flatten.js';

const CLAIMS_DIR = resolve(import.meta.dirname, 'claims');

async function main() {
  console.log('## Flattened Claims Per Project\n');
  console.log('These are the claim items claimcheck works with (after module filtering and deduplication).\n');

  let grandTotal = 0;

  for (const project of PROJECTS) {
    const claimsPath = join(CLAIMS_DIR, `${project.name}.json`);

    let claims;
    try {
      claims = JSON.parse(await readFile(claimsPath, 'utf-8'));
    } catch {
      console.log(`### ${project.name} — no claims file (run extract-all.js --save first)\n`);
      continue;
    }

    // Flatten with module filter
    const filtered = flattenClaims(claims, project.module);
    // Also flatten without filter for comparison
    const all = flattenClaims(claims);

    console.log(`### ${project.name}\n`);
    console.log(`Module: \`${project.module}\` | Filtered: ${filtered.length} items | All: ${all.length} items\n`);

    if (filtered.length === 0) {
      console.log(`(no items after filtering to ${project.module} — try without --module)\n`);
      // Show all items grouped by module
      const byModule = {};
      for (const item of all) {
        const mod = item.context.module;
        if (!byModule[mod]) byModule[mod] = [];
        byModule[mod].push(item);
      }
      for (const [mod, items] of Object.entries(byModule)) {
        console.log(`  ${mod}: ${items.length} items`);
      }
      console.log('');
    }

    const byKind = {};
    for (const item of filtered) {
      if (!byKind[item.kind]) byKind[item.kind] = [];
      byKind[item.kind].push(item);
    }

    for (const [kind, items] of Object.entries(byKind)) {
      console.log(`**${kind}** (${items.length}):`);
      for (const item of items) {
        console.log(`- \`${item.id}\`: \`${item.formalText}\``);
      }
      console.log('');
    }

    grandTotal += filtered.length;
    console.log('---\n');
  }

  console.log(`**Total: ${grandTotal} claim items across ${PROJECTS.length} projects**`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
