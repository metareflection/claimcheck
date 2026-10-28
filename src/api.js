import Anthropic from '@anthropic-ai/sdk';
import AnthropicVertex from '@anthropic-ai/vertex-sdk';
import { AnthropicBedrock, AnthropicBedrockMantle } from '@anthropic-ai/bedrock-sdk';

let client;
let legacyBedrockClient;
let strictDisallowed = false;
let totalInput = 0;
let totalOutput = 0;
let vertexConfig = null;
let bedrockConfig = null;

/**
 * Configure the API client to use Vertex AI.
 * Must be called before any API calls if Vertex is desired.
 * @param {{ projectId: string, region?: string }} config
 */
export function configureVertex(config) {
  vertexConfig = config;
  bedrockConfig = null;
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
  client = null;
  legacyBedrockClient = null;
}

// Bedrock serves Claude through two integrations: bedrock-runtime InvokeModel, with
// inference-profile IDs (`us.anthropic.claude-sonnet-5-5`,
// `us.anthropic.claude-haiku-4-5-20251001-v1:0`) or ARNs, and the Messages-API
// ("Mantle") endpoint, with bare `anthropic.`-prefixed IDs. Which models an account
// can reach on each differs, so route by ID shape.
function isLegacyBedrockModel(model) {
  return /^(arn:|[a-z]+\.anthropic\.)/.test(model) || /-v\d+:\d+$/.test(model);
}

function getClient(model) {
  if (bedrockConfig && isLegacyBedrockModel(model)) {
    legacyBedrockClient ??= new AnthropicBedrock({
      awsRegion: bedrockConfig.region ?? 'us-east-1',
    });
    return legacyBedrockClient;
  }
  if (!client) {
    if (vertexConfig) {
      client = new AnthropicVertex({
        projectId: vertexConfig.projectId,
        region: vertexConfig.region ?? 'global',
      });
    } else if (bedrockConfig) {
      client = new AnthropicBedrockMantle({
        awsRegion: bedrockConfig.region ?? 'us-east-1',
      });
    } else {
      client = new Anthropic();
    }
  }
  return client;
}

// Claude 3.x / 4.x accept forced tool_choice with thinking off by default. Newer
// models think by default, and Opus 5.5 / Sonnet 5.5 / Fable 5.1 reject forced
// tool_choice outright, so for those we use `auto` + strict tool use and check
// that the call happened.
function isLegacyGeneration(model) {
  return /claude-3|(opus|sonnet|haiku)-4(-|@|$)/.test(model);
}

// Only Claude 4.6 and earlier accept a non-default temperature.
function supportsTemperature(model) {
  if (/claude-3/.test(model)) return true;
  const m = model.match(/(?:opus|sonnet|haiku)-4(?:-(\d+))?/);
  if (!m) return false;
  const minor = m[1] && m[1].length < 8 ? Number(m[1]) : 0; // 8 digits: a date (4.0)
  return minor <= 6;
}

// Strict tool use requires additionalProperties: false on every object.
function strictSchema(schema) {
  if (Array.isArray(schema)) return schema.map(strictSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const out = Object.fromEntries(Object.entries(schema).map(([k, v]) => [k, strictSchema(v)]));
  if (out.type === 'object') out.additionalProperties = false;
  return out;
}

/**
 * Call the Anthropic API with a single tool and return its tool_use block.
 * Guarantees structured JSON output matching the tool's input_schema.
 */
export async function callWithTool({ model, prompt, tool, toolChoice, system, verbose, maxTokens }) {
  if (bedrockConfig && model.startsWith('claude-')) model = `anthropic.${model}`;
  const anthropic = getClient(model);

  if (verbose) {
    console.error(`[api] model=${model} tool=${tool.name} prompt_len=${prompt.length}`);
  }

  const legacy = isLegacyGeneration(model);
  const params = {
    model,
    // Newer models think by default, and thinking counts against max_tokens.
    max_tokens: legacy ? (maxTokens ?? 4096) : Math.max(maxTokens ?? 4096, 16000),
    ...(supportsTemperature(model) ? { temperature: 0 } : {}),
    tools: [legacy || strictDisallowed ? tool : { ...tool, input_schema: strictSchema(tool.input_schema), strict: true }],
    tool_choice: legacy ? toolChoice : { type: 'auto' },
    ...(system ? { system } : {}),
    messages: [{ role: 'user', content: prompt }],
  };

  // With tool_choice auto the call isn't guaranteed: nudge once if it's missing.
  for (let attempt = 0; ; attempt++) {
    let response;
    try {
      response = await anthropic.messages.create(params);
    } catch (e) {
      // Some org policies (e.g. Vertex's allowedPartnerModelFeatures) disallow strict
      // tool use ("structured_outputs"); drop it for the rest of the run.
      if (e?.status !== 400 || !params.tools[0].strict || !/structured_outputs|strict/i.test(e.message)) throw e;
      if (verbose) console.error('[api] strict tool use disallowed; retrying without it');
      strictDisallowed = true;
      params.tools = [tool];
      response = await anthropic.messages.create(params);
    }

    totalInput += response.usage.input_tokens;
    totalOutput += response.usage.output_tokens;

    if (verbose) {
      console.error(`[api] usage: input=${response.usage.input_tokens} output=${response.usage.output_tokens} stop=${response.stop_reason}`);
    }

    if (response.stop_reason === 'refusal') {
      const d = response.stop_details;
      throw new Error(`Model ${model} refused the request${d?.category ? ` (${d.category})` : ''}${d?.explanation ? `: ${d.explanation}` : ''}`);
    }

    const toolUseBlock = response.content.find(b => b.type === 'tool_use' && b.name === tool.name);
    if (toolUseBlock) return toolUseBlock;

    if (legacy || attempt >= 1 || response.stop_reason !== 'end_turn') {
      throw new Error(`Expected ${tool.name} tool_use response (stop_reason=${response.stop_reason}), got: ${response.content.map(b => b.type).join(', ')}`);
    }
    params.messages = [
      ...params.messages,
      { role: 'assistant', content: response.content },
      { role: 'user', content: `Call the ${tool.name} tool now with your answer.` },
    ];
  }
}

export function getTokenUsage() {
  return { input: totalInput, output: totalOutput };
}

export function resetTokenUsage() {
  totalInput = 0;
  totalOutput = 0;
}
