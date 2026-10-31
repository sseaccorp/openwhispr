import { performance } from 'node:perf_hooks';
import { ENDPOINT, MODEL } from './shared.mjs';

export function requestBody(prompt, input, effort = 'low', maxTokens = 512) {
  return {
    model: MODEL, reasoning_effort: effort, temperature: 0, seed: 42,
    max_completion_tokens: maxTokens, stream: false,
    messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: input }]
  };
}

export function ratesFromEnv(env) {
  const parse = name => {
    if (!env[name]?.trim()) throw new Error(`Set ${name} to a verified current provider price, including 0 if applicable`);
    const value = Number(env[name]);
    if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid ${name}`);
    return value;
  };
  return { inputPerMillion: parse('FLOSI_LAB_INPUT_USD_PER_MILLION'), outputPerMillion: parse('FLOSI_LAB_OUTPUT_USD_PER_MILLION'), currency: 'USD' };
}

export function validUsage(usage) {
  return usage && ['prompt_tokens', 'completion_tokens', 'total_tokens'].every(k => Number.isSafeInteger(usage[k]) && usage[k] >= 0)
    && usage.total_tokens === usage.prompt_tokens + usage.completion_tokens;
}

export function estimateCost(usage, rates) {
  return validUsage(usage) ? (usage.prompt_tokens * rates.inputPerMillion + usage.completion_tokens * rates.outputPerMillion) / 1e6 : null;
}

export function reserveCost(body, rates) {
  // Conservative UTF-8 byte bound plus framing allowance; not a provider billing guarantee.
  const inputBound = Buffer.byteLength(JSON.stringify(body.messages), 'utf8') + 1024;
  return (inputBound * rates.inputPerMillion + body.max_completion_tokens * rates.outputPerMillion) / 1e6;
}

export async function callGroq(body, apiKey, { fetchImpl = globalThis.fetch, timeoutMs = 30000 } = {}) {
  const started = performance.now();
  let response;
  try {
    response = await fetchImpl(ENDPOINT, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    // Do not log arbitrary error bodies, headers, or exception messages (they can echo secrets).
    if (!response.ok) return { status: 'api_error', latencyMs: performance.now() - started, error: { type: 'http', httpStatus: response.status }, rawResponse: null, output: null, usage: null };
    let payload;
    try { payload = await response.json(); }
    catch { return { status: 'api_error', latencyMs: performance.now() - started, error: { type: 'invalid_json' }, rawResponse: null, output: null, usage: null }; }
    const choice = payload.choices?.[0];
    const output = choice?.message?.content;
    const usage = validUsage(payload.usage) ? payload.usage : null;
    // Keep the provider JSON for successful HTTP replies; redacted before disk writes.
    const common = { latencyMs: performance.now() - started, rawResponse: payload, output: typeof output === 'string' ? output : null, usage };
    if (choice?.finish_reason !== 'stop' || typeof output !== 'string' || !output.trim() || choice.message.tool_calls?.length) {
      return { ...common, status: 'invalid_response', error: { type: choice?.finish_reason === 'length' ? 'truncated' : 'unexpected_response' } };
    }
    if (!usage) return { ...common, status: 'invalid_response', error: { type: 'missing_or_invalid_usage' } };
    return { ...common, status: 'ok', error: null };
  } catch (error) {
    return { status: 'api_error', latencyMs: performance.now() - started, error: { type: ['TimeoutError', 'AbortError'].includes(error.name) ? 'timeout' : 'network' }, rawResponse: null, output: null, usage: null };
  }
}
