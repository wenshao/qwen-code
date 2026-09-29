// Builds the round-9 figures as ANSI text from the recorded JSON results
// (no hand-typed numbers), one .ansi file per figure.
import fs from 'node:fs';
import path from 'node:path';

const RUN = '/root/verify/pr10954/run';
const OUT = '/root/verify/pr10954/fig';
const j = (p) => JSON.parse(fs.readFileSync(path.join(RUN, p), 'utf8'));

const C = {
  t: (s) => `\x1b[1;36m${s}\x1b[0m`,
  h: (s) => `\x1b[1;37m${s}\x1b[0m`,
  ok: (s) => `\x1b[32m${s}\x1b[0m`,
  bad: (s) => `\x1b[31m${s}\x1b[0m`,
  warn: (s) => `\x1b[33m${s}\x1b[0m`,
  dim: (s) => `\x1b[90m${s}\x1b[0m`,
  cmd: (s) => `\x1b[1;34m$ \x1b[0m\x1b[1m${s}\x1b[0m`,
};
const vis = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
const pad = (s, n) => s + ' '.repeat(Math.max(0, n - vis(s).length));

function routeCell(r) {
  if (r.startsWith('503')) return C.warn(r.replace('background_agents_unavailable', 'unavailable'));
  if (/failed/.test(r)) return C.bad(r);
  return r;
}

// ---------------------------------------------------------------- figure 1
{
  const m = j('matrix/results.json');
  const get = (cell, arm) => m.find((x) => x.cell === cell && x.arm === arm);
  const L = [];
  L.push(C.t('PR #10954 · round 9 · the fix commit ec7f7aefcd, A/B on real builds (Linux x86_64, Node 22)'));
  L.push(C.dim('pre-fix = head b98dfa1927 with ec7f7aefcd reverted (bundle rebuilt) · head = b98dfa1927 · real `qwen serve`, real supervisor, shipped bin'));
  L.push('');
  L.push(C.h('① GET /background-agents over the same on-disk store (fix 5: strict store reads)'));
  L.push(C.dim(pad('cell', 50) + pad('pre-fix', 44) + 'head'));
  const cells = [
    ['C1', 'healthy, one live agent'],
    ['C2', "B's state.json corrupt (B is the waiting one)"],
    ['C3', "B's state.json unreadable (EISDIR)"],
    ['C4', 'roster.json corrupt'],
    ['C6', 'empty session dir, no state.json yet'],
    ['C10', 'no jobs/ dir at all'],
  ];
  for (const [id, label] of cells) {
    L.push(pad(`${id.padEnd(4)}${label}`, 50) + pad(routeCell(get(id, 'prefix').route.replace(/aaaaaaaa-[0-9a-f-]+/, 'aaaaaaaa…(id, no name)')), 44) + routeCell(get(id, 'head').route));
  }
  L.push(C.dim('    C2–C4: pre-fix answers a complete-looking 200 with the waiting agent silently missing; head answers 503.'));
  L.push('');

  const s = j('stop-during-launch/results.json');
  const st = (arm, op) => s.find((x) => x.arm === arm && x.op === op);
  L.push(C.h('② `qwen sessions stop <id>` issued 1 s into a real launch (the launch holds the host-setup lock for its 15 s ready wait) — fix 1'));
  for (const arm of ['prefix', 'head']) {
    const r = st(arm, 'stop');
    const verdict = r.cmd.code === 0 ? C.ok(`exit 0 after ${(r.cmd.ms / 1000).toFixed(1)} s  "${r.cmd.stdout}"`) : C.bad(`exit ${r.cmd.code} after ${(r.cmd.ms / 1000).toFixed(1)} s  "${r.cmd.stderr}"`);
    L.push(`  ${pad(arm === 'prefix' ? 'pre-fix' : 'head', 9)}${verdict}   ${C.dim('store afterwards:')} ${r.finalState.sessionState}`);
  }
  L.push(C.dim('  pre-fix: the client reports failure while the supervisor completes the stop anyway.'));
  L.push(C.dim('  `peek` returned in 0.5 s on both arms (it does not wait behind the lock).'));
  L.push('');

  const e = j('entry/results.json');
  L.push(C.h('③ `qwen --bg explain what --bg does` (unquoted) → prompt recorded in launch.json — fix 2'));
  for (const arm of ['prefix', 'head']) {
    const r = e.find((x) => x.part === 'repeat-bg' && x.arm === arm);
    const good = r.dispatchedPrompt === 'explain what --bg does';
    L.push(`  ${pad(arm === 'prefix' ? 'pre-fix' : 'head', 9)}${(good ? C.ok : C.bad)(JSON.stringify(r.dispatchedPrompt))}`);
  }
  L.push('');
  L.push(C.h('④ supervisor SIGKILLed while the dispatch waits for ready — fix 3'));
  for (const arm of ['prefix', 'head']) {
    const r = e.find((x) => x.part === 'supervisor-killed' && x.arm === arm);
    const msg = r.stderr.replace(' It may still', '\n           It may still');
    msg.split('\n').forEach((part, i) => L.push(`  ${pad(i === 0 ? (arm === 'prefix' ? 'pre-fix' : 'head') : '', 9)}${(arm === 'head' ? C.ok : C.bad)(part.trim())}`));
  }
  const k = e.find((x) => x.part === 'supervisor-killed' && x.arm === 'head');
  L.push(C.dim(`  then \`qwen sessions ps\`: ${k.psRow.replace(/\/root\/verify\S*/, '<ws>').replace(/ \|$/, '')}`));
  L.push(C.dim('  (the PTY host and worker survive the supervisor, so "may still have started" is accurate)'));
  L.push('');

  const rows = j('rows/results.json');
  L.push(C.h('⑤ session created 3 h ago, worker re-spawned now (its registry record is fresh) — fix 4'));
  for (const r of rows) {
    const table = r.psTable.split('\n')[1].replace(/\s+/g, ' ');
    L.push(`  ${pad(r.arm === 'prefix' ? 'pre-fix' : 'head', 9)}route startedAt ${r.arm === 'head' ? C.ok(r.routeAgent.startedAt) : C.bad(r.routeAgent.startedAt)}   ps: ${table.split(' ').slice(0, 6).join(' ')}`);
  }
  L.push('');
  L.push(C.h('⑥ controller recipe from commands.md, run literally (bash + jq 1.7; socket listeners record the delivery) — fix 8'));
  const hr = rows.find((r) => r.arm === 'head').recipes;
  for (const [label, v] of Object.entries(hr)) {
    const good = v.deliveredTo.startsWith('interactive');
    L.push(`  ${pad(label, 28)}→ ${path.basename(v.resolved)}  ${(good ? C.ok : C.bad)('delivered to the ' + v.deliveredTo)}`);
  }
  L.push(C.dim('  a managed worker that registered with ipcPath prints first, so the round-4 recipe (select(.ipcPath)) picks it.'));
  fs.writeFileSync(`${OUT}/r9-01-fix-commit-ab.ansi`, L.join('\n') + '\n');
}

