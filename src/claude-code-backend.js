import { spawn } from 'node:child_process';

/**
 * Call Claude Code (`claude -p`) with `--json-schema` and return parsed JSON.
 *
 * @param {string} prompt
 * @param {{ model?: string, verbose?: boolean, jsonSchema?: object }} opts
 * @returns {Promise<object>} parsed structured_output from the JSON envelope
 */
function spawnClaude(prompt, opts = {}) {
  const args = [
    '-p', prompt,
    '--output-format', 'json',
    '--max-turns', '2',
  ];
  if (opts.jsonSchema) {
    args.push('--json-schema', JSON.stringify(opts.jsonSchema));
  }
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
        return;
      }
      try {
        const envelope = JSON.parse(stdout);
        resolve(envelope);
      } catch (e) {
        reject(new Error(`Failed to parse claude JSON output: ${e.message}\nRaw: ${stdout.slice(0, 500)}`));
      }
    });
    proc.on('error', err => {
      reject(new Error(`Failed to spawn claude: ${err.message}`));
    });
  });
}

/**
 * Drop-in replacement for callWithTool that uses `claude -p --json-schema`.
 *
 * Passes the tool's input_schema as the JSON schema, parses the structured
 * output, and returns { input: structured_output } (same shape as API).
 *
 * @param {{ model?: string, prompt: string, tool: { name: string, input_schema: object }, verbose?: boolean }} params
 * @returns {Promise<{ input: object }>}
 */
export async function callViaClaudeCode({ model, prompt, tool, verbose }) {
  // Replace "Call the <tool> tool..." instruction with a JSON instruction
  const adapted = prompt.replace(/Call the \S+ tool[^\n]*/, 'Respond with your analysis as JSON.');

  if (verbose) {
    console.error(`[claude-code] model=${model || '(default)'} tool=${tool.name} prompt_len=${adapted.length}`);
  }

  const envelope = await spawnClaude(adapted, {
    model,
    verbose,
    jsonSchema: tool.input_schema,
  });

  if (envelope.is_error || !envelope.structured_output) {
    const detail = envelope.result || envelope.subtype || 'unknown error';
    throw new Error(`claude -p did not return structured output (${detail})`);
  }

  const structured = envelope.structured_output;

  if (verbose) {
    console.error(`[claude-code] structured output: ${JSON.stringify(structured, null, 2).slice(0, 2000)}`);
  }

  return { input: structured };
}
