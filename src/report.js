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

  // --- Summary ---

  lines.push(`## Summary\n`);

  const direct = proved.filter((r) => r.strategy === 'direct').length;
  const proof = proved.filter((r) => r.strategy === 'proof').length;
  const proofRetry = proved.filter((r) => r.strategy === 'proof-retry').length;

  lines.push(`- **Requirements formally verified:** ${proved.length}/${proveResults.length}`);
  if (direct > 0) lines.push(`  - via empty body (direct): ${direct}`);
  if (proof > 0) lines.push(`  - via proof: ${proof}`);
  if (proofRetry > 0) lines.push(`  - via proof retry: ${proofRetry}`);
  lines.push(`- **Obligations (could not be verified):** ${gaps.length}`);
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

  // --- Obligations ---

  if (gaps.length > 0) {
    lines.push(`## Obligations\n`);
    if (obligationsPath) {
      lines.push(`These requirements could not be automatically verified. See \`${obligationsPath}\` for the obligation lemmas.\n`);
    }
    for (const r of gaps) {
      lines.push(`**${r.requirement}**`);
      lines.push(`- Failed after ${r.attempts} attempt(s)`);
      if (r.strategiesTried) {
        const trail = r.strategiesTried.map((s) => `${s.strategy}${s.success ? '✓' : '✗'}`).join(' → ');
        lines.push(`- Strategies: ${trail}`);
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
