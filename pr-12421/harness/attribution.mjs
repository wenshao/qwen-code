import fs from 'node:fs'; import os from 'node:os';
const H = '/root/verify/pr12421-harness';
const k = JSON.parse(fs.readFileSync(`${os.homedir()}/.qwen/settings.json`, 'utf8')).env.CLIPROXY_API_KEY;
const tools = (arm) => JSON.parse(fs.readFileSync(`${H}/logs/${arm}-chat-notebook.wire.jsonl`, 'utf8').split('\n')[0]).body.tools;
const clone = (x) => JSON.parse(JSON.stringify(x));
const rf = (ts) => ts.find((t) => t.function.name === 'read_file').function;
function variant(schemaFrom, descFrom) {
  const ts = clone(tools(schemaFrom)); const d = rf(tools(descFrom)); const f = rf(ts);
  f.description = d.description;
  for (const p of ['offset', 'limit', 'pages']) f.parameters.properties[p].description = d.parameters.properties[p].description;
  return ts;
}
const V = { 'A base schema + base text': variant('base', 'base'), 'B base schema + PR text': variant('base', 'pr'), 'C PR schema + base text': variant('pr', 'base'), 'D PR schema + PR text': variant('pr', 'pr') };
const N = Number(process.argv[2] || 3);
for (const [name, ts] of Object.entries(V)) {
  const tally = {};
  for (let i = 0; i < N; i++) {
    const res = await fetch('<GPT_PROXY_BASE_URL>/chat/completions', { method: 'POST', headers: { authorization: `Bearer ${k}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-5.6-luna', messages: [{ role: 'user', content: `Use the read_file tool to read ${H}/ws/example.ipynb. Call the tool now; do not answer in text.` }], tools: ts }) });
    const j = await res.json().catch(() => null);
    let a = null; try { a = JSON.parse(j?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments); } catch {}
    const shape = a ? JSON.stringify(Object.fromEntries(Object.entries(a).filter(([x]) => x !== 'file_path'))) : `http=${res.status} no-call`;
    tally[shape] = (tally[shape] || 0) + 1;
  }
  console.log(name.padEnd(28), JSON.stringify(tally));
}
