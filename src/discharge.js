/**
 * Discharge readings with Dafny.
 *
 * For a lemma L (requires P_L; ensures Q_L) and a reading R of the requirement
 * (requires P_R; ensures Q_R), "L covers R" means  P_R ==> P_L  and
 * P_R && Q_L ==> Q_R.  Both are checked at once by a wrapper lemma with R's
 * contract whose body just calls L: Dafny must prove L's precondition from P_R
 * and R's postcondition from P_R plus L's postcondition.
 *
 * Three probes run per reading:
 *
 *   check    wrapper with R's contract, body calls L     -> verified: "covered"
 *   trivial  wrapper with R's contract, empty body       -> verified: "trivial"
 *            (Q_R already follows from P_R; the reading is not evidence)
 *   sat      requires P_R; ensures false; empty body     -> verified: "vacuous"
 *            (P_R is unsatisfiable in the domain)
 *
 * `check` and `trivial` run with all function bodies OPAQUE
 * (--default-function-opacity opaque). This is essential: with the domain
 * transparent, a tautology lemma would "cover" any reading the domain
 * invariant already implies, because Dafny would prove the reading from the
 * domain rather than from the lemma. Opaque, the proof can only use L's
 * contract plus Dafny's built-in theories, which is exactly "does L's
 * contract say this". `sat` runs transparent, because it asks whether the
 * reading is possible in the domain at all.
 *
 * A failed proof means "unknown", never "not covered": Dafny is incomplete,
 * and a true entailment may need a hint the wrapper does not give.
 */

import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const execFileAsync = promisify(execFile);

// --- Source-level helpers (pure, unit-tested) ---

/**
 * Parse a lemma's name, type parameters, and parameter list from its source.
 * @returns {{ name: string, typeParams: string, params: string, argNames: string[] } | null}
 */
export function parseSignature(dafnyCode) {
  const re = /\b(?:twostate\s+)?(?:ghost\s+)?(?:lemma|method)\s+(?:\{:[^}]*\}\s*)*([A-Za-z_]\w*)\s*(<[^>]*>)?\s*\(/;
  const m = re.exec(dafnyCode);
  if (!m) return null;
  const open = m.index + m[0].length - 1;
  const close = matchParen(dafnyCode, open);
  if (close === -1) return null;
  const params = dafnyCode.slice(open + 1, close).trim();
  const argNames = splitTopLevel(params)
    .map(p => /^\s*(?:ghost\s+)?(?:nameonly\s+)?([A-Za-z_]\w*)\s*:/.exec(p)?.[1])
    .filter(Boolean);
  return { name: m[1], typeParams: m[2] ?? '', params, argNames };
}

