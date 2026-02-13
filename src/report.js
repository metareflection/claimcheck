import { getTokenUsage } from './api.js';

/**
 * Render a coverage report as markdown.
 *
 * @param {object} matchResult - { matches, unexpected, summary }
 * @param {string} domain
 * @param {object[]|null} proveResults - from prove step, or null if skipped
 * @param {string|null} obligationsPath - path to obligations.dfy if generated
 * @returns {string}
 */
export function renderReport(matchResult, domain, proveResults = null, obligationsPath = null) {
  const lines = [];
  lines.push(`# Coverage Report: ${domain}\n`);

  const proved = proveResults?.filter((r) => r.status === 'proved') ?? [];
  const gaps = proveResults?.filter((r) => r.status === 'gap') ?? [];

  // --- Summary ---

  lines.push(`## Summary\n`);

  if (proveResults) {
    const sentinels = proved.filter((r) => r.strategy === 'sentinel').length;
    const direct = proved.filter((r) => r.strategy === 'direct').length;
    const llm = proved.filter((r) => r.strategy === 'llm-guided' || r.strategy === 'retry').length;

    lines.push(`- **Requirements formally verified:** ${proved.length}/${proveResults.length}`);
    if (sentinels > 0) lines.push(`  - via sentinel proof: ${sentinels}`);
    if (direct > 0) lines.push(`  - via direct proof: ${direct}`);
    if (llm > 0) lines.push(`  - via LLM-guided proof: ${llm}`);
    lines.push(`- **Obligations (could not be verified):** ${gaps.length}`);
  } else {
    const withCandidates = matchResult.matches.filter((m) => m.candidates.length > 0).length;
    const withoutCandidates = matchResult.matches.length - withCandidates;
    lines.push(`- **Requirements with candidate matches:** ${withCandidates}`);
    lines.push(`- **Requirements with no candidates:** ${withoutCandidates}`);
  }

  lines.push(`- **Proved claims with no matching requirement:** ${matchResult.unexpected.length}`);

  if (matchResult.summary) {
    lines.push('');
    lines.push(matchResult.summary);
  }
  lines.push('');

  // --- Proved requirements (grouped by strategy) ---

  if (proved.length > 0) {
    lines.push(`## Formally Verified Requirements\n`);

    for (const r of proved) {
      lines.push(`**${r.requirement}**`);
      lines.push(`- Strategy: ${r.strategy}`);
      if (r.candidateClaimId) {
        lines.push(`- Matched claim: \`${r.candidateClaimId}\``);
      }
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
        const trail = r.strategiesTried.map((s) => s.strategy).join(' → ');
        lines.push(`- Strategies tried: ${trail}`);
      }
      if (r.reasoning) {
        lines.push(`- Reasoning: ${r.reasoning}`);
      }
      lines.push('');
    }
  }

  // --- Unmatched requirements (no --dfy) ---

  if (!proveResults) {
    const noCandidate = matchResult.matches.filter((m) => m.candidates.length === 0);
    if (noCandidate.length > 0) {
      lines.push(`## Requirements Without Candidates\n`);
      for (const m of noCandidate) {
        lines.push(`- **${m.requirement}**: no matching claims found`);
      }
      lines.push('');
    }
  }

  // --- Unexpected claims ---

  if (matchResult.unexpected.length > 0) {
    lines.push(`## Unexpected Proofs\n`);
    for (const u of matchResult.unexpected) {
      lines.push(`- **${u.naturalLanguage}** (\`${u.claimId}\`): ${u.explanation}`);
    }
    lines.push('');
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
export function renderJson(matchResult, domain, proveResults, obligationsPath) {
  // Build backward-compatible coverage object
  const coverage = buildLegacyCoverage(matchResult, proveResults);

  return JSON.stringify({
    domain,
    timestamp: new Date().toISOString(),
    coverage,
    matchResult,
    verification: proveResults,
    obligationsFile: obligationsPath,
    tokenUsage: getTokenUsage(),
  }, null, 2);
}

/**
 * Build a backward-compatible coverage object from match + prove results.
 * Shape: { proved, missing, unexpected, summary }
 */
export function buildLegacyCoverage(matchResult, proveResults) {
  const proved = [];
  const missing = [];

  if (proveResults) {
    for (const r of proveResults) {
      if (r.status === 'proved') {
        proved.push({
          claimId: r.candidateClaimId ?? '',
          naturalLanguage: '',
          matchedRequirement: r.requirement,
          explanation: r.reasoning,
        });
      } else {
        missing.push({
          requirement: r.requirement,
          explanation: r.reasoning,
        });
      }
    }
  } else {
    // No prove step — report candidates as proved, no-candidates as missing
    for (const m of matchResult.matches) {
      if (m.candidates.length > 0) {
        const best = m.candidates[0];
        proved.push({
          claimId: best.claimId,
          naturalLanguage: '',
          matchedRequirement: m.requirement,
          explanation: best.explanation,
        });
      } else {
        missing.push({
          requirement: m.requirement,
          explanation: 'No matching claims found',
        });
      }
    }
  }

  return {
    proved,
    missing,
    unexpected: matchResult.unexpected,
    summary: matchResult.summary,
  };
}
