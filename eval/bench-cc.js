#!/usr/bin/env node
/**
 * Claude Code benchmark runner.
 *
 * Runs claimcheck via `claude -p` for each domain/mapping pair.
 * The model sees the full prompt (Dafny code + NL requirement) in one shot —
 * no structural separation. Compare results with the API-based pipeline
 * to measure whether look-ahead matters.
 *
 * Usage:
 *   node eval/bench-cc.js --runs 1 --label cc-sonnet
 *   node eval/bench-cc.js --runs 3 --label cc-opus --model claude-opus-4-6
 *   node eval/bench-cc.js --runs 3 --label cc-twopass --two-pass
 *   node eval/bench-cc.js --runs 3 --label cc-twopass --two-pass --informalize-model haiku --compare-model sonnet
 */

import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { PROJECTS } from '../test/integration/projects.js';
import { extractLemma } from '../src/extract.js';
import { CLAIMCHECK_PROMPT, NAIVE_PROMPT, INFORMALIZE_PROMPT, ROUNDTRIP_COMPARE_PROMPT } from '../src/prompts.js';

const ROOT = resolve(import.meta.dirname, '..');
const MAPPINGS_DIR = resolve(ROOT, 'test/integration/mappings');
const CLAIMS_DIR = resolve(ROOT, 'test/integration/claims');
const RESULTS_DIR = resolve(ROOT, 'eval/results');

const ALL_DOMAINS = ['counter', 'kanban', 'colorwheel', 'canon', 'delegation-auth'];

// --- Parse args ---

const args = process.argv.slice(2);

function getArg(name, defaultVal) {
  const i = args.indexOf(name);
  if (i === -1) return defaultVal;
  return args[i + 1];
}

const runs = parseInt(getArg('--runs', '1'));
const label = getArg('--label', `cc-${Date.now()}`);
const model = getArg('--model', null);
const verbose = args.includes('--verbose');

const useNaive = args.includes('--naive');
const useTwoPass = args.includes('--two-pass');
const informalizeModel = getArg('--informalize-model', null);
const compareModel = getArg('--compare-model', null);
const domainFilter = getArg('--domain', null);
const DOMAINS = domainFilter ? [domainFilter] : ALL_DOMAINS;
const lemmaFilter = getArg('--lemma', null);

// --- Call claude -p ---

function callClaude(prompt, modelOverride) {
  const ccArgs = ['-p', prompt, '--output-format', 'text', '--max-turns', '1', '--tools', ''];
  const effectiveModel = modelOverride || model;
  if (effectiveModel) ccArgs.push('--model', effectiveModel);

  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.CLAUDECODE;
    const proc = spawn('claude', ccArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => { stdout += d; });
    proc.stderr.on('data', d => { stderr += d; });

    if (verbose) {
      proc.stderr.on('data', d => process.stderr.write(d));
    }

    proc.on('close', code => {
      if (code !== 0) {
        reject(new Error(`claude -p failed: ${stderr || `exit code ${code}`}`));
      } else {
        resolve(stdout);
      }
    });
    proc.on('error', err => {
      reject(new Error(`Failed to spawn claude: ${err.message}`));
    });
  });
}

// --- Parse verdict from markdown output ---

function parseVerdict(output) {
  const VERDICT_RE = /(?:JUSTIFIED|PARTIALLY[_ ]JUSTIFIED|NOT[_ ]JUSTIFIED|VACUOUS)/gi;

  // 1. **Verdict:** JUSTIFIED or Verdict: JUSTIFIED
  const explicit = output.match(/\*?\*?Verdict:?\*?\*?\s*(JUSTIFIED|PARTIALLY[_ ]JUSTIFIED|NOT[_ ]JUSTIFIED|VACUOUS)/i);
  if (explicit) {
    return explicit[1].toUpperCase().replace(/\s+/g, '_');
  }

  // 2. Last occurrence of a verdict keyword anywhere in the output
  const all = [...output.matchAll(VERDICT_RE)];
  if (all.length > 0) {
    return all[all.length - 1][0].toUpperCase().replace(/\s+/g, '_');
  }

  return null;
}

