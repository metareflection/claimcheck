/**
 * The two models the paper reports, called through the Anthropic SDK.
 *
 * The full sweep also compared other vendors via OpenRouter; none of that is
 * needed to reproduce the paper's numbers, so this only talks to Anthropic.
 */

import Anthropic from '@anthropic-ai/sdk';

export const MODELS = {
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-4-6',
};

let _client;
function client() {
  if (!_client) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _client;
}

export async function callModel({ modelId, prompt, tool, maxTokens = 8192 }) {
  const started = Date.now();
  const res = await client().messages.create({
    model: modelId,
    max_tokens: maxTokens,
    temperature: 0,
    tools: [tool],
    tool_choice: { type: 'tool', name: tool.name },
    messages: [{ role: 'user', content: prompt }],
  });
  const block = res.content.find((c) => c.type === 'tool_use');
  return {
    toolInput: block?.input ?? null,
    // A record of which snapshot answered, in case the model id is ever an
    // alias that moves.
    servedModel: res.model ?? null,
    usage: res.usage,
    stopReason: res.stop_reason ?? null,
    latencyMs: Date.now() - started,
  };
}
