// Summarise runs/<family>/<task>/<arm>-<rep>/out.jsonl into per-run records + per-cell stats.
import fs from 'node:fs';
import path from 'node:path';

const R = '/Users/wenshao/git/v12546/runs';
const READ_SHELL = /^\s*(cat|ls|head|tail|find|grep|rg|wc|sed -n|tree)\b/;
const recs = [];
for (const fam of fs.readdirSync(R)) {
  for (const task of fs.readdirSync(path.join(R, fam))) {
    for (const run of fs.readdirSync(path.join(R, fam, task))) {
      const d = path.join(R, fam, task, run);
      const [arm, rep] = run.split('-');
      let lines = [];
      try {
        lines = fs.readFileSync(path.join(d, 'out.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      } catch {}
      const tools = [];
      let result = null, isError = null, usage = null;
      for (const ev of lines) {
        if (ev.type === 'assistant') {
          for (const b of ev.message?.content ?? []) if (b.type === 'tool_use') tools.push({ name: b.name, input: b.input });
        }
        if (ev.type === 'result') { result = ev.result ?? ''; isError = ev.is_error; usage = ev.usage; }
      }
      const shell = tools.filter((t) => t.name === 'run_shell_command').map((t) => String(t.input?.command ?? ''));
      recs.push({
        fam, task, arm, rep: +rep,
        ok: result !== null && !isError,
        tools: tools.map((t) => t.name),
        shell,
        readShell: shell.filter((c) => READ_SHELL.test(c)).length,
        agentCalls: tools.filter((t) => t.name === 'agent' || t.name === 'task').length,
        ranTest: shell.some((c) => /npm (test|run check)|node --test/.test(c)),
        ranLint: shell.some((c) => /npm run (lint|check)/.test(c)),
        edited: tools.some((t) => ['edit', 'write_file', 'replace'].includes(t.name)),
        result: result ?? '',
        len: (result ?? '').length,
        inputTokens: usage?.input_tokens ?? null,
      });
    }
  }
}
fs.writeFileSync('/Users/wenshao/git/v12546/runs.json', JSON.stringify(recs, null, 1));
const cells = {};
for (const r of recs) (cells[`${r.fam}|${r.task}|${r.arm}`] ??= []).push(r);
const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);
console.log('fam|task|arm'.padEnd(28), 'n ok readShell agent ranTest ranLint edited avgLen');
for (const k of Object.keys(cells).sort()) {
  const a = cells[k];
  console.log(k.padEnd(28), a.length, sum(a, (r) => r.ok), sum(a, (r) => r.readShell), sum(a, (r) => r.agentCalls), sum(a, (r) => r.ranTest), sum(a, (r) => r.ranLint), sum(a, (r) => r.edited), Math.round(sum(a, (r) => r.len) / a.length));
}
