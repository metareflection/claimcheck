import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Run dafny2js --claims on an entry file to extract claims JSON.
 *
 * @param {string} entryFile - absolute path to the Dafny entry file
 * @param {string} dafny2jsDir - path to the dafny2js project directory
 * @param {object} [opts]
 * @returns {Promise<object>} parsed claims JSON
 */
export async function extractClaims(entryFile, dafny2jsDir, opts = {}) {
  if (opts.verbose) {
    console.error(`[extract] running dafny2js --claims on ${entryFile}`);
  }

  const { stdout, stderr } = await execFileAsync('dotnet', [
    'run', '--no-build', '--',
    '--file', entryFile,
    '--claims',
  ], {
    cwd: dafny2jsDir,
    timeout: 60_000,
  });

  if (opts.verbose && stderr) {
    console.error(`[extract] stderr: ${stderr}`);
  }

  return JSON.parse(stdout);
}
