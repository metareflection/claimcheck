import Anthropic from '@anthropic-ai/sdk';

let client;
let totalInput = 0;
let totalOutput = 0;

function getClient() {
  if (!client) {
    client = new Anthropic();
  }
  return client;
}

/**
 * Call the Anthropic API with a single tool, forcing tool_use.
 * Guarantees structured JSON output matching the tool's input_schema.
 */
export async function callWithTool({ model, prompt, tool, toolChoice, system, verbose }) {
  const anthropic = getClient();

  if (verbose) {
    console.error(`[api] model=${model} tool=${tool.name} prompt_len=${prompt.length}`);
  }

  const response = await anthropic.messages.create({
    model,
    max_tokens: 4096,
    tools: [tool],
    tool_choice: toolChoice,
    ...(system ? { system } : {}),
    messages: [{ role: 'user', content: prompt }],
  });

  const toolUseBlock = response.content.find(b => b.type === 'tool_use');
  if (!toolUseBlock) {
    throw new Error(`Expected tool_use response, got: ${response.content.map(b => b.type).join(', ')}`);
  }

  totalInput += response.usage.input_tokens;
  totalOutput += response.usage.output_tokens;

  if (verbose) {
    console.error(`[api] usage: input=${response.usage.input_tokens} output=${response.usage.output_tokens}`);
  }

  return toolUseBlock;
}

export function getTokenUsage() {
  return { input: totalInput, output: totalOutput };
}
