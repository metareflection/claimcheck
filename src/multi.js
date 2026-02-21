import { parseArgs } from 'node:util';
import { readFile, writeFile, unlink, mkdtemp } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const claimcheckBin = join(__dirname, '..', 'bin', 'claimcheck.js');

function printUsage() {
  console.error(`Usage: claimcheck-multi [options]

Splits a multi-file mapping into per-file groups and delegates to claimcheck.

Options:
  -m, --mapping <path>         Mapping file (JSON: [{requirement, lemmaName, file}, ...])
  --dfy <path>                 Default .dfy file (fallback for entries without "file")
  -d, --domain <name>          Human-readable domain name
  --json                       Output JSON instead of markdown
  --verify                     Also run dafny verify on each lemma
  --module <name>              Dafny module name (for --verify)
  --single-prompt              Use single-prompt mode
  --naive                      Use naive mode
  --claude-code                Use Claude Code backend
  --model <id>                 Model for single-prompt/naive mode
  --informalize-model <id>     Model for back-translation
  --compare-model <id>         Model for comparison
  -v, --verbose                Verbose logging
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
      verify:             { type: 'boolean', default: false },
      'single-prompt':    { type: 'boolean', default: false },
      naive:              { type: 'boolean', default: false },
      'claude-code':      { type: 'boolean', default: false },
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

  if (!values.mapping) {
    console.error('Error: --mapping is required');
    printUsage();
    process.exit(1);
  }

  const mappingPath = resolve(values.mapping);
  const mappingDir = dirname(mappingPath);
  const mapping = JSON.parse(await readFile(mappingPath, 'utf-8'));
  const defaultDfy = values.dfy ? resolve(values.dfy) : null;
  const domain = values.domain ?? 'unknown';

  // Group entries by resolved file path
  const groups = new Map(); // resolvedPath → [{ index, entry }]
  for (let i = 0; i < mapping.length; i++) {
    const entry = mapping[i];
    const filePath = entry.file ? resolve(mappingDir, entry.file) : defaultDfy;
    if (!filePath) {
      console.error(`Error: entry ${i} ("${entry.lemmaName}") has no "file" field and no --dfy fallback`);
      process.exit(1);
    }
    if (!groups.has(filePath)) groups.set(filePath, []);
    groups.get(filePath).push({ index: i, entry });
  }

  console.error(`[multi] ${mapping.length} mapping(s) across ${groups.size} file(s)`);

  // Build passthrough flags
  const passthrough = [];
  if (values.verify) passthrough.push('--verify');
  if (values['single-prompt']) passthrough.push('--single-prompt');
  if (values.naive) passthrough.push('--naive');
  if (values['claude-code']) passthrough.push('--claude-code');
  if (values.module) passthrough.push('--module', values.module);
  if (values.model) passthrough.push('--model', values.model);
  if (values['informalize-model']) passthrough.push('--informalize-model', values['informalize-model']);
  if (values['compare-model']) passthrough.push('--compare-model', values['compare-model']);
  if (values.verbose) passthrough.push('--verbose');
  // Always request JSON from subprocesses so we can merge
  passthrough.push('--json');

  const allResults = new Array(mapping.length);
  const tmpDir = await mkdtemp(join(tmpdir(), 'claimcheck-multi-'));

  let groupIdx = 0;
  for (const [filePath, entries] of groups) {
    console.error(`[multi] Processing ${entries.length} lemma(s) from ${filePath}`);

    // Write a temp mapping without "file" fields
    const groupMapping = entries.map(({ entry }) => {
      const { file, ...rest } = entry;
      return rest;
    });
    const tmpMapping = join(tmpDir, `mapping-${groupIdx++}.json`);
    await writeFile(tmpMapping, JSON.stringify(groupMapping, null, 2));

    const args = [
      claimcheckBin,
      '-m', tmpMapping,
      '--dfy', filePath,
      '-d', domain,
      ...passthrough,
    ];

    try {
      const { stdout, stderr } = await execFileAsync('node', args, {
        timeout: 300_000,
        maxBuffer: 10 * 1024 * 1024,
      });

      if (stderr) console.error(stderr);

      const groupResults = JSON.parse(stdout);

      // Map results back to original indices
      for (let gi = 0; gi < groupResults.results.length; gi++) {
        const result = groupResults.results[gi];
        // Find the original index by matching lemmaName within this group
        const groupEntry = entries.find(e => e.entry.lemmaName === result.lemmaName);
        if (groupEntry) {
          allResults[groupEntry.index] = result;
        }
      }
    } catch (err) {
      console.error(`[multi] Error processing ${filePath}: ${err.message}`);
      for (const { index, entry } of entries) {
        allResults[index] = {
          requirement: entry.requirement,
          lemmaName: entry.lemmaName,
          status: 'error',
          error: `claimcheck subprocess failed: ${err.message}`,
        };
      }
    } finally {
      try { await unlink(tmpMapping); } catch {}
    }
  }

  // Clean up temp dir
  try { const { rmdir } = await import('node:fs/promises'); await rmdir(tmpDir); } catch {}

  // Output merged results
  const merged = {
    domain,
    results: allResults.filter(Boolean),
  };

  if (values.json) {
    console.log(JSON.stringify(merged, null, 2));
  } else {
    // Simple markdown summary from merged results
    const results = merged.results;
    const confirmed = results.filter(r => r.status === 'confirmed');
    const disputed = results.filter(r => r.status === 'disputed');
    const errors = results.filter(r => r.status === 'error' || r.status === 'verify-failed');

    const lines = [`# Audit Report: ${domain}\n`];
    lines.push(`## Summary\n`);
    lines.push(`- **Mappings audited:** ${results.length}`);
    lines.push(`- **Confirmed:** ${confirmed.length}`);
    if (disputed.length) lines.push(`- **Disputed:** ${disputed.length}`);
    if (errors.length) lines.push(`- **Errors:** ${errors.length}`);
    lines.push('');

    if (confirmed.length) {
      lines.push(`## Confirmed Mappings\n`);
      for (const r of confirmed) {
        lines.push(`**${r.requirement}**`);
        lines.push(`- Lemma: \`${r.lemmaName}\``);
        if (r.informalization) lines.push(`- Back-translation: ${r.informalization.naturalLanguage}`);
        lines.push('');
      }
    }

    if (disputed.length) {
      lines.push(`## Disputed Mappings\n`);
      for (const r of disputed) {
        lines.push(`**${r.requirement}**`);
        lines.push(`- Lemma: \`${r.lemmaName}\``);
        if (r.discrepancy) lines.push(`- Discrepancy: ${r.discrepancy}`);
        if (r.weakeningType && r.weakeningType !== 'none') lines.push(`- Weakening: ${r.weakeningType}`);
        lines.push('');
      }
    }

    if (errors.length) {
      lines.push(`## Errors\n`);
      for (const r of errors) {
        lines.push(`**${r.requirement}**`);
        lines.push(`- Lemma: \`${r.lemmaName}\``);
        lines.push(`- Error: ${r.error}`);
        lines.push('');
      }
    }

    console.log(lines.join('\n'));
  }
}
