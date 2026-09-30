// s4: sessions used by the browser scenarios (text logs of known size).
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import * as L from './lib.mjs';
const LABEL = process.env.LABEL ?? 's4';
L.openLog(LABEL);
const lg = (n, e = 0, c = 0) => `${L.NODE22} ${L.R}/loggen.mjs ${n} ${e} ${c}`;
const cases = [
  { name: 'biglog', ws: '21', cmd: lg(157286, 3, 2) },        // 12,582,880 B stdout, exit 2
  { name: 'log100', ws: '22', cmd: lg(1310720, 0, 0) },       // 104,857,600 B stdout
];
const only = process.env.ONLY?.split(',');
const file = `${L.R}/out/${LABEL}.json`;
const out = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
for (const c of cases) {
  if (only && !only.includes(c.name)) continue;
  L.register(`ws-${LABEL}-${c.name}`, `st-s${c.ws}`);
  const t0 = Date.now();
  const session = await L.createShellSession(`ws-${LABEL}-${c.name}`, L.shellPrompt(`Build log ${c.name}`, c.cmd));
  const turn = await L.waitTurn(session, { timeoutMs: 900_000 });
  const tTurn = Date.now() - t0;
  const proj = await L.waitProjection(session, { timeoutMs: 300_000 });
  const arts = (await L.api('GET', `/v1/agents/sessions/${session}/artifacts`)).json.data?.map((e) => e.artifact) ?? [];
  const local = execFileSync('/bin/bash', ['-c', `${c.cmd} 2>/dev/null | shasum -a 256 | cut -d' ' -f1; true`], { encoding: 'utf8', maxBuffer: 1 << 20 }).trim();
  const so = arts.find((a) => a.stream_role === 'stdout');
  const row = { case: c.name, session, turn: turn.status, turnMs: tTurn, projectedMs: Date.now() - t0, state: proj.rows.map((r) => r.state), stdout: so && { id: so.id, bytes: so.byte_length, sha256: so.sha256, matchesLocalRun: so.sha256 === local } };
  L.say(c.name, row);
  out.push(row);
}
fs.writeFileSync(file, JSON.stringify(out, null, 2));
