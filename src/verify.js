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
  const tmpDir = await mkdtemp(join(tmpdir(), 'claimcheck-'));
  const tmpFile = join(tmpDir, 'verify.dfy');

  const fileContent = `include "${domainDfyPath}"

module VerifyRequirement {
  import D = ${domainModule}

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
      '--allow-warnings',
      tmpFile,
    ], { timeout: 120_000 });

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
