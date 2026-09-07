/**
 * The two measured arms, each one chunk-sized API call.
 *
 *   informalize -- a frozen model writes back-translations from the artifact
 *   compare     -- the candidate judges the back-translation against the
 *                  original requirement, never seeing the artifact itself
 *
 * Prompts and tool schemas come straight from ../../src -- the same code the
 * pipeline ships, not a copy of it.
 */

import { callModel } from './models.js';
import { INFORMALIZE_TOOL, ROUNDTRIP_COMPARE_TOOL } from '../../src/schemas.js';
import { INFORMALIZE_PROMPT, ROUNDTRIP_COMPARE_PROMPT, langOf } from '../../src/prompts.js';

const LANG_KEY_MAP = { lean4: 'lean', dafny: 'dafny', sql: 'sql', isabelle: 'isabelle' };
const langKeyFor = (row) => LANG_KEY_MAP[row.language] ?? 'dafny';

export const domainOf = (chunk) => chunk[0].category ?? chunk[0].source ?? 'benchmark';
const contextOf = (chunk) => chunk[0].context || '';

function withContext(chunk, prompt) {
  const ctx = contextOf(chunk);
  if (!ctx) return prompt;
  const fence = langOf(langKeyFor(chunk[0])).fence;
  return `## Schema\n\n\`\`\`${fence}\n${ctx}\n\`\`\`\n\n${prompt}`;
}

/**
 * A model can double-encode an array field as a JSON string instead of
 * returning it natively. Recover that one case; anything else that isn't
 * already an array is returned unchanged so the all-null fallback applies.
 */
function coerceToArray(entries) {
  if (Array.isArray(entries) || typeof entries !== 'string') return entries;
  try {
    const parsed = JSON.parse(entries);
    return Array.isArray(parsed) ? parsed : entries;
  } catch {
    return entries;
  }
}

/**
 * Align a model's returned array back to chunk order by an explicit key.
 * Never by position: a model can reorder or omit entries, and a
 * position-aligned misattribution is worse than a null -- the null shows up
 * in the unparseable count, the misattribution doesn't.
 */
function alignByIndex(entries, chunk, indexOf, valueOf) {
  const out = new Array(chunk.length).fill(null);
  entries = coerceToArray(entries);
  if (!Array.isArray(entries)) return out;
  for (const entry of entries) {
    const i = indexOf(entry);
    if (!Number.isInteger(i) || i < 0 || i >= chunk.length) continue;
    const v = valueOf(entry);
    if (v !== undefined) out[i] = v;
  }
  return out;
}

function parseComparisons(toolInput, chunk) {
  return alignByIndex(
    toolInput?.comparisons, chunk,
    (e) => e?.requirementIndex,
    (e) => (typeof e?.match === 'boolean' ? e.match : undefined),
  );
}

function parseInformalizations(toolInput, chunk) {
  const entries = coerceToArray(toolInput?.informalizations);
  const byName = new Map();
  if (Array.isArray(entries)) {
    for (const e of entries) if (e?.lemmaName) byName.set(e.lemmaName, e);
  }
  return chunk.map((row) => byName.get(row.name ?? row.id) ?? null);
}

export async function runInformalizeChunk({ chunk, modelId, maxTokens = 8192 }) {
  const lemmas = chunk.map((row) => ({ lemmaName: row.name ?? row.id, dafnyCode: row.formal }));
  const prompt = withContext(chunk, INFORMALIZE_PROMPT(domainOf(chunk), lemmas, langKeyFor(chunk[0])));
  const res = await callModel({ modelId, prompt, tool: INFORMALIZE_TOOL, maxTokens });
  return { ...res, informalizations: parseInformalizations(res.toolInput, chunk) };
}

export async function runCompareChunk({ chunk, informalizations, modelId, maxTokens = 8192 }) {
  // A row with no informalization is left unjudged rather than sent a
  // fabricated placeholder: ROUNDTRIP_COMPARE_PROMPT treats a trivial-strength
  // back-translation as almost always a mismatch, so a placeholder there would
  // manufacture a verdict for a row the judge never actually saw.
  const pairs = chunk.flatMap((row, i) => (informalizations[i] ? [{
    requirementIndex: i, // into the whole chunk -- parseComparisons scatters by this
    requirement: row.informal,
    lemmaName: row.name ?? row.id,
    dafnyCode: row.formal,
    informalization: informalizations[i],
  }] : []));

  if (!pairs.length) {
    return { predictions: new Array(chunk.length).fill(null), latencyMs: 0, stopReason: null };
  }

  const prompt = withContext(chunk, ROUNDTRIP_COMPARE_PROMPT(domainOf(chunk), pairs, langKeyFor(chunk[0])));
  const res = await callModel({ modelId, prompt, tool: ROUNDTRIP_COMPARE_TOOL, maxTokens });
  return { ...res, predictions: parseComparisons(res.toolInput, chunk) };
}
