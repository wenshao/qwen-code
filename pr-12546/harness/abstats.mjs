import fs from 'node:fs'; import path from 'node:path';
const R = '/root/verify/pr12546-rig/runs';
const SEARCHY = /(^|[;&|]\s*|\$\(\s*)(cat|grep|rg|find|ls|head|tail|wc|sed|awk|tree|xargs)\b/;
const rows = [];
for (const task of ['todo','check','export','callers']) {
  for (const d of fs.readdirSync(path.join(R, task))) {
    const [arm, rep] = d.split('-');
    const lines = fs.readFileSync(path.join(R, task, d, 'out.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean);
    const calls = [];
    for (const ev of lines) if (ev.type === 'assistant') for (const c of ev.message?.content ?? []) if (c.type === 'tool_use') {
      let name = c.name, input = c.input ?? {};
      if (name === 'tool_call') { name = input.name ?? input.tool_name ?? name; input = input.arguments ?? input.args ?? input.params ?? input; }
      calls.push({ name, input });
    }
    const res = lines.find(e => e.type === 'result');
    const shell = calls.filter(c => c.name === 'run_shell_command');
    const shellSearch = shell.filter(c => SEARCHY.test(String(c.input.command ?? '')));
    const dedicated = calls.filter(c => ['read_file','grep_search','glob','list_directory'].includes(c.name));
    const text = res?.result ?? '';
    rows.push({ task, arm, rep: +rep, ok: res?.subtype === 'success', calls: calls.length, shell: shell.length, shellSearch: shellSearch.length, dedicated: dedicated.length,
      agent: calls.filter(c => c.name === 'agent').length, words: text.split(/\s+/).filter(Boolean).length, first: text.split('\n')[0].slice(0, 90),
      shellCmds: shell.map(c => String(c.input.command).slice(0, 80)), turns: res?.num_turns, inTok: res?.usage?.input_tokens });
  }
}
fs.writeFileSync('/root/verify/pr12546-rig/abstats.json', JSON.stringify(rows, null, 1));
const agg = {};
for (const r of rows) { const k = `${r.task}/${r.arm}`; const a = agg[k] ??= { n: 0, ok: 0, calls: 0, shell: 0, shellSearch: 0, runsWithShellSearch: 0, dedicated: 0, agent: 0, words: [], inTok: 0 };
  a.n++; a.ok += r.ok; a.calls += r.calls; a.shell += r.shell; a.shellSearch += r.shellSearch; a.runsWithShellSearch += r.shellSearch > 0; a.dedicated += r.dedicated; a.agent += r.agent; a.words.push(r.words); a.inTok += r.inTok ?? 0; }
for (const [k, a] of Object.entries(agg)) { const w = a.words.sort((x, y) => x - y); console.log(k.padEnd(16), `n=${a.n} ok=${a.ok} calls=${a.calls} dedicated=${a.dedicated} shell=${a.shell} shellSearch=${a.shellSearch} runsWithShellSearch=${a.runsWithShellSearch}/${a.n} agent=${a.agent} words median=${w[Math.floor(w.length/2)]} [${w.join(',')}] inTok/run=${Math.round(a.inTok/a.n)}`); }
