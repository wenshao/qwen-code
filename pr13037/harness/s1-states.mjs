// s1: result-state matrix through the real path:
// public REST create -> public Turn -> Hosted Harness -> Broker -> worker -> real Shell
// -> O2 publication (OSS double) -> receipt -> O3 projection -> public API reads.
// usage: LABEL=<name> [ONLY=a,b] node s1-states.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import * as L from './lib.mjs';

const LABEL = process.env.LABEL ?? 's1';
const BASE_WS = Number(process.env.WS_BASE ?? 2);
L.openLog(LABEL);
const gen = (tag, so, se, code) => `${L.NODE22} ${L.R}/gen.mjs ${tag} ${so} ${se} ${code}`;
const MiB = 1024 * 1024;

// expected: stdout/stderr bytes produced by running the same command locally (deterministic commands only)
const cases = [
  { name: 'ok', cmd: 'echo hello-o3; echo warn-o3 >&2', expect: true },
  { name: 'exit3', cmd: 'echo out-line; echo err-line >&2; exit 3', expect: true },
  { name: 'empty', cmd: 'true', expect: true },
  { name: 'notstarted', cmd: 'sleep 3; echo never-ran > never.txt' },
  { name: 'partial', cmd: gen('partial', 3 * MiB, 0, 0), capture: MiB },
  { name: 'binary', cmd: gen('binary', 200000, 4096, 0), expect: true },
  { name: 'ansi', cmd: `printf '\\033[32mPASS\\033[0m test-a\\n\\033[31mFAIL\\033[0m test-b\\n'; printf 'progress 10%%\\rprogress 50%%\\rprogress 100%%\\n'; printf 'crlf-line\\r\\n'`, expect: true },
  { name: 'multi', cmd: gen('multi', 40 * MiB, MiB, 7), expect: true },
  { name: 'seq2', prompt: (c) => `Two commands [O3_SH2:${L.b64('echo first-call')}:${L.b64('echo second-call; echo second-err >&2')}]`, results: 2 },
  { name: 'par2', prompt: (c) => `Parallel commands [O3_PAR:${L.b64('echo par-a')}:${L.b64('echo par-b')}]`, results: 2 },
  { name: 'cjk', cmd: `${L.NODE22} -e "for(let i=0;i<9000;i++)console.log(String(i).padStart(5,'0')+' 构建日志：第'+i+'行，编译模块完成 ✓')"`, expect: true },
];
const only = process.env.ONLY?.split(',');
const summary = [];

for (const [index, c] of cases.entries()) {
  if (only && !only.includes(c.name)) continue;
  const n = String(BASE_WS + index).padStart(2, '0');
  const ws = `ws-${LABEL}-${c.name}`;
  L.register(ws, `st-s${n}`);
  fs.writeFileSync(`${L.R}/run/tap-mode.json`, JSON.stringify({ shell: true, capture: c.capture ?? 2 * 1024 * MiB }));
  const prompt = c.prompt ? c.prompt(c) : L.shellPrompt(`Case ${c.name}`, c.cmd);
  const t0 = Date.now();
  const session = await L.createShellSession(ws, prompt);
  const turn = await L.waitTurn(session, { timeoutMs: 300_000 });
  const tTurn = Date.now() - t0;
  const proj = await L.waitProjection(session, { timeoutMs: 90_000, count: c.results ?? 1 });
  const row = { case: c.name, session, turn: turn.status, turnError: turn.error, turnMs: tTurn, projMs: Date.now() - t0, results: [] };
  L.say(c.name, { session, turn: turn.status, error: turn.error, turnMs: tTurn, sources: proj.rows.map((r) => `${r.state}${r.failure ? '/' + r.failure : ''}`) });
  let expected;
  if (c.expect) {
    const dir = fs.mkdtempSync(`${L.R}/run/exp-`);
    const so = `${dir}/so`;
    const se = `${dir}/se`;
    try {
      execFileSync('/bin/bash', ['-c', `(${c.cmd}) > ${so} 2> ${se}`], { cwd: dir });
    } catch {
      /* non-zero exit is expected for some cases */
    }
    expected = { stdout: fs.readFileSync(so), stderr: fs.readFileSync(se) };
  }
  for (const r of proj.rows) {
    if (r.state !== 'READY') {
      row.results.push({ state: r.state, failure: r.failure });
      continue;
    }
    const detail = await L.api('GET', `/v1/agents/sessions/${session}/items/${r.itemId}/tool-result`);
    const d = detail.json.result ?? {};
    const entry = {
      state: r.state,
      execution: d.execution_status,
      capture: d.capture_status,
      delivery: d.delivery_status,
      reason: d.reason_code ?? null,
      scope: d.capture_scope,
      upstreamTruncated: d.upstream_truncated,
      preview: d.preview ? { bytes: Buffer.byteLength(d.preview.text), truncated: d.preview.truncated, stream: d.preview.stream_id, head: d.preview.text.slice(0, 60) } : null,
      canRead: detail.json.access?.can_read_content,
      artifacts: [],
    };
    for (const a of d.artifacts ?? []) {
      const full = await L.content(session, a.id, { revision: a.revision });
      const got = L.sha256(full.body);
      const art = { role: a.stream_role, bytes: a.byte_length, status: full.status, shaMatchesMetadata: got === a.sha256, lengthMatches: full.body.length === a.byte_length };
      if (expected) {
        art.matchesLocalRun = Buffer.compare(full.body, expected[a.stream_role]) === 0;
        art.localBytes = expected[a.stream_role].length;
      }
      entry.artifacts.push(art);
    }
    row.results.push(entry);
    L.say(`  ${c.name}`, entry);
  }
  const ev = await L.events(session);
  row.events = ev.map((e) => e.type);
  row.resultEvents = ev.filter((e) => e.type === 'item.tool_result.updated').length;
  row.afterCompleted = ev.findIndex((e) => e.type === 'item.tool_result.updated') > ev.findIndex((e) => e.type === 'turn.completed');
  L.say(`  ${c.name} events`, `${row.events.join(' ')}`);
  summary.push(row);
}
fs.writeFileSync(`${L.R}/run/tap-mode.json`, JSON.stringify({ shell: true, capture: 2 * 1024 * MiB }));
L.out(`${LABEL}.json`, summary);
L.say('done', `${summary.length} cases`);
