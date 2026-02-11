import { getTokenUsage } from './api.js';

/**
 * Render a coverage report as markdown.
 *
 * @param {object} coverage - { proved, missing, unexpected, summary }
 * @param {string} domain
 * @param {object[]|null} proveResults - from prove step, or null if skipped
 * @param {string|null} obligationsPath - path to obligations.dfy if generated
 * @returns {string}
 */
export function renderReport(coverage, domain, proveResults = null, obligationsPath = null) {
  const lines = [];
  lines.push(`# Coverage Report: ${domain}\n`);

  const proved = proveResults?.filter(r => r.status === 'proved') ?? [];
  const gaps = proveResults?.filter(r => r.status === 'gap') ?? [];

  lines.push(`## Summary\n`);
  lines.push(`- **Proved claims matched to requirements:** ${coverage.proved.length}`);
  if (proveResults) {
    lines.push(`- **Requirements verified by generated lemma:** ${proved.length}`);
    lines.push(`- **Obligations (could not be verified):** ${gaps.length}`);
  } else {
    lines.push(`- **Requirements with no matching proof:** ${coverage.missing.length}`);
  }
  lines.push(`- **Proved claims with no matching requirement:** ${coverage.unexpected.length}`);
  if (coverage.summary) {
    lines.push('');
    lines.push(coverage.summary);
  }
  lines.push('');

  if (coverage.proved.length > 0) {
    lines.push(`## Proved and Matched\n`);
    for (const p of coverage.proved) {
      lines.push(`**${p.naturalLanguage}**`);
      lines.push(`- Requirement: ${p.matchedRequirement}`);
      lines.push(`- ${p.explanation}`);
      lines.push('');
    }
  }

  if (proved.length > 0) {
    lines.push(`## Verified by Generated Lemma\n`);
    for (const r of proved) {
      lines.push(`**${r.requirement}**`);
      lines.push(`- Lemma: \`${r.lemmaName}\` (verified in ${r.attempts} attempt${r.attempts > 1 ? 's' : ''})`);
      lines.push(`- ${r.reasoning}`);
      lines.push('```dafny');
      lines.push(r.dafnyCode);
      lines.push('```');
      lines.push('');
    }
  }

  if (gaps.length > 0) {
    lines.push(`## Obligations\n`);
    if (obligationsPath) {
      lines.push(`These requirements could not be automatically verified. See \`${obligationsPath}\` for the obligation lemmas.\n`);
    }
    for (const r of gaps) {
      lines.push(`**${r.requirement}**`);
      lines.push(`- Failed after ${r.attempts} attempt(s)`);
      lines.push(`- Reasoning: ${r.reasoning}`);
      lines.push('');
    }
  }

  if (!proveResults && coverage.missing.length > 0) {
    lines.push(`## Missing Proofs\n`);
    for (const m of coverage.missing) {
      lines.push(`- **${m.requirement}**: ${m.explanation}`);
    }
    lines.push('');
  }

  if (coverage.unexpected.length > 0) {
    lines.push(`## Unexpected Proofs\n`);
    for (const u of coverage.unexpected) {
      lines.push(`- **${u.naturalLanguage}** (\`${u.claimId}\`): ${u.explanation}`);
    }
    lines.push('');
  }

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
export function renderJson(coverage, domain, proveResults, obligationsPath) {
  return JSON.stringify({
    domain,
    timestamp: new Date().toISOString(),
    coverage,
    verification: proveResults,
    obligationsFile: obligationsPath,
    tokenUsage: getTokenUsage(),
  }, null, 2);
}
