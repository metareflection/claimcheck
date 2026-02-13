import { getTokenUsage } from './api.js';

/**
 * Render a coverage report as markdown.
 *
 * @param {string} domain
 * @param {object[]} proveResults - from prove step
 * @param {string|null} obligationsPath - path to obligations.dfy if generated
 * @returns {string}
 */
export function renderReport(domain, proveResults, obligationsPath = null) {
  const lines = [];
  lines.push(`# Coverage Report: ${domain}\n`);

  const proved = proveResults.filter((r) => r.status === 'proved');
  const gaps = proveResults.filter((r) => r.status === 'gap');
  const correctGaps = gaps.filter((r) => r.correctGap);
  const realGaps = gaps.filter((r) => !r.correctGap);

  // --- Summary ---

  lines.push(`## Summary\n`);

  const direct = proved.filter((r) => r.strategy === 'direct').length;
  const proof = proved.filter((r) => r.strategy === 'proof').length;
  const proofRetry = proved.filter((r) => r.strategy === 'proof-retry').length;
  const roundtripFail = realGaps.filter((r) => r.strategy === 'roundtrip-fail').length;
  const otherGaps = realGaps.length - roundtripFail;
  const covered = proved.length + correctGaps.length;

  lines.push(`- **Requirements covered:** ${covered}/${proveResults.length}`);
  if (proved.length > 0) {
    lines.push(`  - formally verified: ${proved.length}`);
    if (direct > 0) lines.push(`    - via empty body (direct): ${direct}`);
    if (proof > 0) lines.push(`    - via proof: ${proof}`);
    if (proofRetry > 0) lines.push(`    - via proof retry: ${proofRetry}`);
  }
  if (correctGaps.length > 0) lines.push(`  - correct gaps (intentionally unprovable): ${correctGaps.length}`);
  if (realGaps.length > 0) {
    lines.push(`- **Obligations (could not be verified):** ${realGaps.length}`);
    if (roundtripFail > 0) lines.push(`  - round-trip mismatch: ${roundtripFail}`);
    if (otherGaps > 0) lines.push(`  - proof failure: ${otherGaps}`);
  }
  lines.push('');

  // --- Proved requirements ---

  if (proved.length > 0) {
    lines.push(`## Formally Verified Requirements\n`);

    for (const r of proved) {
      lines.push(`**${r.requirement}**`);
      lines.push(`- Strategy: ${r.strategy}`);
      if (r.reasoning) {
        lines.push(`- ${r.reasoning}`);
      }
      lines.push('```dafny');
      lines.push(r.dafnyCode);
      lines.push('```');
      lines.push('');
    }
  }

  // --- Correct Gaps ---

  if (correctGaps.length > 0) {
    lines.push(`## Correct Gaps\n`);
    lines.push(`These requirements are intentionally unprovable — the domain does not guarantee them.\n`);
    for (const r of correctGaps) {
      lines.push(`**${r.requirement}**`);
      if (r.reasoning) {
        lines.push(`- Reasoning: ${r.reasoning}`);
      }
      lines.push('');
    }
  }

  // --- Obligations ---

  if (realGaps.length > 0) {
    lines.push(`## Obligations\n`);
    if (obligationsPath) {
      lines.push(`These requirements could not be automatically verified. See \`${obligationsPath}\` for the obligation lemmas.\n`);
    }
    for (const r of realGaps) {
      lines.push(`**${r.requirement}**`);
      lines.push(`- Failed after ${r.attempts} attempt(s)`);
      if (r.strategiesTried) {
        const trail = r.strategiesTried.map((s) => `${s.strategy}${s.success ? '✓' : '✗'}`).join(' → ');
        lines.push(`- Strategies: ${trail}`);
      }
      if (r.strategy === 'roundtrip-fail') {
        if (r.discrepancy) lines.push(`- Discrepancy: ${r.discrepancy}`);
        if (r.weakeningType && r.weakeningType !== 'none') lines.push(`- Weakening: ${r.weakeningType}`);
      }
      if (r.reasoning) {
        lines.push(`- Reasoning: ${r.reasoning}`);
      }
      lines.push('');
    }
  }

  // --- Token usage ---

  const usage = getTokenUsage();
  if (usage.input > 0) {
    lines.push(`---`);
    lines.push(`*API usage: ${usage.input} input tokens, ${usage.output} output tokens*`);
  }

  return lines.join('\n');
}

/**
 * Render results as JSON for machine consumption.
 */
export function renderJson(domain, proveResults, obligationsPath) {
  return JSON.stringify({
    domain,
    timestamp: new Date().toISOString(),
    verification: proveResults,
    obligationsFile: obligationsPath,
    tokenUsage: getTokenUsage(),
  }, null, 2);
}
