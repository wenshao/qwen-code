// Extract per-step results from a run: issued args (mock), is_error (stream-json)
// and the model-visible tool output (next request's history on the wire).
// Usage: node extract.mjs <tag> [--json]
import fs from 'node:fs';

const H = '/root/verify/pr12421-harness';
const tag = process.argv[2];
const asJson = process.argv.includes('--json');
const wire = fs.readFileSync(`${H}/logs/${tag}.wire.jsonl`, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const stream = fs.readFileSync(`${H}/out/${tag}.stream.jsonl`, 'utf8').trim().split('\n').flatMap((l) => {
  try { return [JSON.parse(l)]; } catch { return []; }
});

const textOf = (c) =>
  typeof c === 'string'
    ? c
    : Array.isArray(c)
      ? c.map((p) => (typeof p === 'string' ? p : (p?.text ?? (typeof p?.content === 'string' ? p.content : JSON.stringify(p))))).join('')
      : JSON.stringify(c ?? '');

// Model-visible outputs keyed by call id, from every main request.
const outputs = new Map();
for (const w of wire) {
  const b = w.body;
  if (w.path.startsWith('/v1/chat/completions')) {
    for (const m of b.messages || []) if (m.role === 'tool') outputs.set(m.tool_call_id, textOf(m.content));
  } else if (w.path.startsWith('/v1/responses')) {
    for (const m of Array.isArray(b.input) ? b.input : []) if (m?.type === 'function_call_output') outputs.set(m.call_id, textOf(m.output));
  } else {
    for (const m of b.messages || []) if (Array.isArray(m.content)) for (const p of m.content) if (p?.type === 'tool_result') outputs.set(p.tool_use_id, textOf(p.content));
  }
}
const isError = new Map();
for (const e of stream) {
  if (e.type !== 'user') continue;
  for (const p of e.message?.content || []) if (p.type === 'tool_result') isError.set(p.tool_use_id, p.is_error);
}
const rows = [];
for (const w of wire) {
  if (!w.issued) continue;
  const id = w.issued.id;
  rows.push({
    step: id.replace(/^call_/, ''),
    args: w.issued.args,
    source: w.issued.source,
    is_error: isError.get(id),
    output: outputs.get(id) ?? '<no output on wire>',
  });
}
const result = stream.find((e) => e.type === 'result');
if (asJson) {
  console.log(JSON.stringify({ tag, result: result ? { subtype: result.subtype, is_error: result.is_error } : null, rows }, null, 1));
} else {
  console.log(`## ${tag}  result=${result?.subtype}`);
  for (const r of rows) {
    const shown = { ...r.args };
    if (shown.file_path) shown.file_path = shown.file_path.replace(/.*\//, '…/');
    console.log(`- ${r.step}  args=${JSON.stringify(shown)}${r.source !== 'script' ? ` [${r.source}]` : ''}\n    error=${r.is_error}  out=${JSON.stringify(r.output.slice(0, 260))}`);
  }
}