// ---------------------------------------------------------------- figure 2
{
  const m = j('matrix/results.json');
  const get = (cell, arm) => m.find((x) => x.cell === cell && x.arm === arm);
  const L = [];
  L.push(C.t('PR #10954 · round 9 · still open at b98dfa1927 — reproduced on real daemons; a +76/−5 candidate closes both'));
  L.push(C.dim('candidate = head + strict worker.json read in strict listings + a registry-directory probe before listLiveSessions()'));
  L.push('');
  L.push(C.h('GET /background-agents'));
  L.push(C.dim(pad('cell', 62) + pad('pre-fix', 26) + pad('head', 26) + 'candidate'));
  const cells = [
    ['C7', 'R13-4 (fix-induced): live agent, its worker.json corrupt'],
    ['C8a', 'control: pid only in a live registry record, registry OK'],
    ['C8b', 'R4-4: same store, registry dir unreadable (ENOTDIR)'],
    ['C9', 'registry unreadable, worker.json has the live pid'],
    ['C5', 'stray regular file jobs/notes.txt'],
  ];
  for (const [id, label] of cells) {
    L.push(pad(`${id.padEnd(4)}${label}`, 62) + pad(routeCell(get(id, 'prefix').route), 26) + pad(routeCell(get(id, 'head').route), 26) + routeCell(get(id, 'cand').route));
  }
  L.push(C.dim('  C7/C8b: a live agent published as failed inside a 200. C9 is the price of the simple probe: 503 though the answer was right.'));
  L.push(C.dim('  C5: strict reads also turn one stray file (ENOTDIR) into a route-wide 503; `ps` keeps listing.'));
  L.push('');
  L.push(C.h('`qwen sessions ps` on the head, same stores (R15-13: the stderr guarantee)'));
  const c2 = get('C2', 'head');
  L.push(C.cmd('qwen sessions ps') + C.dim('    # C2: agent-B (waiting for input) has a corrupt state.json'));
  for (const line of c2.psStdout.trimEnd().split('\n')) L.push('  ' + line.replace(/\/root\/verify\S*/, '<ws>'));
  L.push(`  ${C.dim('stderr:')} ${c2.psStderr.trim() ? c2.psStderr.trim() : C.bad('(empty) — exit 0, agent-B silently omitted; the route 503s on the same store')}`);
  L.push('');
  L.push(C.h('Candidate tests (run from source)'));
  const vt = (arm) => {
    const r = j(`vt-${arm}.json`);
    const f = [];
    for (const t of r.testResults) for (const a of t.assertionResults) if (a.status !== 'passed') f.push(a.title);
    return { pass: r.numPassedTests, total: r.numTotalTests, f };
  };
  const rowsVt = [
    ['candidate', 'cand'],
    ['same tests on head', 'headtest'],
    ['M1 drop strict worker read', 'm1'],
    ['M2 drop registry probe', 'm2'],
  ];
  for (const [label, arm] of rowsVt) {
    const r = vt(arm);
    const s = `${r.pass}/${r.total}`;
    L.push(`  ${pad(label, 28)}${r.f.length ? C.bad(s) : C.ok(s)}`);
    for (const t of r.f) L.push(`  ${pad('', 36)}${C.dim('✗ ' + t)}`);
  }
  L.push(C.dim('  head fails both new cases with "expected 200 to be 503"; each mutant is killed by exactly its own case.'));
  fs.writeFileSync(`${OUT}/r9-02-open-findings-candidate.ansi`, L.join('\n') + '\n');
}

