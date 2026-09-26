// For each smoke run: pull the main-session system prompt off the wire, diff arms, and
// report the billed usage the provider returned.
import fs from 'node:fs';
const V = '/Users/wenshao/git/v12784';
const sys = (id) => {
  const dir = `${V}/wire/${id}`;
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.req.json')).sort()) {
    const j = JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8'));
    const s = j.messages?.find((m) => m.role === 'system');
    const text = typeof s?.content === 'string' ? s.content : s?.content?.map((c) => c.text).join('');
    if (text?.includes('# Core Mandates'))
      return { file: f, text, tools: (j.tools || []).map((t) => t.function?.name), model: j.model };
  }
};
const usage = (id) => {
  const r = fs.readFileSync(`${V}/runs/${id}/out.jsonl`, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).find((e) => e.type === 'result');
  return r?.usage;
};
const res = {};
for (const t of [0, 1]) {
  const a = sys(`smoke-qwen3-base-t${t}-1`), b = sys(`smoke-qwen3-head-t${t}-1`);
  const al = a.text.split('\n'), bl = b.text.split('\n');
  const removed = al.filter((l) => !bl.includes(l)), added = bl.filter((l) => !al.includes(l));
  res[`todo${t}`] = {
    model: a.model,
    todoWriteDeclared: [a.tools.includes('todo_write'), b.tools.includes('todo_write')],
    sameToolList: JSON.stringify(a.tools) === JSON.stringify(b.tools),
    systemChars: [a.text.length, b.text.length],
    lines: [al.length, bl.length],
    removed, added,
    renderMatchesWire: {
      // the wire prompt should contain the dist render's changed lines verbatim
      merged: added.every((l) => fs.readFileSync(`${V}/render/merged/general.headless.todo${t}.cm0.full.nostyle.md`, 'utf8').includes(l)),
    },
    usage: [usage(`smoke-qwen3-base-t${t}-1`), usage(`smoke-qwen3-head-t${t}-1`)],
  };
  fs.writeFileSync(`${V}/wire-system-base-t${t}.md`, a.text);
  fs.writeFileSync(`${V}/wire-system-head-t${t}.md`, b.text);
}
console.log(JSON.stringify(res, null, 1));
