import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { flattenClaims } from '../src/flatten.js';

test('flattenClaims filters to CounterDomain', async () => {
  const claims = JSON.parse(await readFile(new URL('./fixtures/counter-claims.json', import.meta.url), 'utf-8'));
  const items = flattenClaims(claims, 'CounterDomain');

  // Should have: 1 predicate conjunct (m >= 0), 2 lemma ensures (deduped), 1 function requires
  assert.ok(items.length > 0, 'Should have items');

  const kinds = items.map(i => i.kind);
  assert.ok(kinds.includes('invariant-conjunct'), 'Should have invariant conjuncts');
  assert.ok(kinds.includes('lemma-ensures'), 'Should have lemma ensures');

  // Check deduplication: CounterDomain.InitSatisfiesInv has duplicate ensures
  const initEnsures = items.filter(i => i.id.startsWith('lemma:CounterDomain.InitSatisfiesInv'));
  assert.equal(initEnsures.length, 1, 'Duplicate ensures should be deduped');

  console.log(`Flattened ${items.length} items from CounterDomain`);
  for (const item of items) {
    console.log(`  ${item.id}: ${item.formalText}`);
  }
});

test('flattenClaims without module returns all', async () => {
  const claims = JSON.parse(await readFile(new URL('./fixtures/counter-claims.json', import.meta.url), 'utf-8'));
  const all = flattenClaims(claims);
  const filtered = flattenClaims(claims, 'CounterDomain');

  assert.ok(all.length > filtered.length, 'Unfiltered should have more items');
});
