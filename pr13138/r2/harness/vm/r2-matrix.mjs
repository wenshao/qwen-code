// Round 2 (head 52899c07): runbook smoke, the F1 fix, the four Critical findings of the bot review on b1cf9df3
// (R1-29 stray copy entry, R1-31 copy/source divergence, R1-30 .partial after SIGKILL, R1-32 timezone-dependent pin),
// and the single-connection change under a short MySQL wait_timeout. One populated storage, one fence, new UUIDs.
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import * as L from './lib.mjs';
import * as W from './w1b.mjs';
import * as P from './pop.mjs';
L.openLog('r2-matrix');
const { say } = L;
const ONLY = process.env.ONLY?.split(',');
const want = (id) => !ONLY || ONLY.includes(id);
say(L.hostFacts()); say(`   jar=${W.BUNDLE_JAR} cli=${W.CLI()}`);
const R = `${L.root('a')}/project`;
const results = {};
let fence; let revision;
const ids = () => W.members('a').map((m) => m.id);
const fresh = (name) => W.prepareBundle(`r2-${name}`, { sessions: ids() }).bundle;
const req = (bundle, extra = {}) => W.captureRequest({ fence, revision, bundle, ...extra });
const row = (op) => W.opRow(op);
const stderrLine = (r) => r.stderr.split('\n').find((l) => /^[a-z_]+: /.test(l)) ?? r.cause ?? '';
const drop = (b) => L.sh(`rm -rf ${b}`);

if (process.env.SKIP_POPULATE !== '1') {
  L.sh('bash /Users/wenshao/pr13138-rig/vm/o2-ctl.sh down; bash /Users/wenshao/pr13138-rig/vm/o2-ctl.sh up > /dev/null');
  await P.rollout(['a', 'b']);
  const rig = await L.startRig('r2');
  await P.populate(rig, { extraShell: ['mkdir -p gen && python3 -c "import os\nfor i in range(3000): open(f\'gen/f{i:05d}.txt\',\'w\').write(str(i))" && ls gen | wc -l'] });
  ({ fence, revision } = await P.offlineAndFence(rig));
  await rig.stop();
} else { const m = L.mountRow('a'); fence = m.operation; revision = m.revision; }
say(`   ${L.mstr(L.mountRow('a'))}; members=${ids().length}`);

// ---- A: runbook smoke on the new head
if (want('A')) {
  say('== A: capture / replay / verify / authority unchanged');
  const b = fresh('c0'); const c0 = req(b);
  const a0 = W.authoritySnapshot('r2-before');
  const c = await W.w1b('capture', c0, { oss: true, label: 'A-capture' });
  const c2 = await W.w1b('capture', c0, { oss: true, label: 'A-replay' });
  const v = await W.w1b('verify', W.verifyRequest(c0), { label: 'A-verify' });
  const a1 = W.authoritySnapshot('r2-after');
  results.A = { capture: W.summary(c), captureMs: c.ms, replayIdentical: c.stdout === c2.stdout, verify: W.summary(v), verifyMs: v.ms, authorityIdentical: a0.digest === a1.digest, tables: Object.keys(a0.tables).length, c0: c0.operationId, bundle: b };
  say(`   replay identical=${results.A.replayIdentical}; authority (${results.A.tables} tables) identical=${results.A.authorityIdentical}`);
  fs.writeFileSync(`${L.OUT}/r2-c0.json`, JSON.stringify(c0));
}

// ---- B: the F1 fix — unsupported entries already in the stopped tree
if (want('B')) {
  say('== B: unsupported entries in the stopped source');
  const CASES = [
    ['venv', 'python3 -m venv --without-pip .venv', `python3 -m venv --without-pip ${R}/.venv`, `rm -rf ${R}/.venv`],
    ['abs-link', 'absolute symlink to a file inside the root', `ln -s ${R}/notes.txt ${R}/abs-notes`, `rm -f ${R}/abs-notes`],
    ['dangling-link', 'relative symlink to a missing target', `ln -s dist/index.js ${R}/main-link`, `rm -f ${R}/main-link`],
    ['escaping-link', 'relative symlink leaving the root', `ln -s ../../../etc/hostname ${R}/host-link`, `rm -f ${R}/host-link`],
    ['enotdir-link', 'relative symlink through a regular file (notes.txt/child)', `ln -s notes.txt/child ${R}/enotdir-link`, `rm -f ${R}/enotdir-link`],
    ['hard-link', 'second hard link', `ln ${R}/data.bin ${R}/data-hard`, `rm -f ${R}/data-hard`],
    ['fifo', 'named pipe', `mkfifo ${R}/pipe`, `rm -f ${R}/pipe`],
    ['socket', 'unix socket left by a dev server', `/opt/qwen/node -e "require('net').createServer().listen('${R}/dev.sock',()=>process.exit(0))"`, `rm -f ${R}/dev.sock`],
    ['odd-name', 'FIFO whose name holds a quote, a newline and an ANSI escape', `/opt/qwen/node /Users/wenshao/pr13138-rig/vm/oddname.mjs add ${R}`, `/opt/qwen/node /Users/wenshao/pr13138-rig/vm/oddname.mjs del ${R}`],
  ];
  results.B = [];
  for (const [id, what, add, del] of CASES) {
    L.sh(add);
    const b = fresh(`b-${id}`); const q = req(b);
    const r = await W.w1b('capture', q, { oss: true, label: `B-${id}` });
    const o = row(q.operationId);
    const line = stderrLine(r);
    const retry = await W.w1b('capture', q, { oss: true, label: `B-${id}-same-uuid`, quiet: true });
    L.sh(del);
    results.B.push({ id, what, exit: r.code, ms: r.ms, state: o?.state, lastError: o?.error, stderr: line.slice(0, 220), sameUuidRetry: W.summary(retry).slice(0, 80) });
    say(`   ${id.padEnd(14)} ${r.code} ${o?.state}/${o?.error} ${r.ms} ms | ${line.slice(0, 160)} | same UUID: ${W.summary(retry).slice(0, 60)}`);
    drop(b);
  }
  const b = fresh('b-after'); const q = req(b);
  const r = await W.w1b('capture', q, { oss: true, label: 'B-new-uuid-after-removal' });
  results.Bafter = W.summary(r);
  say(`   all entries removed, new UUID: ${results.Bafter.slice(0, 120)}`);
  drop(b);
}

