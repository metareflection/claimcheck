import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { proveAll } from './prove.js';
import { generateObligations, writeObligations } from './obligations.js';
import { renderReport, renderJson } from './report.js';
import { eraseLemmaBodies } from './erase.js';

function printUsage() {
  console.error(`Usage: claimcheck [options]

Options:
  -r, --requirements <path>   Path to requirements file (markdown)
  --dfy <path>                Path to domain .dfy file
  --module <name>             Dafny module name to import
  -d, --domain <name>         Human-readable domain name (default: from module)
  -o, --output <dir>          Output directory (default: current dir)
  --json                      Output JSON instead of markdown
  --model <id>                Model for all LLM steps (default: claude-sonnet-4-5-20250929)
  -v, --verbose               Verbose API logging
  -h, --help                  Show this help`);
}

/**
 * Parse requirements from markdown text.
 * Extracts numbered items (1. ...), bullets (- ..., * ...), or plain non-empty lines.
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
      dfy:          { type: 'string' },
      module:       { type: 'string' },
      domain:       { type: 'string', short: 'd' },
      output:       { type: 'string', short: 'o' },
      model:        { type: 'string' },
      json:         { type: 'boolean', default: false },
      verbose:      { type: 'boolean', short: 'v', default: false },
      help:         { type: 'boolean', short: 'h', default: false },
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
    ...(values.model ? { model: values.model } : {}),
  };

  // --- Read inputs ---

  const requirementsText = await readFile(resolve(values.requirements), 'utf-8');
  const requirements = parseRequirements(requirementsText);
  const domainDfyPath = resolve(values.dfy);
  const domainSourceRaw = await readFile(domainDfyPath, 'utf-8');
  const domainSource = eraseLemmaBodies(domainSourceRaw);
  const domainModule = values.module;
  const domain = values.domain ?? domainModule;
  const outputDir = resolve(values.output ?? '.');

  console.error(`[claimcheck] ${requirements.length} requirement(s)`);
  for (const r of requirements) {
    console.error(`  - ${r}`);
  }

  // --- Prove ---

  console.error(`\n[claimcheck] Proving ${requirements.length} requirement(s)...`);
  const proveResults = await proveAll(
    requirements, domainSource, domainDfyPath, domainModule, domain, opts,
  );

  const proved = proveResults.filter((r) => r.status === 'proved');
  const gaps = proveResults.filter((r) => r.status === 'gap');
  console.error(`[claimcheck] Proved: ${proved.length}, Obligations: ${gaps.length}`);

  // --- Generate obligations ---

  let obligationsPath = null;
  if (gaps.length > 0) {
    const content = generateObligations(gaps, domainDfyPath, domainModule, outputDir);
    if (content) {
      obligationsPath = await writeObligations(content, outputDir);
      console.error(`[claimcheck] Wrote ${obligationsPath}`);
    }
  }

  // --- Report ---

  if (values.json) {
    console.log(renderJson(domain, proveResults, obligationsPath));
  } else {
    const report = renderReport(domain, proveResults, obligationsPath);
    console.log(report);
  }
}
