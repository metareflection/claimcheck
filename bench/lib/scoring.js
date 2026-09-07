/**
 * Metrics for the v2 sweep. Pure: no I/O, no API knowledge.
 *
 * The headline is balanced accuracy, not raw accuracy. clover is 25/75
 * confirmed/disputed, so a model that answers "disputed" every single time
 * scores 74.6% raw -- close enough to the prior sweep's real headline numbers
 * to be actively misleading. Balanced accuracy (the mean of per-class recall)
 * scores that same degenerate model at 0.50, and `predictedConfirmedRate`
 * makes the degeneracy visible directly.
 */

function mean(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

/** Nearest-rank percentile: p50 of 5 sorted values is the 3rd. */
function percentile(sorted, p) {
  if (!sorted.length) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

function accuracyOf(results) {
  const scored = results.filter((r) => r.predictedMatch !== null);
  if (!scored.length) return null;
  return scored.filter((r) => r.predictedMatch === r.row.expectedMatch).length / scored.length;
}

function groupAccuracy(results, keyFn) {
  const out = {};
  for (const r of results) {
    const key = keyFn(r.row);
    if (key === null || key === undefined) continue;
    (out[key] ??= []).push(r);
  }
  // `n` is the scored count: accuracyOf ignores unparseable rows, so the group
  // size would be a denominator the printed percentage was not computed over.
  return Object.fromEntries(
    Object.entries(out).map(([k, rs]) => {
      const scored = rs.filter((r) => r.predictedMatch !== null);
      return [k, { n: scored.length, nTotal: rs.length, accuracy: accuracyOf(rs) }];
    }),
  );
}

export function score(results) {
  const scored = results.filter((r) => r.predictedMatch !== null);
  const confirmed = scored.filter((r) => r.row.expectedMatch);
  const disputed = scored.filter((r) => !r.row.expectedMatch);

  const recallConfirmed = confirmed.length
    ? confirmed.filter((r) => r.predictedMatch === true).length / confirmed.length
    : null;
  const recallDisputed = disputed.length
    ? disputed.filter((r) => r.predictedMatch === false).length / disputed.length
    : null;

  const balancedAccuracy =
    recallConfirmed === null || recallDisputed === null
      ? null
      : (recallConfirmed + recallDisputed) / 2;

  const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
  const untrackedChunks = results.filter((r) => r.cost === null).length;

  return {
    n: results.length,
    scored: scored.length,
    unparseable: results.length - scored.length,
    balancedAccuracy,
    accuracy: accuracyOf(results),
    recallConfirmed,
    recallDisputed,
    predictedConfirmedRate: scored.length
      ? scored.filter((r) => r.predictedMatch === true).length / scored.length
      : null,
    byVariant: groupAccuracy(results, (row) => row.variant),
    byCloverClass: groupAccuracy(results, (row) => row.clover_class),
    latency: {
      meanMs: mean(latencies),
      p50Ms: percentile(latencies, 50),
      p95Ms: percentile(latencies, 95),
    },
    totalCost: results.reduce((a, r) => a + (r.cost ?? 0), 0),
    costTracked: untrackedChunks === 0,
    untrackedChunks,
    // What a model that ignores its input entirely would score. Printed at the
    // top of every table so no result can be read without its floor.
    constantFloor: {
      alwaysConfirmed: scored.length ? confirmed.length / scored.length : null,
      alwaysDisputed: scored.length ? disputed.length / scored.length : null,
    },
  };
}