// ---- C: the bot's Critical findings on b1cf9df3
if (want('C29')) {
  say('== R1-29: a stray file only in the operator copy');
  const b = fresh('r129'); fs.writeFileSync(`${b}/workspace/project/.DS_Store`, 'x'); const q = req(b);
  const r = await W.w1b('capture', q, { oss: true, label: 'R1-29' }); const o = row(q.operationId);
  fs.rmSync(`${b}/workspace/project/.DS_Store`);
  const retry = await W.w1b('capture', q, { oss: true, label: 'R1-29-same-uuid-after-cleaning-copy' });
  results.R129 = { exit: r.code, state: o?.state, lastError: o?.error, stderr: stderrLine(r), retry: W.summary(retry) };
  say(`   ${o?.state}/${o?.error} | ${stderrLine(r).slice(0, 140)} | same UUID after removing the stray copy file: ${W.summary(retry).slice(0, 90)}`);
  drop(b);
}
if (want('C31')) {
  say('== R1-31a: a file missing from the operator copy');
  let b = fresh('r131a'); fs.rmSync(`${b}/workspace/project/notes.txt`); let q = req(b);
  let r = await W.w1b('capture', q, { oss: true, label: 'R1-31a' }); let o = row(q.operationId);
  const leaks = /\/srv\/w1b-bundles\//.test(r.stderr);
  L.sh(`cp -a ${L.root('a')}/project/notes.txt ${b}/workspace/project/notes.txt`);
  let retry = await W.w1b('capture', q, { oss: true, label: 'R1-31a-same-uuid-after-fixing-copy' });
  results.R131a = { exit: r.code, state: o?.state, lastError: o?.error, stderr: stderrLine(r), absolutePathOnStderr: leaks, retry: W.summary(retry) };
  say(`   ${o?.state}/${o?.error} | ${stderrLine(r).slice(0, 160)} | absolute bundle path on stderr=${leaks} | same UUID after restoring the copy: ${W.summary(retry).slice(0, 80)}`);
  drop(b);
  say('== R1-31b: a new file appears in the source after the copy was made');
  b = fresh('r131b'); fs.writeFileSync(`${R}/late-new.txt`, 'late'); q = req(b);
  r = await W.w1b('capture', q, { oss: true, label: 'R1-31b' }); o = row(q.operationId);
  fs.rmSync(`${R}/late-new.txt`);
  retry = await W.w1b('capture', q, { oss: true, label: 'R1-31b-same-uuid-after-removing-it' });
  results.R131b = { exit: r.code, state: o?.state, lastError: o?.error, stderr: stderrLine(r), retry: W.summary(retry) };
  say(`   ${o?.state}/${o?.error} | ${stderrLine(r).slice(0, 160)} | same UUID after the source file is gone again: ${W.summary(retry).slice(0, 80)}`);
  drop(b);
}
if (want('C30')) {
  say('== R1-30: SIGKILL while assets.ndjson is being published');
  const b = fresh('r130'); const q = req(b);
  const partial = `${b}/.w1-recovery/assets.ndjson.partial-${q.operationId}`;
  const pred = () => fs.existsSync(partial); pred.label = 'assets.ndjson.partial exists';
  const k = await W.w1b('capture', q, { oss: true, label: 'R1-30-killed', killWhen: pred });
  const left = fs.readdirSync(`${b}/.w1-recovery`);
  const r1 = await W.w1b('capture', q, { oss: true, label: 'R1-30-resume-1' });
  const r2 = await W.w1b('capture', q, { oss: true, label: 'R1-30-resume-2' });
  let manual = '-';
  if (r2.code !== 0) { for (const f of fs.readdirSync(`${b}/.w1-recovery`).filter((n) => n.includes('.partial-'))) fs.rmSync(`${b}/.w1-recovery/${f}`); manual = W.summary(await W.w1b('capture', q, { oss: true, label: 'R1-30-resume-after-deleting-partial' })); }
  results.R130 = { killed: k.killed, leftover: left, resume1: W.summary(r1), resume2: W.summary(r2), state: row(q.operationId)?.state, manual };
  say(`   [${k.killed}] leftover=${left.join(',')} | resume 1: ${W.summary(r1).slice(0, 70)} | resume 2: ${W.summary(r2).slice(0, 70)} | after deleting the .partial by hand: ${manual.slice(0, 70)}`);
  drop(b);
}
if (want('C32')) {
  say('== R1-32: timezone of the maintenance JVM');
  const c0 = JSON.parse(fs.readFileSync(`${L.OUT}/r2-c0.json`, 'utf8'));
  const leases = L.sql("SELECT session_id, writer_lease_until FROM qwen_managed_session_journal_head WHERE writer_lease_until IS NOT NULL ORDER BY session_id").length;
  say(`   journal heads with a non-null writer_lease_until: ${leases}`);
  const vUtc = await W.w1b('verify', W.verifyRequest(c0), { label: 'R1-32-verify-UTC', tz: 'UTC' });
  const vCst = await W.w1b('verify', W.verifyRequest(c0), { label: 'R1-32-verify-Asia-Shanghai', tz: 'Asia/Shanghai' });
  const vSys = await W.w1b('verify', W.verifyRequest(c0), { label: 'R1-32-verify-system-default', tz: null });
  results.R132verify = { utc: W.summary(vUtc), shanghai: W.summary(vCst), systemDefault: W.summary(vSys) };
  say(`   verify of the UTC-sealed C0: UTC -> ${W.summary(vUtc).match(/authorityCompatible=\w+/)?.[0]} | Asia/Shanghai -> ${W.summary(vCst).match(/authorityCompatible=\w+/)?.[0] ?? W.summary(vCst).slice(0, 60)} | system default (VM is CST) -> ${W.summary(vSys).match(/authorityCompatible=\w+/)?.[0] ?? W.summary(vSys).slice(0, 60)}`);
  for (const [label, resumeTz] of [['same-tz', 'UTC'], ['other-tz', 'Asia/Shanghai']]) {
    const b = fresh(`r132-${label}`); const q = req(b);
    const pred = () => Number(L.one(`SELECT COUNT(*) FROM managed_workspace_recovery_session WHERE operation_id='${q.operationId}' AND state='COMPLETE'`) ?? 0) >= 2; pred.label = '2 Sessions complete';
    const k = await W.w1b('capture', q, { oss: true, label: `R1-32-${label}-killed`, tz: 'UTC', killWhen: pred });
    const r = await W.w1b('capture', q, { oss: true, label: `R1-32-${label}-resume`, tz: resumeTz });
    const o = row(q.operationId);
    results[`R132${label}`] = { killed: k.killed, resumeTz, resume: W.summary(r), state: o?.state, lastError: o?.error };
    say(`   capture under UTC killed [${k.killed}], resumed under ${resumeTz}: ${o?.state}/${o?.error} ${W.summary(r).slice(0, 80)}`);
    drop(b);
  }
}

