import fs from 'node:fs'; import os from 'node:os';
const H = '/root/verify/pr12421-harness';
const k = JSON.parse(fs.readFileSync(`${os.homedir()}/.qwen/settings.json`, 'utf8')).env.CLIPROXY_API_KEY;
const firstBody = (t) => JSON.parse(fs.readFileSync(`${H}/logs/${t}.wire.jsonl`, 'utf8').split('\n')[0]).body;
const URL = '<GPT_PROXY_BASE_URL>';
const N = Number(process.argv[2] || 5);
const targets = { notebook: `${H}/ws/example.ipynb`, text: `${H}/ws/notes.txt` };
const out = [];
for (const [kind, file] of Object.entries(targets)) for (const proto of ['chat', 'responses']) for (const arm of ['base', 'pr']) {
  const tools = firstBody(`${arm}-${proto}-notebook`).tools;
  const prompt = `Use the read_file tool to read ${file}. Call the tool now; do not answer in text.`;
  const tally = {};
  for (let i = 0; i < N; i++) {
    const body = proto === 'chat'
      ? { model: 'gpt-5.6-luna', messages: [{ role: 'user', content: prompt }], tools }
      : { model: 'gpt-5.6-luna', input: [{ role: 'user', content: prompt }], tools };
    const res = await fetch(`${URL}/${proto === 'chat' ? 'chat/completions' : 'responses'}`, { method: 'POST', headers: { authorization: `Bearer ${k}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => null);
    const args = proto === 'chat' ? j?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments : j?.output?.find((o) => o.type === 'function_call')?.arguments;
    let a = null; try { a = JSON.parse(args); } catch {}
    const shape = a ? JSON.stringify(Object.fromEntries(Object.entries(a).filter(([k2]) => k2 !== 'file_path'))) : `http=${res.status} no-call`;
    tally[shape] = (tally[shape] || 0) + 1;
    out.push({ kind, proto, arm, i, http: res.status, args: a });
  }
  console.log(`${kind.padEnd(8)} ${proto.padEnd(9)} ${arm.padEnd(4)} ${JSON.stringify(tally)}`);
}
fs.writeFileSync(`${H}/out/gpt-repeat.json`, JSON.stringify(out, null, 1));
