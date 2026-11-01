import { callGroq } from '../../src/provider.mjs';

const LIMITS = ['x-ratelimit-limit-requests','x-ratelimit-limit-tokens','x-ratelimit-remaining-requests','x-ratelimit-remaining-tokens'];
const RESETS = ['x-ratelimit-reset-requests','x-ratelimit-reset-tokens'];

export function safeRateLimits(headers) {
  const safe = {};
  if (!headers?.get) return safe;
  for (const name of [...LIMITS,...RESETS,'retry-after']) {
    const value = headers.get(name);
    if (typeof value !== 'string' || value.length > 80) continue;
    if (LIMITS.includes(name) ? /^\d{1,15}$/.test(value) : /^(?:\d{1,10}(?:\.\d{1,6})?(?:ms|s|m|h|d)?){1,5}$/.test(value)) safe[name] = value;
    else if (name === 'retry-after' && /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value) && Number.isFinite(Date.parse(value))) safe[name] = value;
  }
  return safe;
}

// One call through the existing parser. Capturing allowlisted headers adds no request/retry.
export async function recoveryRequest(body, apiKey, fetchImpl = globalThis.fetch) {
  let limits = {};
  const result = await callGroq(body, apiKey, { fetchImpl: async (...args) => {
    const response = await fetchImpl(...args);
    try { limits = safeRateLimits(response.headers); } catch { limits = {}; }
    return response;
  }});
  if (result.error?.httpStatus === 429) result.error = { ...result.error, rateLimit: limits };
  return result;
}
