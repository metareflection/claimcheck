import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { audit } from './audit.js';
import { generateObligations, writeObligations } from './obligations.js';
import { renderReport, renderJson } from './report.js';

function printUsage() {
  console.error(`Usage: claimcheck [options]

Options:
  -r, --requirements <path>    Requirements file (markdown)
  -m, --mapping <path>         Mapping file (JSON)
  --dfy <path>                 Domain .dfy file
  --module <name>              Dafny module name to import
  -d, --domain <name>          Human-readable domain name (default: from module)
  -o, --output <dir>           Output directory (default: current dir)
  --json                       Output JSON instead of markdown
  --verify                     Also run dafny verify on each lemma
  --single-prompt              Use single-prompt claimcheck mode (one call per pair)
  --model <id>                 Model for single-prompt mode (default: claude-sonnet-4-5-20250929)
  --informalize-model <id>     Model for back-translation (default: claude-haiku-4-5-20251001)
  --compare-model <id>         Model for comparison (default: claude-sonnet-4-5-20250929)
  -v, --verbose                Verbose API logging
  -h, --help                   Show this help`);
}

/**
 * Parse requirements from markdown text.
 * Extracts numbered items (1. ...), bullets (- ..., * ...), or plain non-empty lines.
 *
 * @returns {string[]}
 */
function parseRequirements(text) {
  return text
    .split('\n')
    .map((line) => line.replace(/^[\s]*(?:\d+\.|[-*])\s*/, '').trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

export async function main(argv) {
  const { values } = parseArgs({
    args: argv.filter((a) => a !== ''),
    options: {
      requirements: { type: 'string', short: 'r' },
      mapping:      { type: 'string', short: 'm' },
      dfy:          { type: 'string' },
      module:       { type: 'string' },
      domain:       { type: 'string', short: 'd' },
      output:       { type: 'string', short: 'o' },
      verify:             { type: 'boolean', default: false },
      'single-prompt':    { type: 'boolean', default: false },
      model:              { type: 'string' },
      'informalize-model': { type: 'string' },
      'compare-model':    { type: 'string' },
      json:               { type: 'boolean', default: false },
      verbose:            { type: 'boolean', short: 'v', default: false },
      help:               { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: false,
    strict: false,
  });

  if (values.help) {
    printUsage();
    return;
  }

  if (!values.requirements) {
    console.error('Error: --requirements is required');
    printUsage();
    process.exit(1);
  }

  if (!values.mapping) {
    console.error('Error: --mapping is required');
    printUsage();
    process.exit(1);
  }

  if (!values.dfy) {
    console.error('Error: --dfy is required');
    printUsage();
    process.exit(1);
  }

  if (!values.module) {
    console.error('Error: --module is required');
    printUsage();
    process.exit(1);
  }

  const opts = {
    verbose: values.verbose,
    verify: values.verify,
    singlePrompt: values['single-prompt'],
    ...(values.model ? { model: values.model } : {}),
    ...(values['informalize-model'] ? { informalizeModel: values['informalize-model'] } : {}),
    ...(values['compare-model'] ? { compareModel: values['compare-model'] } : {}),
  };

  // --- Read inputs ---

  const requirementsText = await readFile(resolve(values.requirements), 'utf-8');
  const requirements = parseRequirements(requirementsText);

  const mappingRaw = await readFile(resolve(values.mapping), 'utf-8');
  const mapping = JSON.parse(mappingRaw);

  const domainDfyPath = resolve(values.dfy);
  const dfySource = await readFile(domainDfyPath, 'utf-8');

  const domainModule = values.module;
  const domain = values.domain ?? domainModule;
  const outputDir = resolve(values.output ?? '.');

  // Validate mapping entries against requirements
  for (const entry of mapping) {
    if (!requirements.includes(entry.requirement)) {
      console.error(`[claimcheck] Warning: mapping requirement not found in requirements file: "${entry.requirement}"`);
    }
  }

  console.error(`[claimcheck] ${requirements.length} requirement(s), ${mapping.length} mapping(s)`);
  for (const entry of mapping) {
    console.error(`  - "${entry.requirement}" → ${entry.lemmaName}`);
  }

  // --- Audit ---

  console.error(`\n[claimcheck] Auditing ${mapping.length} mapping(s)...`);
  const auditResults = await audit(mapping, dfySource, domainDfyPath, domainModule, domain, opts);

  const confirmed = auditResults.filter((r) => r.status === 'confirmed');
  const disputed = auditResults.filter((r) => r.status === 'disputed');
  const errors = auditResults.filter((r) => r.status === 'error' || r.status === 'verify-failed');
  console.error(`[claimcheck] Confirmed: ${confirmed.length}, Disputed: ${disputed.length}, Errors: ${errors.length}`);

  // --- Generate obligations for disputed mappings ---

  let obligationsPath = null;
  if (disputed.length > 0) {
    const gapResults = disputed.map((r) => ({
      requirement: r.requirement,
      status: 'gap',
      strategy: 'roundtrip-fail',
      attempts: 1,
      dafnyCode: r.dafnyCode,
      discrepancy: r.discrepancy,
      weakeningType: r.weakeningType,
      reasoning: r.discrepancy,
    }));
    const content = generateObligations(gapResults, domainDfyPath, domainModule, outputDir);
    if (content) {
      obligationsPath = await writeObligations(content, outputDir);
      console.error(`[claimcheck] Wrote ${obligationsPath}`);
    }
  }

  // --- Report ---

  if (values.json) {
    console.log(renderJson(domain, auditResults));
  } else {
    const report = renderReport(domain, auditResults);
    console.log(report);
  }
}
