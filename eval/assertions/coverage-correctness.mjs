/**
 * Coverage correctness assertion for promptfoo.
 * Checks pipeline coverage output against ground truth annotations.
 *
 * Checks:
 * 1. Each expected proved pair appears in coverage.proved (by claimId)
 * 2. Each expected missing requirement appears in coverage.missing (by text match)
 * 3. Each expected unexpected claim appears in coverage.unexpected (by claimId)
 * 4. No false positives in proved (claims that shouldn't match any requirement)
 * 5. Missing count matches expectations
 * 6. Proved count matches expectations
 */

import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import yaml from 'js-yaml';

const GT_DIR = resolve(import.meta.dirname, '../ground-truth');

export default async function coverageCorrectness(output, context) {
  const vars = context?.vars ?? {};
  const projectName = vars.projectName;

  if (!projectName) {
    return { pass: false, score: 0, reason: 'Missing projectName in vars' };
  }

  // Load ground truth
  const gtPath = join(GT_DIR, `${projectName}.yaml`);
  let gt;
  try {
    const gtText = await readFile(gtPath, 'utf-8');
    gt = yaml.load(gtText);
  } catch (err) {
    return { pass: false, score: 0, reason: `Cannot load ground truth: ${err.message}` };
  }

  const data = typeof output === 'string' ? JSON.parse(output) : output;
  const coverage = data.coverage;

  if (!coverage) {
    return { pass: false, score: 0, reason: 'No coverage data in output' };
  }

  const provedList = coverage.proved ?? [];
  const missingList = coverage.missing ?? [];
  const unexpectedList = coverage.unexpected ?? [];

  const checks = [];
  const details = [];

  // Check 1: Expected proved pairs found
  const expectedProved = gt.proved ?? [];
  for (const ep of expectedProved) {
    const found = provedList.some(p => p.claimId === ep.claimId);
    checks.push(found);
    if (!found) {
      details.push(`MISS proved: expected claimId=${ep.claimId} for req #${ep.requirementIndex}`);
    }
  }

  // Check 2: Expected missing requirements found
  const expectedMissing = gt.missing ?? [];
  for (const em of expectedMissing) {
    const found = missingList.some(m => {
      const reqText = m.requirement ?? '';
      if (em.requirementText) {
        return reqText.toLowerCase().includes(em.requirementText.toLowerCase());
      }
      return true;
    });
    checks.push(found);
    if (!found) {
      details.push(`MISS missing: expected req #${em.requirementIndex} ("${em.requirementText}") in coverage.missing`);
    }
  }

  // Check 3: Expected unexpected claims found (only if ground truth specifies any)
  const expectedUnexpected = gt.unexpected ?? [];
  if (expectedUnexpected.length > 0) {
    for (const eu of expectedUnexpected) {
      const found = unexpectedList.some(u => u.claimId === eu.claimId);
      checks.push(found);
      if (!found) {
        details.push(`MISS unexpected: expected claimId=${eu.claimId} in coverage.unexpected`);
      }
    }
  }

  // Check 4: No false positives in proved — every proved claim should be in expected
  if (expectedProved.length > 0) {
    const expectedClaimIds = new Set(expectedProved.map(ep => ep.claimId));
    const falsePositives = provedList.filter(p => !expectedClaimIds.has(p.claimId));
    const noFalsePositives = falsePositives.length === 0;
    checks.push(noFalsePositives);
    if (!noFalsePositives) {
      details.push(`FALSE POSITIVES in proved: ${falsePositives.map(p => p.claimId).join(', ')}`);
    }
  }

  // Check 5: Missing count matches expectations
  const expectedMissingCount = expectedMissing.length;
  const actualMissingCount = missingList.length;
  const missingCountMatch = actualMissingCount >= expectedMissingCount;
  checks.push(missingCountMatch);
  if (!missingCountMatch) {
    details.push(`MISSING COUNT: got ${actualMissingCount}, expected at least ${expectedMissingCount}`);
  }

  // Check 6: Proved count matches expectations
  const expectedProvedCount = expectedProved.length;
  const actualProvedCount = provedList.length;
  const provedCountMatch = actualProvedCount >= expectedProvedCount;
  checks.push(provedCountMatch);
  if (!provedCountMatch) {
    details.push(`PROVED COUNT: got ${actualProvedCount}, expected at least ${expectedProvedCount}`);
  }

  const passed = checks.filter(Boolean).length;
  const total = checks.length;
  const score = total > 0 ? passed / total : 0;

  return {
    pass: score >= 0.8,
    score,
    reason: score >= 0.8
      ? `Coverage correctness: ${passed}/${total} checks passed`
      : `Coverage correctness: ${passed}/${total} checks passed. Issues:\n${details.join('\n')}`,
  };
}
