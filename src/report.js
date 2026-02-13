import { getTokenUsage } from './api.js';

/**
 * Render an audit report as markdown.
 *
 * @param {string} domain
 * @param {object[]} auditResults - from audit step
 * @returns {string}
 */
export function renderReport(domain, auditResults) {
  const lines = [];
  lines.push(`# Audit Report: ${domain}\n`);

  const confirmed = auditResults.filter((r) => r.status === 'confirmed');
  const disputed = auditResults.filter((r) => r.status === 'disputed');
  const errors = auditResults.filter((r) => r.status === 'error');
  const verifyFailed = auditResults.filter((r) => r.status === 'verify-failed');

  // --- Summary ---

  lines.push(`## Summary\n`);
  lines.push(`- **Mappings audited:** ${auditResults.length}`);
  lines.push(`- **Confirmed:** ${confirmed.length}`);
  if (disputed.length > 0) lines.push(`- **Disputed:** ${disputed.length}`);
  if (verifyFailed.length > 0) lines.push(`- **Verification failed:** ${verifyFailed.length}`);
  if (errors.length > 0) lines.push(`- **Errors:** ${errors.length}`);
  lines.push('');

  // --- Confirmed mappings ---

  if (confirmed.length > 0) {
    lines.push(`## Confirmed Mappings\n`);

    for (const r of confirmed) {
      lines.push(`**${r.requirement}**`);
      lines.push(`- Lemma: \`${r.lemmaName}\``);
      if (r.informalization) {
        lines.push(`- Back-translation: ${r.informalization.naturalLanguage}`);
      }
      lines.push('```dafny');
      lines.push(r.dafnyCode);
      lines.push('```');
      lines.push('');
    }
  }

  // --- Disputed mappings ---

  if (disputed.length > 0) {
    lines.push(`## Disputed Mappings\n`);

    for (const r of disputed) {
      lines.push(`**${r.requirement}**`);
      lines.push(`- Lemma: \`${r.lemmaName}\``);
      if (r.discrepancy) lines.push(`- Discrepancy: ${r.discrepancy}`);
      if (r.weakeningType && r.weakeningType !== 'none') lines.push(`- Weakening: ${r.weakeningType}`);
      if (r.informalization) {
        lines.push(`- Back-translation: ${r.informalization.naturalLanguage}`);
      }
      lines.push('```dafny');
      lines.push(r.dafnyCode);
      lines.push('```');
      lines.push('');
    }
  }

  // --- Verification failures ---

  if (verifyFailed.length > 0) {
    lines.push(`## Verification Failures\n`);
    lines.push(`These lemmas failed Dafny verification — they may not actually be proved.\n`);

    for (const r of verifyFailed) {
      lines.push(`**${r.requirement}**`);
      lines.push(`- Lemma: \`${r.lemmaName}\``);
      if (r.error) {
        const shortError = r.error.split('\n').slice(0, 5).join('\n');
        lines.push('```');
        lines.push(shortError);
        lines.push('```');
      }
      lines.push('');
    }
  }

  // --- Errors ---

  if (errors.length > 0) {
    lines.push(`## Errors\n`);

    for (const r of errors) {
      lines.push(`**${r.requirement}**`);
      lines.push(`- Lemma: \`${r.lemmaName}\``);
      lines.push(`- Error: ${r.error}`);
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
 * Render audit results as JSON for machine consumption.
 */
export function renderJson(domain, auditResults) {
  return JSON.stringify({
    domain,
    timestamp: new Date().toISOString(),
    results: auditResults,
    tokenUsage: getTokenUsage(),
  }, null, 2);
}
