/**
 * Custom promptfoo provider that wraps the full claimcheck pipeline.
 * Runs flatten → translate → compare and returns structured results.
 *
 * Supports three modes via env vars:
 *   - Live (default): calls Anthropic API
 *   - Cached: reads from eval/cache/ (CLAIMCHECK_EVAL_CACHED=1)
 *   - Write-cache: live run that saves results (CLAIMCHECK_EVAL_WRITE_CACHE=1)
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { flattenClaims } from '../../src/flatten.js';

const ROOT = resolve(import.meta.dirname, '../..');
const CLAIMS_DIR = join(ROOT, 'test/integration/claims');
const REQS_DIR = join(ROOT, 'test/integration/reqs');
const CACHE_DIR = join(ROOT, 'eval/cache');

export default class ClaimcheckPipelineProvider {
  constructor(options = {}) {
    this.providerId = options.id ?? 'claimcheck-pipeline';
    this.config = options.config ?? {};
  }

  id() {
    return this.providerId;
  }

  async callApi(prompt, context) {
    const vars = context?.vars ?? {};
    const projectName = vars.projectName;
    const moduleName = vars.moduleName;

    if (!projectName || !moduleName) {
      return { error: 'Missing projectName or moduleName in test vars' };
    }

    const cached = process.env.CLAIMCHECK_EVAL_CACHED === '1';
    const writeCache = process.env.CLAIMCHECK_EVAL_WRITE_CACHE === '1';

    try {
      if (cached) {
        return await this.loadCached(projectName);
      }

      const result = await this.runLive(projectName, moduleName);

      if (writeCache) {
        await this.saveCache(projectName, result);
      }

      return { output: result };
    } catch (err) {
      return { error: `Pipeline failed for ${projectName}: ${err.message}` };
    }
  }

  async runLive(projectName, moduleName) {
    const claimsPath = join(CLAIMS_DIR, `${projectName}.json`);
    const reqsPath = join(REQS_DIR, `${projectName}.md`);

    const claims = JSON.parse(await readFile(claimsPath, 'utf-8'));
    const requirementsText = await readFile(reqsPath, 'utf-8');

    const items = flattenClaims(claims, moduleName);
    const flattenedCount = items.length;

    if (items.length === 0) {
      return {
        flattenedCount: 0,
        translated: [],
        coverage: { proved: [], missing: [], unexpected: [], summary: 'No claims found' },
      };
    }

    const { translateClaims } = await import('../../src/translate.js');
    const translateModel = this.config.translateModel ?? undefined;
    const translated = await translateClaims(items, projectName, {
      model: translateModel,
    });

    const { compareClaims } = await import('../../src/compare.js');
    const compareModel = this.config.compareModel ?? undefined;
    const coverage = await compareClaims(translated, requirementsText, projectName, {
      model: compareModel,
    });

    return { flattenedCount, translated, coverage };
  }

  async loadCached(projectName) {
    const translatedPath = join(CACHE_DIR, `${projectName}-translated.json`);
    const coveragePath = join(CACHE_DIR, `${projectName}-coverage.json`);

    const translated = JSON.parse(await readFile(translatedPath, 'utf-8'));
    const coverage = JSON.parse(await readFile(coveragePath, 'utf-8'));
    const flattenedCount = translated.length;

    return { output: { flattenedCount, translated, coverage } };
  }

  async saveCache(projectName, result) {
    await mkdir(CACHE_DIR, { recursive: true });

    const translatedPath = join(CACHE_DIR, `${projectName}-translated.json`);
    const coveragePath = join(CACHE_DIR, `${projectName}-coverage.json`);

    await writeFile(translatedPath, JSON.stringify(result.translated, null, 2));
    await writeFile(coveragePath, JSON.stringify(result.coverage, null, 2));
  }
}
