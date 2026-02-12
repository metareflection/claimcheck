/**
 * Performance assertion for promptfoo.
 * Extracts timing and token usage from pipeline output as namedScores.
 * Always passes — this is for reporting, not gating.
 */

export default async function performance(output) {
  const data = typeof output === 'string' ? JSON.parse(output) : output;
  const { timing } = data;

  if (!timing) {
    return { pass: true, score: 0, reason: 'No timing data' };
  }

  return {
    pass: true,
    score: 1,
    reason: `translate=${timing.translateMs}ms, compare=${timing.compareMs}ms, total=${timing.totalMs}ms`,
    namedScores: {
      translateMs: timing.translateMs,
      compareMs: timing.compareMs,
      totalMs: timing.totalMs,
      inputTokens: timing.tokens?.input ?? 0,
      outputTokens: timing.tokens?.output ?? 0,
    },
  };
}
