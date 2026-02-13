import { writeFile, unlink, mkdtemp } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const execFileAsync = promisify(execFile);

/**
 * Verify a generated Dafny lemma against an existing domain.
 *
 * @param {string} dafnyCode - the lemma code (placed inside a verification module)
 * @param {string} domainDfyPath - absolute path to the domain .dfy file
 * @param {string} domainModule - the Dafny module name to import (e.g. 'CounterDomain')
 * @param {object} [opts]
 * @returns {Promise<{ success: boolean, error: string|null, output: string }>}
 */
export async function verify(dafnyCode, domainDfyPath, domainModule, opts = {}) {
  // Reject unsound constructs before running Dafny
  const unsound = checkUnsound(dafnyCode);
  if (unsound) {
    return { success: false, error: unsound, output: '' };
  }

  const tmpDir = await mkdtemp(join(tmpdir(), 'claimcheck-'));
  const tmpFile = join(tmpDir, 'verify.dfy');

  const fileContent = `include "${domainDfyPath}"

module VerifyRequirement {
  import opened D = ${domainModule}

  ${dafnyCode}
}
`;

  await writeFile(tmpFile, fileContent);

  if (opts.verbose) {
    console.error(`[verify] wrote ${tmpFile}`);
    console.error(`[verify] content:\n${fileContent}`);
  }

  try {
    const { stdout, stderr } = await execFileAsync('dafny', [
      'verify',
      tmpFile,
    ], { timeout: 10_000 });

    const output = stdout + stderr;
    const success = output.includes('0 errors');

    return { success, error: success ? null : output, output };
  } catch (err) {
    const output = (err.stdout ?? '') + (err.stderr ?? '');
    return { success: false, error: output || err.message, output };
  } finally {
    try { await unlink(tmpFile); } catch {}
  }
}

/**
 * Resolve (typecheck) a generated Dafny lemma against an existing domain.
 * Uses `dafny resolve` — no Z3, just type/name resolution.
 *
 * @param {string} dafnyCode - the lemma code (placed inside a verification module)
 * @param {string} domainDfyPath - absolute path to the domain .dfy file
 * @param {string} domainModule - the Dafny module name to import
 * @param {object} [opts]
 * @returns {Promise<{ success: boolean, error: string|null, output: string }>}
 */
export async function resolve(dafnyCode, domainDfyPath, domainModule, opts = {}) {
  const unsound = checkUnsound(dafnyCode);
  if (unsound) {
    return { success: false, error: unsound, output: '' };
  }

  const tmpDir = await mkdtemp(join(tmpdir(), 'claimcheck-'));
  const tmpFile = join(tmpDir, 'resolve.dfy');

  const fileContent = `include "${domainDfyPath}"

module VerifyRequirement {
  import opened D = ${domainModule}

  ${dafnyCode}
}
`;

  await writeFile(tmpFile, fileContent);

  if (opts.verbose) {
    console.error(`[resolve] wrote ${tmpFile}`);
    console.error(`[resolve] content:\n${fileContent}`);
  }

  try {
    const { stdout, stderr } = await execFileAsync('dafny', [
      'resolve',
      tmpFile,
    ], { timeout: 10_000 });

    const output = stdout + stderr;
    // dafny resolve exits 0 on success ("did not attempt verification")
    // and non-zero on failure (caught below)
    return { success: true, error: null, output };
  } catch (err) {
    const output = (err.stdout ?? '') + (err.stderr ?? '');
    return { success: false, error: output || err.message, output };
  } finally {
    try { await unlink(tmpFile); } catch {}
  }
}

/**
 * Check for unsound Dafny constructs that would make a proof vacuous.
 * Returns an error message if found, null if clean.
 */
function checkUnsound(code) {
  if (/^\s*assume\b/m.test(code)) {
    return 'Rejected: lemma contains an assume statement';
  }
  if (/\{:axiom\}/.test(code)) {
    return 'Rejected: lemma contains an {:axiom} attribute';
  }
  return null;
}
