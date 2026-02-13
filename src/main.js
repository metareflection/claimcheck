import { parseArgs } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';

import { flattenClaims } from './flatten.js';
import { translateClaims } from './translate.js';
import { matchClaims } from './match.js';
import { proveAll } from './prove.js';
import { generateObligations, writeObligations } from './obligations.js';
import { renderReport, renderJson } from './report.js';
import { extractClaims } from './extract.js';

function printUsage() {
  console.error(`Usage: claimcheck [options]

Options:
  -c, --claims <path>         Path to claims.json (from dafny2js --claims)
  -r, --requirements <path>   Path to requirements file (markdown)
  --dfy <path>                Path to domain .dfy file (enables verification)
  --module <name>             Dafny module name to filter to
  -d, --domain <name>         Human-readable domain name (default: from module)
  -o, --output <dir>          Output directory (default: current dir)
  --retries <n>               Max verification retries per requirement (default: 3)
  --extract                   Run dafny2js --claims first (requires --dafny2js)
  --dafny2js <path>           Path to dafny2js project directory
  --json                      Output JSON instead of markdown
  -v, --verbose               Verbose API logging
  -h, --help                  Show this help`);
}

export async function main(argv) {
  const { values } = parseArgs({
    args: argv.filter((a) => a !== ''),
    options: {
      claims:       { type: 'string', short: 'c' },
      requirements: { type: 'string', short: 'r' },
      dfy:          { type: 'string' },
      module:       { type: 'string' },
      domain:       { type: 'string', short: 'd' },
      output:       { type: 'string', short: 'o' },
      retries:      { type: 'string', default: '3' },
      extract:      { type: 'boolean', default: false },
      'dafny2js':   { type: 'string' },
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

  const opts = {
    verbose: values.verbose,
    retries: parseInt(values.retries ?? '3', 10),
  };

  // --- Step 0: Resolve inputs ---

  let claims;

  if (values.extract) {
    if (!values.dfy) {
      console.error('Error: --dfy is required with --extract');
      process.exit(1);
    }
    if (!values['dafny2js']) {
      console.error('Error: --dafny2js is required with --extract');
      process.exit(1);
    }
    console.error('[claimcheck] Extracting claims via dafny2js...');
    claims = await extractClaims(resolve(values.dfy), resolve(values['dafny2js']), opts);
  } else if (values.claims) {
    claims = JSON.parse(await readFile(resolve(values.claims), 'utf-8'));
  } else {
    console.error('Error: --claims or --extract is required');
    printUsage();
    process.exit(1);
  }

  if (!values.requirements) {
    console.error('Error: --requirements is required');
    process.exit(1);
  }

  const requirementsText = await readFile(resolve(values.requirements), 'utf-8');
  const domain = values.domain ?? values.module ?? 'Unknown';
  const outputDir = resolve(values.output ?? '.');

  // --- Step 1: Flatten ---

  const items = flattenClaims(claims, values.module);
  console.error(`[claimcheck] Flattened ${items.length} claim items (module: ${values.module ?? 'all'})`);

  if (items.length === 0) {
    console.error('[claimcheck] No claims found. Check --module filter.');
    process.exit(1);
  }

  // --- Step 2: Translate ---

  console.error(`[claimcheck] Translating ${items.length} claims...`);
  const translated = await translateClaims(items, domain, opts);

  // --- Step 3: Match (candidate hints for formal verification) ---

  console.error(`[claimcheck] Matching claims to requirements...`);
  const matchResult = await matchClaims(translated, requirementsText, domain, opts);

  const withCandidates = matchResult.matches.filter((m) => m.candidates.length > 0).length;
  console.error(`[claimcheck] ${matchResult.matches.length} requirements (${withCandidates} with candidates), ${matchResult.unexpected.length} unexpected claims`);

  // --- Step 4: Prove ALL requirements (if --dfy provided) ---

  let proveResults = null;

  if (values.dfy) {
    const domainDfyPath = resolve(values.dfy);
    const domainSource = await readFile(domainDfyPath, 'utf-8');
    const domainModule = values.module ?? domain;

    console.error(`\n[claimcheck] Proving ${matchResult.matches.length} requirement(s)...`);
    proveResults = await proveAll(
      matchResult.matches,
      translated,
      domainSource,
      domainDfyPath,
      domainModule,
      domain,
      opts,
    );

    const proved = proveResults.filter((r) => r.status === 'proved');
    const gaps = proveResults.filter((r) => r.status === 'gap');
    const sentinels = proved.filter((r) => r.strategy === 'sentinel').length;
    console.error(`[claimcheck] Proved: ${proved.length} (${sentinels} via sentinel), Gaps: ${gaps.length}`);
  } else {
    console.error(`\n[claimcheck] Use --dfy to enable formal verification of all requirements.`);
  }

  // --- Step 5: Generate obligations ---

  let obligationsPath = null;
  const gaps = proveResults?.filter((r) => r.status === 'gap') ?? [];

  if (gaps.length > 0 && values.dfy) {
    const content = generateObligations(gaps, resolve(values.dfy), values.module ?? domain, outputDir);
    if (content) {
      obligationsPath = await writeObligations(content, outputDir);
      console.error(`[claimcheck] Wrote ${obligationsPath}`);
    }
  }

  // --- Step 6: Report ---

  if (values.json) {
    console.log(renderJson(matchResult, domain, proveResults, obligationsPath));
  } else {
    const report = renderReport(matchResult, domain, proveResults, obligationsPath);
    console.log(report);
  }
}
