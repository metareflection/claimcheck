import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { resolve, basename } from 'node:path';

import { audit } from './audit.js';
import { claimcheck } from './claimcheck.js';
import { renderReport, renderJson } from './report.js';
import { configureVertex, configureBedrock } from './api.js';

function printUsage() {
  console.error(`Usage: claimcheck [options]

Options:
  -m, --mapping <path>         Mapping file (JSON: [{requirement, lemmaName}, ...])
  --dfy <path>                 Claims .dfy file (contains the lemmas)
  --module <name>              Dafny module name (optional; needed for --verify with modules)
  -d, --domain <name>          Human-readable domain name (default: from --module or .dfy filename)
  --json                       Output JSON instead of markdown
  --verify                     Also run dafny verify on each lemma
  --single-prompt              Use single-prompt claimcheck mode (one call per pair)
  --naive                      Use naive mode (one call per pair, no structured reasoning)
  --claude-code                Use Claude Code (claude -p) instead of the Anthropic API
  --model <id>                 Model for single-prompt/naive mode (default: claude-sonnet-4-5-20250929)
  --informalize-model <id>     Model for back-translation (default: claude-haiku-4-5-20251001)
  --compare-model <id>         Model for comparison (default: claude-sonnet-4-5-20250929)
  --vertex                     Use Vertex AI instead of the Anthropic API (or USE_VERTEX env var)
  --vertex-project <id>        Google Cloud project ID (or GOOGLE_CLOUD_PROJECT_ID env var)
  --vertex-region <region>     Vertex AI region (default: us-east5, or GOOGLE_CLOUD_REGION env var)
  --bedrock                    Use AWS Bedrock instead of the Anthropic API (or USE_BEDROCK env var)
  --bedrock-region <region>    AWS region for Bedrock (default: us-east-1, or AWS_REGION env var)
  --stdin                      Read JSON from stdin (pure claimcheck, no file extraction)
  -v, --verbose                Verbose API logging
  -h, --help                   Show this help`);
}

export async function main(argv) {
  const { values } = parseArgs({
    args: argv.filter((a) => a !== ''),
    options: {
      mapping:      { type: 'string', short: 'm' },
      dfy:          { type: 'string' },
      module:       { type: 'string' },
      domain:       { type: 'string', short: 'd' },
      lang:         { type: 'string' },
      verify:             { type: 'boolean', default: false },
      'single-prompt':    { type: 'boolean', default: false },
      naive:              { type: 'boolean', default: false },
      'claude-code':      { type: 'boolean', default: false },
      model:              { type: 'string' },
      'informalize-model': { type: 'string' },
      'compare-model':    { type: 'string' },
      vertex:             { type: 'boolean', default: false },
      'vertex-project':   { type: 'string' },
      'vertex-region':    { type: 'string' },
      bedrock:            { type: 'boolean', default: false },
      'bedrock-region':   { type: 'string' },
      json:               { type: 'boolean', default: false },
      stdin:              { type: 'boolean', default: false },
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

  if (values['claude-code']) {
    delete process.env.CLAUDECODE;
  }

  const useVertex = !!(values.vertex || process.env.USE_VERTEX);
  const useBedrock = !!(values.bedrock || process.env.USE_BEDROCK);

  if (useVertex && useBedrock) {
    console.error('Error: --vertex and --bedrock are mutually exclusive');
    process.exit(1);
  }

  if (useVertex) {
    const projectId = values['vertex-project'] ?? process.env.GOOGLE_CLOUD_PROJECT_ID;
    if (!projectId) {
      console.error('Error: --vertex requires --vertex-project or GOOGLE_CLOUD_PROJECT_ID env var');
      process.exit(1);
    }
    const region = values['vertex-region'] ?? process.env.GOOGLE_CLOUD_REGION ?? 'us-east5';
    configureVertex({ projectId, region });
  } else if (useBedrock) {
    const region = values['bedrock-region'] ?? process.env.AWS_REGION ?? 'us-east-1';
    configureBedrock({ region });
  }

  const opts = {
    verbose: values.verbose,
    verify: values.verify,
    singlePrompt: values['single-prompt'],
    naive: values.naive,
    claudeCode: values['claude-code'],
    vertex: useVertex,
    bedrock: useBedrock,
    ...(values.lang ? { lang: values.lang } : {}),
    ...(values.model ? { model: values.model } : {}),
    ...(values['informalize-model'] ? { informalizeModel: values['informalize-model'] } : {}),
    ...(values['compare-model'] ? { compareModel: values['compare-model'] } : {}),
  };

  // --- Stdin mode: pure JSON-in/JSON-out ---

  if (values.stdin) {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const input = JSON.parse(Buffer.concat(chunks).toString());

    const result = await claimcheck({
      claims: input.claims,
      domain: input.domain ?? 'unknown',
      options: opts,
    });

    console.log(JSON.stringify(result, null, 2));
    return;
  }

  // --- File mode: extract from .dfy + mapping ---

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

  // --- Read inputs ---

  const mappingRaw = await readFile(resolve(values.mapping), 'utf-8');
  const mapping = JSON.parse(mappingRaw);

  const domainDfyPath = resolve(values.dfy);
  const dfySource = await readFile(domainDfyPath, 'utf-8');

  const domainModule = values.module ?? null;
  const domain = values.domain ?? domainModule ?? basename(values.dfy, '.dfy');

  console.error(`[claimcheck] ${mapping.length} mapping(s)`);
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

  // --- Report ---

  if (values.json) {
    console.log(renderJson(domain, auditResults));
  } else {
    const report = renderReport(domain, auditResults);
    console.log(report);
  }
}
