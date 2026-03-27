import Anthropic from '@anthropic-ai/sdk';
import AnthropicVertex from '@anthropic-ai/vertex-sdk';

let client;
let totalInput = 0;
let totalOutput = 0;
let vertexConfig = null;

/**
 * Configure the API client to use Vertex AI.
 * Must be called before any API calls if Vertex is desired.
 * @param {{ projectId: string, region?: string }} config
 */
export function configureVertex(config) {
  vertexConfig = config;
  client = null; // reset so next getClient() picks up the new config
}

function getClient() {
  if (!client) {
    if (vertexConfig) {
      client = new AnthropicVertex({
        projectId: vertexConfig.projectId,
        region: vertexConfig.region ?? 'us-east5',
      });
    } else {
      client = new Anthropic();
    }
  }
  return client;
}

/**
 * Call the Anthropic API with a single tool, forcing tool_use.
 * Guarantees structured JSON output matching the tool's input_schema.
 */
export async function callWithTool({ model, prompt, tool, toolChoice, system, verbose, maxTokens }) {
  const anthropic = getClient();

  if (verbose) {
    console.error(`[api] model=${model} tool=${tool.name} prompt_len=${prompt.length}`);
  }

  const response = await anthropic.messages.create({
    model,
    max_tokens: maxTokens ?? 4096,
    temperature: 0,
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

export function resetTokenUsage() {
  totalInput = 0;
  totalOutput = 0;
}
