// Direct probe: does an endpoint accept a given max_tokens for a model?
// usage: node probe-limit.mjs <envKeyName> <baseUrl> <model> <max_tokens> [stream]
import { readFileSync } from 'node:fs';
const [keyName, baseUrl, model, maxTokens] = process.argv.slice(2);
const s = JSON.parse(readFileSync(process.env.HOME + '/.qwen/settings.json', 'utf8'));
const key = s.env[keyName];
const body = { model, max_tokens: Number(maxTokens), messages: [{ role: 'user', content: 'Reply with the single word: ok' }], stream: true };
const res = await fetch(baseUrl.replace(/\/$/, '') + '/chat/completions', {
  method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify(body),
});
const text = await res.text();
console.log(JSON.stringify({ model, max_tokens: Number(maxTokens), status: res.status, body: text.slice(0, 300).replace(key, '<redacted>') }));
