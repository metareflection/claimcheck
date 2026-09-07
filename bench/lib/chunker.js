/**
 * Group rows into multi-row API calls.
 *
 * Two constraints, in priority order:
 *
 *   1. HARD -- no two rows in a chunk may share a mutation family. A family is
 *      keyed by `mutation_of ?? id`, so an original and each of its mutations
 *      all share one key. Violating this lets the model spot a mutation by
 *      diffing it against its sibling in the same prompt instead of judging it
 *      against the requirement, which inflates every score.
 *
 *   2. SOFT -- all rows in a chunk share one `category`. For spider that is the
 *      DB name, so a single CREATE TABLE block serves the whole chunk instead
 *      of being repeated per row (20 distinct schemas across 1284 rows).
 *      clover has `category: null` on every row, which forms one bucket and is
 *      harmless because clover carries no context.
 *
 * Chunking is what makes this sweep finish in ~2 hours instead of ~17: one row
 * per call across 24 model-steps is ~31k calls, chunked it is ~3k.
 */

const familyOf = (row) => row.mutation_of ?? row.id;

export function chunkRows(rows, { chunkSize = 10 } = {}) {
  const byCategory = new Map();
  for (const row of rows) {
    const key = row.category ?? '__none__';
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key).push(row);
  }

  const chunks = [];
  // Sorted so output never depends on Map insertion order.
  for (const key of [...byCategory.keys()].sort()) {
    chunks.push(...chunkOneCategory(byCategory.get(key), chunkSize));
  }
  return chunks;
}

/**
 * Round-robin across families so each chunk draws at most one row per family.
 *
 * Taking one row from each family in turn means a chunk can only repeat a
 * family if fewer than chunkSize families still have rows -- and the loop
 * closes the chunk at that point rather than reusing a family. A family with
 * more rows than there are other families simply yields short chunks, which is
 * correct: legality beats packing efficiency.
 */
function chunkOneCategory(rows, chunkSize) {
  const families = new Map();
  for (const row of rows) {
    const key = familyOf(row);
    if (!families.has(key)) families.set(key, []);
    families.get(key).push(row);
  }

  const queues = [...families.keys()].sort().map((k) => families.get(k));
  const chunks = [];
  let current = [];
  const usedInCurrent = new Set();

  while (queues.some((q) => q.length > 0)) {
    let placedThisPass = false;
    for (const queue of queues) {
      if (queue.length === 0) continue;
      const family = familyOf(queue[0]);
      if (usedInCurrent.has(family)) continue;
      current.push(queue.shift());
      usedInCurrent.add(family);
      placedThisPass = true;
      if (current.length === chunkSize) {
        chunks.push(current);
        current = [];
        usedInCurrent.clear();
      }
    }
    // Nothing could be placed without repeating a family: close the chunk
    // short and start a fresh one.
    if (!placedThisPass) {
      if (current.length > 0) {
        chunks.push(current);
        current = [];
      }
      usedInCurrent.clear();
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}
