import { spawn } from 'node:child_process';

/**
 * Call Claude Code (`claude -p`) and return text output.
 *
 * @param {string} prompt
 * @param {{ model?: string, verbose?: boolean }} opts
 * @returns {Promise<string>}
 */
function spawnClaude(prompt, opts = {}) {
  const args = ['-p', prompt, '--output-format', 'text', '--max-turns', '1', '--tools', ''];
  if (opts.model) args.push('--model', opts.model);

  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.CLAUDECODE;
    const proc = spawn('claude', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => { stdout += d; });
    proc.stderr.on('data', d => { stderr += d; });

    if (opts.verbose) {
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

// --- Prompt adapters ---
// Replace "Call the X tool..." instructions with text-format output instructions.

const TEXT_INFORMALIZE_SUFFIX = `For each lemma, respond using this exact format (repeat for each lemma):

## Lemma: <lemmaName>
**Natural language:** <what the lemma guarantees, literally>
**Preconditions:** <requires clauses in English>
**Postcondition:** <ensures clauses in English>
**Scope:** <what it applies to>
**Strength:** trivial | weak | moderate | strong`;

const TEXT_COMPARE_SUFFIX = `For each pair, state your verdict using this exact format (repeat for each pair):

## Lemma: <lemmaName>
**Verdict:** JUSTIFIED | NOT_JUSTIFIED
**Discrepancy:** <what the lemma gets wrong, or "none">
**Weakening type:** none | tautology | weakened-postcondition | narrowed-scope | missing-case | wrong-property
**Explanation:** <brief reasoning>`;

const TEXT_CLAIMCHECK_SUFFIX = `State your final verdict using this exact format:

**Informalization:** <plain English of what the lemma guarantees>
**Ensures matches NL:** Yes | Partially | No
**Ensures explanation:** <explanation>
**Vacuous:** Yes | No
**Vacuous explanation:** <explanation if yes, otherwise "N/A">
**Surprising restrictions:** <description or "None">
**Verdict:** JUSTIFIED | PARTIALLY_JUSTIFIED | NOT_JUSTIFIED | VACUOUS`;

const TEXT_NAIVE_SUFFIX = `State your final verdict using this exact format:

**Verdict:** JUSTIFIED | NOT_JUSTIFIED
**Explanation:** <brief explanation>`;

/**
 * Adapt a prompt by replacing the "Call the X tool..." instruction with
 * a text-format output instruction.
 */
function adaptPrompt(prompt, toolName) {
  switch (toolName) {
    case 'record_informalizations':
      return prompt.replace(/Call the record_informalizations tool[^\n]*/, TEXT_INFORMALIZE_SUFFIX);
    case 'record_roundtrip_comparisons':
      return prompt.replace(/Call the record_roundtrip_comparisons tool[^\n]*/, TEXT_COMPARE_SUFFIX);
    case 'record_claimcheck':
      return prompt.replace(/Call the record_claimcheck tool[^\n]*/, TEXT_CLAIMCHECK_SUFFIX);
    case 'record_naive_verdict':
      return prompt.replace(/Call the record_naive_verdict tool[^\n]*/, TEXT_NAIVE_SUFFIX);
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

// --- Text parsers ---
// Parse text output back into the same shape as tool_use blocks.

function parseInformalizations(output) {
  const results = [];
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
    results.push({
      lemmaName,
      naturalLanguage: get('Natural language'),
      preconditions: get('Preconditions'),
      postcondition: get('Postcondition'),
      scope: get('Scope'),
      strength: get('Strength').toLowerCase(),
      confidence: 1,
    });
  }
  return { input: { informalizations: results } };
}

function parseComparisons(output) {
  const results = [];
  const sections = output.split(/^## Lemma:\s*/m).slice(1);
  for (const section of sections) {
    const nameMatch = section.match(/^(.+?)$/m);
    if (!nameMatch) continue;
    const lemmaName = nameMatch[1].trim();
    const get = (label) => {
      const re = new RegExp(`\\*\\*${label}:\\*\\*\\s*(.+?)(?=\\n\\*\\*|$)`, 'is');
      const m = section.match(re);
      return m ? m[1].trim() : '';
    };
    const verdictStr = get('Verdict').toUpperCase().replace(/\s+/g, '_');
    const match = verdictStr === 'JUSTIFIED';
    const discrepancy = get('Discrepancy') || '';
    const weakeningType = get('Weakening type').toLowerCase().replace(/\s+/g, '-') || 'none';
    const explanation = get('Explanation') || '';

    results.push({
      requirementIndex: null, // will be patched by caller
      lemmaName,
      match,
      discrepancy: match ? '' : discrepancy,
      weakeningType: match ? 'none' : weakeningType,
      explanation,
    });
  }
  return { input: { comparisons: results } };
}

function parseClaimcheck(output) {
  const get = (label) => {
    const re = new RegExp(`\\*\\*${label}:\\*\\*\\s*(.+?)(?=\\n\\*\\*|$)`, 'is');
    const m = output.match(re);
    return m ? m[1].trim() : '';
  };

  const verdict = get('Verdict').toUpperCase().replace(/\s+/g, '_');

  // Also try to find verdict via fallback regex if structured parse fails
  const effectiveVerdict = verdict || findLastVerdict(output);

  return {
    input: {
      lemmaName: '',  // patched by caller
      requirement: '', // patched by caller
      informalization: get('Informalization'),
      ensuresMatchesNL: get('Ensures matches NL') || 'No',
      ensuresExplanation: get('Ensures explanation'),
      vacuous: get('Vacuous').toLowerCase() === 'yes',
      vacuousExplanation: get('Vacuous explanation'),
      surprisingRestrictions: get('Surprising restrictions') || 'None',
      verdict: effectiveVerdict || 'NOT_JUSTIFIED',
    },
  };
}

function parseNaiveVerdict(output) {
  const get = (label) => {
    const re = new RegExp(`\\*\\*${label}:\\*\\*\\s*(.+?)(?=\\n\\*\\*|$)`, 'is');
    const m = output.match(re);
    return m ? m[1].trim() : '';
  };

  const verdict = get('Verdict').toUpperCase().replace(/\s+/g, '_') || findLastVerdict(output);

  return {
    input: {
      lemmaName: '', // patched by caller
      verdict: verdict || 'NOT_JUSTIFIED',
      explanation: get('Explanation'),
    },
  };
}

/**
 * Fallback: find the last verdict keyword anywhere in the output.
 */
function findLastVerdict(output) {
  const VERDICT_RE = /(?:JUSTIFIED|PARTIALLY[_ ]JUSTIFIED|NOT[_ ]JUSTIFIED|VACUOUS)/gi;
  const all = [...output.matchAll(VERDICT_RE)];
  if (all.length > 0) {
    return all[all.length - 1][0].toUpperCase().replace(/\s+/g, '_');
  }
  return null;
}

const PARSERS = {
  record_informalizations: parseInformalizations,
  record_roundtrip_comparisons: parseComparisons,
  record_claimcheck: parseClaimcheck,
  record_naive_verdict: parseNaiveVerdict,
};

/**
 * Drop-in replacement for callWithTool that uses `claude -p`.
 *
 * Adapts the prompt for text output, spawns Claude Code, and parses
 * the result back into the same { input: { ... } } shape that
 * callWithTool returns.
 *
 * @param {{ model?: string, prompt: string, tool: { name: string }, toolChoice?: any, system?: string, verbose?: boolean, maxTokens?: number }} params
 * @returns {Promise<{ input: object }>}
 */
export async function callViaClaudeCode({ model, prompt, tool, verbose }) {
  const toolName = tool.name;
  const adapted = adaptPrompt(prompt, toolName);

  if (verbose) {
    console.error(`[claude-code] model=${model || '(default)'} tool=${toolName} prompt_len=${adapted.length}`);
  }

  const output = await spawnClaude(adapted, { model, verbose });

  if (verbose) {
    console.error(`[claude-code] output_len=${output.length}`);
  }

  const parser = PARSERS[toolName];
  if (!parser) {
    throw new Error(`No parser for tool: ${toolName}`);
  }

  return parser(output);
}
