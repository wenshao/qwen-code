// Send the EXACT tool payload each arm put on the wire (captured from the
// mock logs) to real providers, and record whether the request is accepted
// and what read_file arguments the model emits. Keys are read from
// ~/.qwen/settings.json and never printed.
// Usage: node provider-probe.mjs <out.json>
import fs from 'node:fs';
import os from 'node:os';

const H = '/root/verify/pr12421-harness';
const settings = JSON.parse(fs.readFileSync(`${os.homedir()}/.qwen/settings.json`, 'utf8'));
const key = (name) => settings.env?.[name] ?? process.env[name];
const firstBody = (tag) => JSON.parse(fs.readFileSync(`${H}/logs/${tag}.wire.jsonl`, 'utf8').split('\n')[0]).body;
const payload = {};
for (const arm of ['base', 'pr']) {
  payload[`${arm}:chat`] = firstBody(`${arm}-chat-notebook`).tools;
  payload[`${arm}:responses`] = firstBody(`${arm}-responses-notebook`).tools;
  payload[`${arm}:anthropic`] = firstBody(`${arm}-anthropic-notebook`).tools;
}
const NB = `${H}/ws/example.ipynb`;
const PROMPT = `Use the read_file tool to read the Jupyter notebook at ${NB}. Call the tool now; do not answer in text.`;

const PROVIDERS = [
  { name: 'dashscope qwen3.8-max (chat)', proto: 'chat', url: '<DASHSCOPE_BASE_URL>', model: 'qwen3.8-max', env: 'DASHSCOP_REVIEW_AK' },
  { name: 'dashscope qwen3.8-max (responses)', proto: 'responses', url: '<DASHSCOPE_BASE_URL>', model: 'qwen3.8-max', env: 'DASHSCOP_REVIEW_AK' },
  { name: 'dashscope qwen3.7-max (chat)', proto: 'chat', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen3.7-max', env: 'DASHSCOP_REVIEW_AK' },
  { name: 'token-plan glm-5.2 (chat)', proto: 'chat', url: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1', model: 'glm-5.2', env: 'DASHSCOP_AK' },
  { name: 'deepseek-v4-flash (chat)', proto: 'chat', url: 'https://api.deepseek.com', model: 'deepseek-v4-flash', env: 'DEEPSEEK_API_KEY' },
  { name: 'xiaomi mimo-v2.5-pro (chat)', proto: 'chat', url: 'https://api.xiaomimimo.com/v1', model: 'mimo-v2.5-pro', env: 'XIAOMI_AK' },
  { name: 'gpt-5.6-luna via proxy (chat)', proto: 'chat', url: '<GPT_PROXY_BASE_URL>', model: 'gpt-5.6-luna', env: 'CLIPROXY_API_KEY' },
  { name: 'gpt-5.6-luna via proxy (responses)', proto: 'responses', url: '<GPT_PROXY_BASE_URL>', model: 'gpt-5.6-luna', env: 'CLIPROXY_API_KEY' },
  { name: 'kimi-k3 (anthropic)', proto: 'anthropic', url: 'https://api.kimi.com/coding', model: 'kimi-k3', env: 'KIMI_API_KEY' },
  { name: 'macaron-v1-coding-venti (anthropic)', proto: 'anthropic', url: 'https://mintcn.macaron.xin', model: 'macaron-v1-coding-venti', env: 'macaron_AK' },
];
const only = process.argv[3] ? new RegExp(process.argv[3]) : null;

async function probe(p, arm) {
  const k = key(p.env);
  if (!k) return { status: 'no-key' };
  const tools = payload[`${arm}:${p.proto}`];
  let url, headers, body;
  if (p.proto === 'chat') {
    url = `${p.url}/chat/completions`;
    headers = { authorization: `Bearer ${k}`, 'content-type': 'application/json' };
    body = { model: p.model, messages: [{ role: 'user', content: PROMPT }], tools, max_tokens: 4000 };
  } else if (p.proto === 'responses') {
    url = `${p.url}/responses`;
    headers = { authorization: `Bearer ${k}`, 'content-type': 'application/json' };
    body = { model: p.model, input: [{ role: 'user', content: PROMPT }], tools, max_output_tokens: 4000 };
  } else {
    url = `${p.url}/v1/messages`;
    headers = { 'x-api-key': k, authorization: `Bearer ${k}`, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' };
    body = { model: p.model, messages: [{ role: 'user', content: PROMPT }], tools, max_tokens: 4000 };
  }
  const t0 = Date.now();
  try {
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(180000) });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    let calls = [];
    if (json) {
      if (p.proto === 'chat') calls = (json.choices?.[0]?.message?.tool_calls || []).map((c) => ({ name: c.function.name, args: c.function.arguments }));
      else if (p.proto === 'responses') calls = (json.output || []).filter((o) => o.type === 'function_call').map((c) => ({ name: c.name, args: c.arguments }));
      else calls = (json.content || []).filter((c) => c.type === 'tool_use').map((c) => ({ name: c.name, args: JSON.stringify(c.input) }));
    }
    return { http: res.status, ms: Date.now() - t0, calls, error: res.ok ? undefined : text.slice(0, 400) };
  } catch (e) {
    return { http: 'fetch-error', error: String(e).slice(0, 300) };
  }
}

const results = [];
for (const p of PROVIDERS) {
  if (only && !only.test(p.name)) continue;
  for (const arm of ['base', 'pr']) {
    const r = await probe(p, arm);
    results.push({ provider: p.name, arm, ...r });
    console.log(`${p.name.padEnd(38)} ${arm.padEnd(4)} http=${r.http ?? r.status} ${r.ms ?? ''}ms calls=${JSON.stringify(r.calls ?? [])}${r.error ? ' ERR=' + r.error.replace(/\s+/g, ' ').slice(0, 200) : ''}`);
  }
}
fs.writeFileSync(process.argv[2], JSON.stringify(results, null, 1));