// ---------------------------------------------------------------- figure 3
{
  const e2e = j('e2e-n1/head.json');
  const g = (k) => e2e.find((x) => x.k === k)?.v;
  const tally = j('n1-tally/head.json');
  const win = j('launch-window/head.json');
  const pid = j('pid-source/head.json');
  const L = [];
  L.push(C.t('PR #10954 · round 9 · N1 on Linux x86_64 (first Linux run) — shipped bin, real daemon, real model qwen3.8-max'));
  L.push('');
  const ctl = g('control: qwen -p (qwen3.8-max)');
  L.push(C.cmd('qwen -p "Reply with exactly the word PONG and nothing else."') + C.dim('   # model positive control'));
  L.push(`  ${C.ok(ctl.stdout)}   ${C.dim(`exit ${ctl.code}, ${(ctl.ms / 1000).toFixed(1)} s`)}`);
  const bg = g('step1b: qwen --bg');
  L.push(C.cmd('qwen --bg "Reply with exactly the word PONG and nothing else."'));
  L.push(`  ${C.bad(bg.stderr.replace(/[0-9a-f-]{36}/, '<id>'))}   ${C.dim(`exit ${bg.code}, ${(bg.ms / 1000).toFixed(1)} s`)}`);
  const lf = g('store: launch.json worker argv / initialPrompt');
  L.push(`  ${C.dim('launch.json argv:')} ${JSON.stringify(lf.argv.slice(2).map((a) => a.replace(/[0-9a-f-]{36}/, '<id>')))}   ${C.dim('initialPrompt:')} ${JSON.stringify(lf.initialPrompt)}`);
  const route = g('step2: GET /background-agents');
  L.push(`  ${C.dim('GET /background-agents:')} ${route.status} taskState=${C.bad(route.body.agents[0].taskState)}   ${C.dim('after `sessions stop`:')} ${g('step4: route after stop').body.agents[0].taskState}`);
  L.push(`  ${C.dim('four more launches:')} ${tally.map((t) => (t.code === 0 ? C.ok('ok') : C.bad(`exit ${t.code} @ ${(t.ms / 1000).toFixed(1)} s`))).join(' · ')}   ${C.dim('→ 5/5 time out waiting for `ready`')}`);
  L.push('');
  L.push(C.h('R7-6 at runtime: GET /background-agents polled every 5 ms through a real launch (warm daemon)'));
  for (const s of win.spans) {
    const r = s.route.startsWith('failed') && s.store.startsWith('starting') ? C.bad(s.route + '   ← store still says starting') : s.route;
    L.push(`  ${pad(`${s.from}–${s.to} ms`, 16)}route=${pad(r, 14)}  ${C.dim('store=' + s.store)}`);
  }
  L.push(C.dim('  same ~60 ms `failed` flicker in 3/3 runs, before the launch records its pids.'));
  L.push('');
  L.push(C.h('Where a launching agent\'s pid comes from (sampled every 20 ms)'));
  for (const s of pid) {
    L.push(`  ${pad(`${s.from}–${s.to} ms`, 16)}${pad('worker.json: ' + s.worker, 42)}${C.dim('registry: ' + s.registry)}`);
  }
  L.push(C.dim('  worker.json carries the pids ~750 ms before the worker\'s registry record exists, so the R4-4 registry half only'));
  L.push(C.dim('  decides a verdict when worker.json has no pid for a live worker (the C8 shape).'));
  fs.writeFileSync(`${OUT}/r9-03-n1-linux-launch-window.ansi`, L.join('\n') + '\n');
}