function matchParen(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/** Split on commas not nested inside (), [], <>, {}. */
export function splitTopLevel(s) {
  const out = [];
  let depth = 0, cur = '';
  for (const c of s) {
    if ('([<{'.includes(c)) depth++;
    else if (')]>}'.includes(c)) depth--;
    if (c === ',' && depth === 0) { out.push(cur); cur = ''; }
    else cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out.map(x => x.trim()).filter(Boolean);
}

/**
 * Find the module the claims file declares and the imports it opens, so the
 * harness module can see the same names the lemma sees (aliases preserved).
 * @returns {{ module: string|null, imports: string[] }}
 */
export function detectImports(claimsSource) {
  const src = claimsSource.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const mod = /\bmodule\s+(?:\{:[^}]*\}\s*)*([A-Za-z_][\w.]*)\s*(?:refines\s+[\w.]+\s*)?\{/.exec(src)?.[1] ?? null;
  const imports = [];
  const re = /\bimport\s+(opened\s+)?(?:([A-Za-z_]\w*)\s*=\s*)?([A-Za-z_][\w.]*)/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const line = `import ${m[1] ? 'opened ' : ''}${m[2] ? m[2] + ' = ' : ''}${m[3]}`;
    if (!imports.includes(line)) imports.push(line);
  }
  return { module: mod, imports };
}

/** A contract string may be one expression or already-formed `requires ...` lines. */
function clauses(keyword, text) {
  const t = (text ?? '').trim();
  if (!t) return `  ${keyword} true`;
  if (new RegExp(`^${keyword}\\b`).test(t)) return t.split('\n').map(l => '  ' + l.trim()).join('\n');
  return `  ${keyword} ${t.replace(/\s*\n\s*/g, ' ')}`;
}

/**
 * Build one harness file. `probes` is a subset of ['check', 'trivial', 'sat'].
 * @returns {{ source: string, blocks: { kind: string, start: number, end: number }[] }}
 */
export function buildHarness({ includePath, imports, sig, reading, probes, moduleName = 'ClaimcheckDischarge' }) {
  const lines = [];
  const blocks = [];
  lines.push(`include "${includePath.replace(/\\/g, '/')}"`, '', `module ${moduleName} {`);
  for (const imp of imports) lines.push(`  ${imp}`);
  lines.push('');
  const comment = `  // Reading: ${reading.reading.replace(/\s+/g, ' ')}`;
  const header = kind => `  lemma Claimcheck_${kind}${sig.typeParams}(${sig.params})`;
  const call = `${sig.name}(${sig.argNames.join(', ')});`;

  const emit = (kind, ensures, body) => {
    const start = lines.length + 1; // 1-based
    lines.push(comment, header(kind), clauses('requires', reading.requires), clauses('ensures', ensures), '  {', ...body.map(b => '    ' + b), '  }', '');
    blocks.push({ kind, start, end: lines.length });
  };
  if (probes.includes('check')) emit('check', reading.ensures, [call]);
  if (probes.includes('trivial')) emit('trivial', reading.ensures, []);
  if (probes.includes('sat')) emit('sat', 'false', []);
  lines.push('}', '');
  return { source: lines.join('\n'), blocks };
}

/**
 * Attribute Dafny's output to harness blocks.
 * @returns {{ finished: boolean, verified: Record<string, boolean>, errors: string[] }}
 */
export function parseDafnyOutput(output, blocks) {
  const finished = /verifier finished with/.test(output);
  const errors = output.split('\n').filter(l => /\bError\b/.test(l) || /\berror\b.*(parse|resolution)/i.test(l));
  const verified = {};
  for (const b of blocks) verified[b.kind] = finished;
  if (!finished) return { finished, verified, errors };
  const re = /\((\d+),(\d+)\):\s*Error/g;
  let m;
  while ((m = re.exec(output)) !== null) {
    const line = parseInt(m[1]);
    const b = blocks.find(b => line >= b.start && line <= b.end);
    if (b) verified[b.kind] = false;
    else for (const k of Object.keys(verified)) verified[k] = false; // error outside our blocks: nothing is trustworthy
  }
  return { finished, verified, errors };
}

// --- Running Dafny ---

async function runDafny(file, extraArgs, opts) {
  const bin = opts.dafnyBin ?? process.env.DAFNY ?? 'dafny';
  const timeLimit = opts.dischargeTimeLimit ?? 20; // seconds, per verification condition
  const args = ['verify', `--verification-time-limit`, String(timeLimit), ...extraArgs, file];
  try {
    const { stdout, stderr } = await execFileAsync(bin, args, { timeout: (timeLimit * 4 + 30) * 1000 });
    return { output: stdout + stderr, spawnError: null };
  } catch (err) {
    if (err.code === 'ENOENT') return { output: '', spawnError: `dafny not found (${bin})` };
    if (err.killed) return { output: (err.stdout ?? '') + (err.stderr ?? ''), spawnError: 'dafny timed out' };
    return { output: (err.stdout ?? '') + (err.stderr ?? ''), spawnError: null }; // non-zero exit = verification errors
  }
}

const OPAQUE_ARGS = ['--default-function-opacity', 'opaque'];

/**
 * Discharge one reading against one lemma.
 * @returns {Promise<{ status: 'covered'|'unknown'|'vacuous'|'trivial'|'error', probes: object, error?: string }>}
 */
export async function dischargeReading({ sig, reading, includePath, imports, opts = {} }) {
  if (!reading.ensures) return { status: 'error', probes: {}, error: 'reading has no ensures' };
  const dir = await mkdtemp(join(tmpdir(), 'claimcheck-discharge-'));
  try {
    const opaque = buildHarness({ includePath, imports, sig, reading, probes: ['check', 'trivial'], moduleName: 'ClaimcheckDischargeOpaque' });
    const sat = buildHarness({ includePath, imports, sig, reading, probes: ['sat'], moduleName: 'ClaimcheckDischargeSat' });
    const opaqueFile = join(dir, 'opaque.dfy');
    const satFile = join(dir, 'sat.dfy');
    await Promise.all([writeFile(opaqueFile, opaque.source), writeFile(satFile, sat.source)]);
    if (opts.verbose) console.error(`[discharge] ${sig.name}: reading "${reading.reading}"\n${opaque.source}`);

    const [o, s] = await Promise.all([runDafny(opaqueFile, OPAQUE_ARGS, opts), runDafny(satFile, [], opts)]);
    if (o.spawnError && /not found/.test(o.spawnError)) return { status: 'error', probes: {}, error: o.spawnError };

    const op = parseDafnyOutput(o.output, opaque.blocks);
    const sp = parseDafnyOutput(s.output, sat.blocks);
    const probes = {
      check: o.spawnError ? 'timeout' : op.finished ? (op.verified.check ? 'verified' : 'failed') : 'error',
      trivial: o.spawnError ? 'timeout' : op.finished ? (op.verified.trivial ? 'verified' : 'failed') : 'error',
      sat: s.spawnError ? 'timeout' : sp.finished ? (sp.verified.sat ? 'verified' : 'failed') : 'error',
    };
    const firstError = (op.errors[0] ?? sp.errors[0] ?? '').trim();

    // The harness itself did not parse/resolve (bad contract, missing import): nothing learned.
    if (probes.check === 'error' && probes.sat === 'error') {
      return { status: 'error', probes, error: firstError || 'dafny did not finish (parse/resolution error)' };
    }
    if (probes.sat === 'verified') return { status: 'vacuous', probes, error: 'reading precondition is unsatisfiable' };
    if (probes.trivial === 'verified') return { status: 'trivial', probes, error: 'reading postcondition follows from its precondition alone' };
    if (probes.check === 'verified') return { status: 'covered', probes };
    return { status: 'unknown', probes, ...(firstError ? { error: firstError } : {}) };
  } finally {
    if (!opts.keepDischargeFiles) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Discharge every reading of one lemma. Readings run concurrently.
 * @param {{ dafnyCode: string, lemmaName: string, readings: object[], includePath: string, imports: string[], opts?: object }} p
 * @returns {Promise<object[]>} one result per reading, aligned by index
 */
export async function dischargeLemma({ dafnyCode, lemmaName, readings, includePath, imports, opts = {} }) {
  const sig = parseSignature(dafnyCode);
  if (!sig || sig.name !== lemmaName) {
    return readings.map(() => ({ status: 'error', probes: {}, error: `could not parse signature of ${lemmaName}` }));
  }
  return Promise.all(readings.map(reading => dischargeReading({ sig, reading, includePath, imports, opts })));
}

/**
 * Build the discharge callback that claimcheck() accepts, bound to a claims file.
 * @param {{ claimsPath: string, claimsSource: string, domainModule?: string|null, opts?: object }} p
 */
export function makeDischarger({ claimsPath, claimsSource, domainModule = null, opts = {} }) {
  const { module: claimsModule, imports: detected } = detectImports(claimsSource);
  const imports = [...detected];
  if (domainModule && !imports.some(i => i.endsWith(' ' + domainModule))) imports.push(`import opened ${domainModule}`);
  if (claimsModule) imports.push(`import opened ${claimsModule}`);
  return (claim, readings) => dischargeLemma({
    dafnyCode: claim.dafnyCode, lemmaName: claim.lemmaName, readings, includePath: claimsPath, imports, opts,
  });
}
