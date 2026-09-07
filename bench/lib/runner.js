/**
 * Execution plumbing: bounded concurrency, transient-failure retry, and
 * crash-safe checkpointing. No API or prompt knowledge.
 */

import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * 529 is the one that matters here. Anthropic returns it under genuine
 * platform load, and the prior sweep's retry regex matched only 429 -- so
 * every 529 was treated as a hard failure and silently corrupted results.
 * 402 (insufficient balance) and 400 (bad request) are real rejections and
 * must fail fast rather than burn the retry budget.
 *
 * Node socket errors carry transient signals in .code and .name, not in
 * .message. Also follow .cause one level (fetch wraps the real error there).
 */
export function isTransient(err) {
  const msg = err?.message ?? String(err);
  const code = err?.code;
  const name = err?.name;

  // Fast-fail on 40x errors (except 429)
  if (/\b40[0-9]\b/.test(msg) && !/\b429\b/.test(msg)) return false;

  // Check message, code, and name for transient patterns
  const isTransientPattern = /rate_limit|\b429\b|\b5\d\d\b|overloaded|ECONNRESET|ETIMEDOUT|ENOTFOUND|fetch failed/i.test(msg)
    || /^ECONNRESET|ETIMEDOUT|ENOTFOUND|UND_ERR/.test(code || '')
    || name === 'AbortError';

  if (isTransientPattern) return true;

  // Follow cause one level (fetch wraps real error there)
  const cause = err?.cause;
  if (cause) {
    const causeCode = cause?.code;
    const causeName = cause?.name;
    if (/^ECONNRESET|ETIMEDOUT|ENOTFOUND|UND_ERR/.test(causeCode || '')) return true;
    if (causeName === 'AbortError') return true;
  }

  return false;
}

export async function withRetry(fn, { retries = 5, baseDelayMs = 1000, sleep } = {}) {
  const wait = sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isTransient(err) || attempt >= retries) throw err;
      await wait(baseDelayMs * 2 ** attempt);
    }
  }
}

/**
 * Run `fn` over `items` with at most `limit` in flight. Results come back in
 * input order regardless of completion order, so a chunk's index always
 * matches its rows.
 */
export async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Append-on-every-write progress file.
 *
 * Writes go to a temp file and are renamed into place, so a kill mid-write
 * leaves the previous good checkpoint intact rather than a truncated JSON file.
 */
export class Checkpoint {
  static #seq = 0;

  #path;
  #data;

  constructor(path, data) {
    this.#path = path;
    this.#data = data;
  }

  static async open(path) {
    try {
      return new Checkpoint(path, JSON.parse(await readFile(path, 'utf8')));
    } catch (err) {
      // ENOENT means file doesn't exist yet -- normal first-run case
      if (err.code === 'ENOENT') {
        return new Checkpoint(path, {});
      }
      // Any other error (corrupt JSON, permissions, etc.) is unrecoverable
      throw new Error(`Checkpoint at ${path} is unreadable and should be inspected or deleted: ${err.message}`);
    }
  }

  done(key) { return key in this.#data; }
  entries() { return this.#data; }

  /**
   * Write-then-rename, with a tmp path unique to this write.
   *
   * A single shared `${path}.tmp` races itself under concurrency: writer A
   * creates the tmp, writer B overwrites it, A renames it away, and B's
   * rename then fails ENOENT and kills the run. Observed live on the
   * spider2 informalize cache at concurrency 3. The counter alone would be
   * enough within one process; the pid keeps two processes that share an
   * output path from colliding as well.
   */
  async record(key, value) {
    this.#data[key] = value;
    await mkdir(dirname(this.#path), { recursive: true });
    const tmp = `${this.#path}.${process.pid}.${Checkpoint.#seq++}.tmp`;
    await writeFile(tmp, JSON.stringify(this.#data, null, 2));
    await rename(tmp, this.#path);
  }
}
