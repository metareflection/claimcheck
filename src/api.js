import Anthropic from '@anthropic-ai/sdk';
import AnthropicVertex from '@anthropic-ai/vertex-sdk';
import { AnthropicBedrock } from '@anthropic-ai/bedrock-sdk';

let client;
let totalInput = 0;
let totalOutput = 0;
let vertexConfig = null;
let bedrockConfig = null;
let openRouterConfig = null;

/**
 * Configure the API client to use Vertex AI.
 * Must be called before any API calls if Vertex is desired.
 * @param {{ projectId: string, region?: string }} config
 */
export function configureVertex(config) {
  vertexConfig = config;
  bedrockConfig = null;
  openRouterConfig = null;
  client = null; // reset so next getClient() picks up the new config
}

/**
 * Configure the API client to use AWS Bedrock.
 * Must be called before any API calls if Bedrock is desired.
 * Credentials come from the standard AWS credential chain
 * (env vars, ~/.aws/credentials, SSO, IMDS).
 * @param {{ region?: string }} config
 */
export function configureBedrock(config) {
  bedrockConfig = config ?? {};
  vertexConfig = null;
  openRouterConfig = null;
  client = null;
}

/**
 * Configure the API client to route through OpenRouter's Anthropic-compatible
 * endpoint, which accepts the standard Messages API shape (tools and
 * tool_choice included) and forwards to whichever model the id maps to.
 * Model ids must then be given in OpenRouter's namespaced form.
 * Must be called before any API calls if a non-Anthropic model is desired.
 * @param {{ apiKey?: string }} [config] - falls back to OPENROUTER_API_KEY
 */
export function configureOpenRouter(config = {}) {
  const apiKey = config.apiKey ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OpenRouter requires config.apiKey or the OPENROUTER_API_KEY env var');
  }
  openRouterConfig = { apiKey };
  vertexConfig = null;
  bedrockConfig = null;
  client = null;
}

function getClient() {
  if (!client) {
    if (vertexConfig) {
      client = new AnthropicVertex({
        projectId: vertexConfig.projectId,
        region: vertexConfig.region ?? 'us-east5',
      });
    } else if (bedrockConfig) {
      client = new AnthropicBedrock({
        awsRegion: bedrockConfig.region ?? 'us-east-1',
      });
    } else if (openRouterConfig) {
      // apiKey is resolved and validated in configureOpenRouter, so it is
      // never undefined here — passing undefined would make the SDK fall back
      // to ANTHROPIC_API_KEY and send it to a third-party host.
      client = new Anthropic({
        baseURL: 'https://openrouter.ai/api',
        apiKey: openRouterConfig.apiKey,
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

  // Opus 4.7+ and the Sonnet/Opus 5 family reject `temperature` outright
  // (400: "temperature is deprecated for this model"). Matched loosely enough
  // to cover dated aliases and the Bedrock/Vertex id prefixes, but anchored on
  // `claude-` so third-party ids carrying a "5" are unaffected.
  const supportsTemperature = !/opus-4-[789]|claude-(sonnet|opus)-5/.test(model);

  const response = await anthropic.messages.create({
    model,
    max_tokens: maxTokens ?? 4096,
    ...(supportsTemperature ? { temperature: 0 } : {}),
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