// --- Two-pass helpers ---

/**
 * Build a batched informalize prompt for all lemmas in a domain.
 */
function buildInformalizePrompt(domain, lemmas) {
  const base = INFORMALIZE_PROMPT(domain, lemmas);
  return base.replace(
    /Call the record_informalizations tool[^\n]*/,
    `For each lemma, respond using this exact format (repeat for each lemma):

## Lemma: <lemmaName>
**Natural language:** <what the lemma guarantees, literally>
**Preconditions:** <requires clauses in English>
**Postcondition:** <ensures clauses in English>
**Scope:** <what it applies to>
**Strength:** trivial | weak | moderate | strong`
  );
}

/**
 * Parse batched informalize output into a map of lemmaName → informalization.
 */
function parseInformalizations(output) {
  const results = {};
  // Split on "## Lemma: " headers
  const sections = output.split(/^## Lemma:\s*/m).slice(1);
  for (const section of sections) {
    const nameMatch = section.match(/^(.+?)$/m);
    if (!nameMatch) continue;
    const lemmaName = nameMatch[1].trim();
    const get = (label) => {
      const re = new RegExp(`\\*\\*${label}:\\*\\*\\s*(.+?)(?=\\n\\*\\*|$)`, 'is');
      const m = section.match(re);
      return m ? m[1].trim() : '(not found)';
    };
    results[lemmaName] = {
      naturalLanguage: get('Natural language'),
      preconditions: get('Preconditions'),
      postcondition: get('Postcondition'),
      scope: get('Scope'),
      strength: get('Strength').toLowerCase(),
    };
  }
  return results;
}

/**
 * Build a batched compare prompt for all requirement-lemma pairs in a domain.
 */
function buildComparePrompt(domain, pairs) {
  const base = ROUNDTRIP_COMPARE_PROMPT(domain, pairs);
  return base.replace(
    /Call the record_roundtrip_comparisons tool[^\n]*/,
    `For each pair, state your verdict using this exact format (repeat for each pair):

## Lemma: <lemmaName>
**Verdict:** JUSTIFIED | NOT_JUSTIFIED`
  );
}

/**
 * Parse batched compare output into a map of lemmaName → verdict string.
 */
function parseVerdicts(output) {
  const results = {};
  const sections = output.split(/^## Lemma:\s*/m).slice(1);
  for (const section of sections) {
    const nameMatch = section.match(/^(.+?)$/m);
    if (!nameMatch) continue;
    const lemmaName = nameMatch[1].trim();
    results[lemmaName] = parseVerdict(section);
  }
  return results;
}

// --- Main ---

async function main() {
  const projects = PROJECTS.filter(p => DOMAINS.includes(p.name));

  const mode = useTwoPass ? 'two-pass' : useNaive ? 'naive' : 'single-prompt';
  console.error(`Claude Code Benchmark: ${label}`);
  console.error(`  runs: ${runs}`);
  console.error(`  mode: ${mode}`);
  console.error(`  model: ${model || '(default)'}`);
  if (useTwoPass) {
    console.error(`  informalize-model: ${informalizeModel || model || '(default)'}`);
    console.error(`  compare-model: ${compareModel || model || '(default)'}`);
  }
  console.error(`  domains: ${projects.map(p => p.name).join(', ')}`);
  console.error('');

  const allResults = [];
  const totalStart = Date.now();

  for (let run = 1; run <= runs; run++) {
    console.error(`── Run ${run}/${runs} ──`);

    for (const project of projects) {
      console.error(`  ${project.name}...`);
      const domainStart = Date.now();

      // Load claims source (where lemmas live) and mapping
      const claimsPath = join(CLAIMS_DIR, `${project.name}.dfy`);
      const dfySource = await readFile(claimsPath, 'utf-8');
      const mappingPath = join(MAPPINGS_DIR, `${project.name}.json`);
      let mapping = JSON.parse(await readFile(mappingPath, 'utf-8'));
      if (lemmaFilter) mapping = mapping.filter(e => e.lemmaName === lemmaFilter);

      // Resolve all lemma code up front
      const resolved = [];
      for (const entry of mapping) {
        const code = extractLemma(dfySource, entry.lemmaName);
        if (!code) {
          console.error(`    ${entry.lemmaName}: NOT FOUND`);
          allResults.push({
            domain: project.name,
            requirement: entry.requirement,
            lemmaName: entry.lemmaName,
            expected: entry.expected ?? 'confirmed',
            status: 'error',
            verdict: null,
            run,
          });
          continue;
        }
        resolved.push({ entry, code });
      }

      if (useTwoPass && resolved.length > 0) {
        // --- Two-pass: batch all lemmas in 2 calls per domain ---
        try {
          // Pass 1: Informalize all lemmas at once
          const lemmas = resolved.map(r => ({ lemmaName: r.entry.lemmaName, dafnyCode: r.code }));
          const infPrompt = buildInformalizePrompt(project.name, lemmas);
          const infOutput = await callClaude(infPrompt, informalizeModel);
          const informalizations = parseInformalizations(infOutput);

          if (verbose) {
            console.error(`    --- informalization output ---`);
            console.error(infOutput.slice(0, 1000));
            console.error('    ---');
          }

          // Pass 2: Compare all pairs at once
          const pairs = resolved.map((r, i) => ({
            requirementIndex: i,
            requirement: r.entry.requirement,
            lemmaName: r.entry.lemmaName,
            dafnyCode: r.code,
            informalization: informalizations[r.entry.lemmaName] || {
              naturalLanguage: '(parse failed)',
              preconditions: '(parse failed)',
              postcondition: '(parse failed)',
              scope: '(parse failed)',
              strength: '(parse failed)',
            },
          }));
          const cmpPrompt = buildComparePrompt(project.name, pairs);
          const cmpOutput = await callClaude(cmpPrompt, compareModel);
          const verdicts = parseVerdicts(cmpOutput);

          if (verbose) {
            console.error(`    --- comparison output ---`);
            console.error(cmpOutput.slice(0, 1000));
            console.error('    ---');
          }

          // Record results
          for (const { entry } of resolved) {
            const verdict = verdicts[entry.lemmaName] || null;
            const status = verdict === 'JUSTIFIED' ? 'confirmed' : 'disputed';
            console.error(`    ${entry.lemmaName}: ${verdict || 'PARSE_FAILED'} → ${status}`);
            allResults.push({
              domain: project.name,
              requirement: entry.requirement,
              lemmaName: entry.lemmaName,
              expected: entry.expected ?? 'confirmed',
              status,
              verdict,
              run,
            });
          }
        } catch (err) {
          console.error(`    TWO-PASS ERROR: ${err.message}`);
          for (const { entry } of resolved) {
            allResults.push({
              domain: project.name,
              requirement: entry.requirement,
              lemmaName: entry.lemmaName,
              expected: entry.expected ?? 'confirmed',
              status: 'error',
              verdict: null,
              run,
            });
          }
        }
      } else {
        // --- Single-prompt mode: one call per lemma ---
        for (const { entry, code } of resolved) {
          try {
            const lemmaStart = Date.now();
            const prompt = useNaive
              ? NAIVE_PROMPT(project.name, entry.lemmaName, code, entry.requirement)
                  .replace(/Call the record_naive_verdict tool[^\n]*/, `State your final verdict as:\n\n**Verdict:** JUSTIFIED | NOT_JUSTIFIED`)
              : CLAIMCHECK_PROMPT(project.name, entry.lemmaName, code, entry.requirement)
                  .replace(/Call the record_claimcheck tool[^\n]*/, `State your final verdict as:\n\n**Verdict:** JUSTIFIED | PARTIALLY_JUSTIFIED | NOT_JUSTIFIED | VACUOUS`);

            const output = await callClaude(prompt);
            const verdict = parseVerdict(output);
            const elapsedMs = Date.now() - lemmaStart;
            const status = verdict === 'JUSTIFIED' ? 'confirmed' : 'disputed';

            if (verbose) {
              console.error(`    --- ${entry.lemmaName} output ---`);
              console.error(output.slice(0, 500));
              console.error('    ---');
            }

            console.error(`    ${entry.lemmaName}: ${verdict || 'PARSE_FAILED'} → ${status} (${(elapsedMs / 1000).toFixed(1)}s)`);

            allResults.push({
              domain: project.name,
              requirement: entry.requirement,
              lemmaName: entry.lemmaName,
              expected: entry.expected ?? 'confirmed',
              status,
              verdict,
              run,
              elapsedMs,
            });
          } catch (err) {
            console.error(`    ${entry.lemmaName}: ERROR — ${err.message}`);
            allResults.push({
              domain: project.name,
              requirement: entry.requirement,
              lemmaName: entry.lemmaName,
              expected: entry.expected ?? 'confirmed',
              status: 'error',
              verdict: null,
              run,
            });
          }
        }
      }

      const domainElapsedMs = Date.now() - domainStart;
      const entries = allResults.filter(r => r.domain === project.name && r.run === run);
      const correct = entries.filter(e => isCorrect(e)).length;
      console.error(`  ${project.name}: ${correct}/${entries.length} correct (${(domainElapsedMs / 1000).toFixed(1)}s)`);
    }
    console.error('');
  }

  // --- Save results ---

  await mkdir(RESULTS_DIR, { recursive: true });

  const output = {
    label,
    timestamp: new Date().toISOString(),
    config: {
      runs,
      model: model || '(claude-code default)',
      informalizeModel: useTwoPass ? (informalizeModel || model || '(claude-code default)') : undefined,
      compareModel: useTwoPass ? (compareModel || model || '(claude-code default)') : undefined,
      mode: useTwoPass ? 'claude-code-two-pass' : useNaive ? 'claude-code-naive' : 'claude-code',
    },
    totalElapsedMs: Date.now() - totalStart,
    results: allResults,
  };

  const outPath = join(RESULTS_DIR, `${label}.json`);
  await writeFile(outPath, JSON.stringify(output, null, 2));
  console.error(`Saved: ${outPath}`);

  // --- Print summary ---

  const byKey = {};
  for (const r of allResults) {
    const key = `${r.domain}/${r.lemmaName}`;
    if (!byKey[key]) byKey[key] = { domain: r.domain, requirement: r.requirement, lemmaName: r.lemmaName, expected: r.expected, correct: 0, total: 0 };
    byKey[key].total++;
    if (isCorrect(r)) byKey[key].correct++;
  }

  console.error('\nSummary:');
  let currentDomain = null;
  let totalCorrect = 0;
  let totalCount = 0;
  for (const entry of Object.values(byKey)) {
    if (entry.domain !== currentDomain) {
      currentDomain = entry.domain;
      console.error(`  ${currentDomain}`);
    }
    const tag = entry.expected === 'disputed' ? ' [bogus]' : '';
    const name = entry.lemmaName.length > 40
      ? entry.lemmaName.slice(0, 40) + '...'
      : entry.lemmaName;
    console.error(`    ${name.padEnd(43)} ${entry.correct}/${entry.total}${tag}`);
    totalCorrect += entry.correct;
    totalCount += entry.total;
  }
  const totalElapsedMs = Date.now() - totalStart;
  console.error(`\n  Accuracy: ${totalCorrect}/${totalCount}`);
  console.error(`  Elapsed: ${(totalElapsedMs / 1000).toFixed(1)}s`);
}

function isCorrect(r) {
  if (r.expected === 'disputed') return r.status === 'disputed';
  return r.status === 'confirmed';
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