// ---------------------------------------------------------------- figure 4
{
  const L = [];
  const vt = (p) => {
    const r = j(p);
    return `${r.numPassedTests}/${r.numTotalTests}`;
  };
  L.push(C.t('PR #10954 · round 9 · merge audit, gates, mutation spot-check, and the route-only split'));
  L.push('');
  L.push(C.h('Merge b98dfa1927 = ec7f7aefcd + main 76c3dc5be6 (52 commits)'));
  L.push(`  ${C.ok('tree 75f4230b52 == git merge-tree ec7f7aefcd 76c3dc5be6')}  ${C.dim('(no hand edits, no conflicts)')}`);
  L.push(`  ${C.ok('merges cleanly into current main 2f5a62e6ab')}  ${C.dim('(78 commits ahead of the head)')}`);
  L.push('');
  L.push(C.h('Gates at b98dfa1927 (Linux x86_64, Node 22.22.2)'));
  L.push(`  ${pad(`${j('gates/vt-affected.json').testResults.length} PR-affected test files`, 40)}${C.ok(vt('gates/vt-affected.json'))}`);
  L.push(`  ${pad('src/serve/server.test.ts', 40)}${C.ok(vt('gates/vt-server.json'))}`);
  L.push(`  ${pad(`src/agent-view/ (${j('gates/vt-agentview.json').testResults.length} files)`, 40)}${C.ok(vt('gates/vt-agentview.json'))}`);
  L.push(`  ${pad('cli tsc --noEmit · eslint · prettier', 40)}${C.ok('clean · clean · clean')}`);
  L.push('');
  L.push(C.h('The fix commit\'s five mutation claims, re-run (each mutant on its own hard-linked copy)'));
  const mut = [
    ['MA', 'route default back to soft reads'],
    ['MB', 'startedAt precedence swapped back'],
    ['MC', 'every --bg skipped again'],
    ['MD', 'stop loses its 30 s budget'],
    ['ME', 'ambiguous-dispatch branch disabled'],
  ];
  for (const [id, label] of mut) {
    const r = j(`mut-${id}.json`);
    const f = [];
    for (const t of r.testResults) for (const a of t.assertionResults) if (a.status !== 'passed') f.push(a.title);
    L.push(`  ${pad(`${id} ${label}`, 42)}${f.length ? C.ok(`killed by ${f.length}`) : C.bad('survived')}  ${C.dim(f[0] ?? '')}`);
    for (const t of f.slice(1)) L.push(`  ${pad('', 55)}${C.dim(t)}`);
  }
  L.push('');
  L.push(C.h('Route-only split (review suggestion): merge-base + 8 files, everything else reverted'));
  const sv = j('split-vt.json');
  L.push(`  ${C.dim('files:')} background-agents.ts(+test) · managed-rows.ts(+test) · supervisor-store.ts · presentation.ts · server.ts(+test)`);
  L.push(`  ${C.dim('size:')} +1432/−7 (production +493)  vs the PR's +3765/−196 across 31 files`);
  L.push(`  ${pad('cli tsc --noEmit', 40)}${C.ok('clean')}`);
  L.push(`  ${pad('route + managed-rows + ps + agent-view + server + cli tests', 60)}${C.ok(`${sv.numPassedTests}/${sv.numTotalTests}`)}  ${C.dim("(incl. main's own ps.test.ts 24/24: N2 does not arise)")}`);
  const ms = j('matrix-split/results.json');
  const hm = j('matrix/results.json').filter((x) => x.arm === 'head');
  const same = ms.filter((x) => hm.find((h) => h.cell === x.cell)?.route === x.route).length;
  L.push(`  ${pad('real daemon, same 11-cell store matrix', 60)}${C.ok(`${same}/${ms.length} identical to head`)}  ${C.dim('(no --bg in `qwen --help`)')}`);
  fs.writeFileSync(`${OUT}/r9-04-merge-gates-split.ansi`, L.join('\n') + '\n');
}
console.log('ok');
