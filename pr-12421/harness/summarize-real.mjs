import fs from 'node:fs';
const f = process.argv[2];
const ev = fs.readFileSync(f, 'utf8').trim().split('\n').flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
const calls = []; const res = new Map();
for (const e of ev) for (const p of e.message?.content || []) {
  if (p.type === 'tool_use') calls.push(p);
  if (p.type === 'tool_result') res.set(p.tool_use_id, p);
}
const r = ev.find((e) => e.type === 'result');
console.log(`## ${f.replace(/.*\//, '')}: ${calls.length} tool calls, result=${r?.subtype} is_error=${r?.is_error} turns=${r?.num_turns}`);
for (const c of calls) {
  const x = res.get(c.id); const a = { ...c.input }; if (a.file_path) a.file_path = '…/' + a.file_path.split('/').pop();
  const content = typeof x?.content === 'string' ? x.content : JSON.stringify(x?.content);
  console.log(`  ${c.name} ${JSON.stringify(a)} -> ${x?.is_error ? 'ERROR' : 'ok'}: ${(content || '').replace(/\s+/g, ' ').slice(0, 150)}`);
}
console.log(`  final: ${JSON.stringify((r?.result ?? '').slice(0, 300))}`);
