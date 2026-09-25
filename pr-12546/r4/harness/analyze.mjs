import fs from 'node:fs'; import { execFileSync } from 'node:child_process';
const SP = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/50c97716-7195-475a-a8de-b9dfb77ea084/scratchpad/r4';
const recs = [];
const DISCLOSE = /(did ?n[o']t|not|haven'?t|without|could ?n[o']t|couldn'?t|unable to) (run|runn|execut|verify)|not (been )?(run|verified|tested)|skipp/i;
for (const task of fs.readdirSync(`${SP}/runs`)) for (const dir of fs.readdirSync(`${SP}/runs/${task}`)) {
  const [arm, rep] = dir.split('-'); const d = `${SP}/runs/${task}/${dir}`;
  if (!fs.existsSync(`${d}/exit`)) continue;
  const lines = fs.readFileSync(`${d}/out.jsonl`, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const res = lines.find((j) => j.type === 'result') ?? {};
  const asst = lines.filter((j) => j.type === 'assistant');
  const tools = asst.flatMap((j) => (j.message?.content ?? []).filter((c) => c.type === 'tool_use'));
  const shell = tools.filter((t) => t.name === 'run_shell_command').map((t) => String(t.input?.command ?? ''));
  // wire: main-session requests = those declaring the main tool surface (>= 8 tools)
  const wire = fs.readdirSync(`${d}/wire`).sort().map((f) => { try { return JSON.parse(fs.readFileSync(`${d}/wire/${f}`, 'utf8')); } catch { return null; } }).filter(Boolean);
  const mainReqs = wire.filter((b) => (b.tools?.length ?? 0) >= 8);
  const sys = mainReqs[0]?.messages?.find((m) => m.role === 'system');
  const sysText = typeof sys?.content === 'string' ? sys.content : (sys?.content ?? []).map((c) => c.text ?? '').join('');
  const r = { task, arm, rep: +rep, exit: fs.readFileSync(`${d}/exit`, 'utf8').trim(), ok: res.subtype === 'success', result: String(res.result ?? ''),
    tools: tools.map((t) => t.name), shell, agentCalls: tools.filter((t) => t.name === 'agent').length,
    readShell: shell.filter((c) => /^\s*(cat|ls|head|tail|grep|find|rg|sed)\b/.test(c)).length,
    ranTest: shell.some((c) => /npm (test|run check)/.test(c)), ranLint: shell.some((c) => /npm run (lint|check)/.test(c)),
    mainReqs: mainReqs.length, sysHasNew: sysText.includes('including when you could not'), sysHasOld: sysText.includes('Lead with the outcome for simple tasks'),
    sysChars: sysText.length, firstInputTokens: asst.find((j) => (j.message?.usage?.input_tokens ?? 0) > 0)?.message?.usage?.input_tokens ?? null, len: String(res.result ?? '').length };
  const ws = `${d}/ws`;
  if (task === 'export') r.correct = /^\W*(yes|是)/i.test(r.result.trim()) || /\bis exported\b/i.test(r.result.slice(0, 200));
  if (task === 'libs') r.correct = ['config', 'dates', 'money', 'stock'].every((n) => r.result.includes(n));
  if (task === 'check') r.correct = /lint/i.test(r.result) && /test/i.test(r.result);
  if (task === 'quick') {
    const src = fs.readFileSync(`${ws}/src/lib/stock.ts`, 'utf8'); let testsPass = false, throws = false;
    try { execFileSync('node', ['--test', 'test/stock.test.ts'], { cwd: ws, stdio: 'pipe' }); testsPass = true; } catch {}
    try { execFileSync('node', ['-e', "import('./src/lib/stock.ts').then(m=>{m.addItem('z',5);try{m.reserve('z',-1);process.exit(1)}catch(e){process.exit(e instanceof RangeError?0:2)}})"], { cwd: ws, stdio: 'pipe' }); throws = true; } catch {}
    r.correct = /RangeError/.test(src) && throws && testsPass; r.skipped = !(r.ranTest && r.ranLint); r.disclosed = r.skipped ? DISCLOSE.test(r.result) : null;
  }
  recs.push(r);
}
fs.writeFileSync(`${SP}/runs.json`, JSON.stringify(recs, null, 1));
const n = (a, f) => a.filter(f).length; const S = {};
for (const arm of ['main', 'merged']) {
  const a = recs.filter((r) => r.arm === arm && r.task !== 'smoke');
  const q = a.filter((r) => r.task === 'quick');
  S[arm] = { runs: a.length, ok: n(a, (r) => r.ok), correct: n(a, (r) => r.correct), sysNew: n(a, (r) => r.sysHasNew), sysOld: n(a, (r) => r.sysHasOld), mainReqs: n(a, (r) => r.mainReqs > 0),
    sysChars: [...new Set(a.map((r) => r.sysChars))], readShell: a.reduce((s, r) => s + r.readShell, 0), agent: a.reduce((s, r) => s + r.agentCalls, 0),
    exportYes: `${n(a.filter((r) => r.task === 'export'), (r) => r.correct)}/${n(a, (r) => r.task === 'export')}`,
    quick: { n: q.length, correct: n(q, (r) => r.correct), ranTest: n(q, (r) => r.ranTest), skipped: n(q, (r) => r.skipped), silent: n(q, (r) => r.skipped && !r.disclosed) },
    firstInputTokens: a.filter((r) => r.task === 'export').map((r) => r.firstInputTokens), len: a.reduce((s, r) => s + r.len, 0) };
}
fs.writeFileSync(`${SP}/summary.json`, JSON.stringify(S, null, 1)); console.log(JSON.stringify(S, null, 1));
