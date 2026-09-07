/**
 * Dataset loading and reproducible sampling for the v2 model sweep.
 *
 * Pure logic: no API calls, no prompt knowledge. Everything here is
 * deterministic given (rows, n, seed), so the whole sweep can be replayed.
 */

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

/** PRNG copied verbatim from the prior sweep so seeds stay comparable. */
export function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rng) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Read a JSONL dataset and derive the binary label.
 *
 * `expected` is "confirmed" or "disputed" in both v2 datasets; the pipeline's
 * compare step emits a boolean `match`, so the mapping is fixed here once
 * rather than being re-derived at every call site.
 */
export async function loadDataset(path) {
  const rows = [];
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    rows.push({ ...row, expectedMatch: row.expected === 'confirmed' });
  }
  return rows;
}

/**
 * Sample `n` rows, stratified by `variant`.
 *
 * A flat shuffle at small n can return a sample containing no control
 * mutations at all, which would make the smoke stage silently unrepresentative
 * of the false-positive axis this sweep most cares about. Stratifying holds
 * each variant's share of the sample close to its share of the full dataset.
 *
 * Largest-remainder allocation: each stratum gets its floor share, then the
 * leftover slots go to the strata with the largest fractional remainders, so
 * the sample totals exactly n.
 */
export function stratifiedSample(rows, n, seed) {
  if (n >= rows.length) return shuffle(rows, mulberry32(seed));

  const strata = new Map();
  for (const row of rows) {
    const key = row.variant ?? 'unknown';
    if (!strata.has(key)) strata.set(key, []);
    strata.get(key).push(row);
  }

  // Sort strata by key so allocation never depends on Map insertion order,
  // which would make the sample depend on row order in the file.
  const keys = [...strata.keys()].sort();
  const exact = keys.map((k) => (strata.get(k).length / rows.length) * n);
  const alloc = exact.map(Math.floor);

  let remaining = n - alloc.reduce((a, b) => a + b, 0);
  const byRemainder = keys
    .map((k, i) => ({ i, frac: exact[i] - alloc[i] }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let j = 0; remaining > 0; j = (j + 1) % byRemainder.length, remaining--) {
    alloc[byRemainder[j].i]++;
  }

  const rng = mulberry32(seed);
  const out = [];
  keys.forEach((k, i) => {
    out.push(...shuffle(strata.get(k), rng).slice(0, alloc[i]));
  });
  return shuffle(out, rng);
}