// ---- D: one physical connection for the whole run vs an idle-connection reaper
if (want('D')) {
  say('== D: MySQL wait_timeout shorter than an idle stretch (2 GiB file hashing with no RPC)');
  L.sh(`head -c 2G /dev/zero > ${R}/big.bin`);
  const b = fresh('d'); const q = req(b);
  L.sql('SET GLOBAL wait_timeout=2');
  let r; try { r = await W.w1b('capture', q, { oss: true, label: 'D-wait-timeout-2s' }); } finally { L.sql('SET GLOBAL wait_timeout=28800'); }
  const o = row(q.operationId);
  const r2 = await W.w1b('capture', q, { oss: true, label: 'D-same-uuid-default-timeout' });
  results.D = { exit: r.code, state: o?.state, lastError: o?.error, cause: (r.cause || '').slice(0, 200), stderr: stderrLine(r), retry: W.summary(r2) };
  say(`   wait_timeout=2: exit=${r.code} ${o?.state}/${o?.error} cause="${(r.cause || '').slice(0, 120)}" | same UUID with the default timeout: ${W.summary(r2).slice(0, 80)}`);
  L.sh(`rm -f ${R}/big.bin`); drop(b);
}
fs.writeFileSync(`${L.OUT}/r2-matrix${process.env.TAG ? `-${process.env.TAG}` : ''}.json`, JSON.stringify(results, null, 1));
say('R2-DONE');
