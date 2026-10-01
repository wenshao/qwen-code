// S5: SIGKILL of the maintenance process tree (java + node child) at four points of a capture, then a same-UUID resume.
// Every resumed capture must seal with byte-identical sessions/assets indexes to an uninterrupted capture of the same cut,
// with no duplicated work rows and no leftover temporary files. Also: source loss against a compatible baseline.
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import * as L from './lib.mjs';
import * as W from './w1b.mjs';
L.openLog('s5-interrupt');
const { say } = L;
say(L.hostFacts());
let m = L.mountRow('a');
let fence = m.operation !== '-' && m.state === 'FENCED' ? m.operation : null;
if (!fence) { fence = randomUUID(); L.sayMaint('fence-a', L.maint(['fence', L.TENANT, 'st-a', L.root('a'), String(m.revision), fence, '--offline-confirmed'])); m = L.mountRow('a'); }
const revision = m.revision;
say(`   ${L.mstr(m)}`);
const ids = W.members('a').map((x) => x.id);
const idx = (b) => { const man = JSON.parse(fs.readFileSync(`${b}/.w1-recovery/manifest.json`, 'utf8')); return { sessions: man.sessions.digest, assets: man.assets.digest, assetCount: man.assets.count, sessionCount: man.sessionCount }; };
say('== clean capture C0');
const b0 = W.prepareBundle('s5-c0', { sessions: ids }).bundle;
const c0 = W.captureRequest({ fence, revision, bundle: b0 });
const r0 = await W.w1b('capture', c0, { oss: true, label: 'c0' });
const ref = idx(b0); say(`   C0 indexes sessions=${ref.sessions.slice(0, 12)} assets=${ref.assets.slice(0, 12)} (${ref.assetCount} assets, ${ref.sessionCount} sessions)`);
const total = ref.sessionCount;
const q = (op, sql) => Number(L.one(sql.replaceAll('$OP', op)) ?? 0);
const POINTS = [
  { id: 'k1-tree', what: 'during the Workspace tree comparison (>= 20 assets recorded)', when: (op) => q(op, "SELECT COUNT(*) FROM managed_workspace_recovery_work WHERE operation_id='$OP' AND work_kind='ASSET'") >= 20 },
  { id: 'k2-sessions', what: 'after 3 Sessions completed', when: (op) => q(op, "SELECT COUNT(*) FROM managed_workspace_recovery_session WHERE operation_id='$OP' AND state='COMPLETE'") >= 3 },
  { id: 'k3-indexes', what: 'after every Session completed (recheck / census / asset index)', when: (op) => q(op, "SELECT COUNT(*) FROM managed_workspace_recovery_session WHERE operation_id='$OP' AND state='COMPLETE'") >= total },
  { id: 'k4-manifest', what: 'manifest.json published, SQL completion not yet committed', when: (op, b) => fs.existsSync(`${b}/.w1-recovery/manifest.json`) && L.one(`SELECT state FROM managed_workspace_recovery_operation WHERE operation_id='${op}'`) === 'CAPTURING' },
];
const rows = [];
for (const p of POINTS) {
  say(`== ${p.id}: kill ${p.what}`);
  const b = W.prepareBundle(`s5-${p.id}`, { sessions: ids }).bundle;
  const req = W.captureRequest({ fence, revision, bundle: b });
  const pred = () => p.when(req.operationId, b); pred.label = p.id;
  const k = await W.w1b('capture', req, { oss: true, label: `${p.id}-killed`, killWhen: pred });
  const mid = W.opRow(req.operationId);
  const partials = L.sh(`find ${b} -name '*.partial-*' | wc -l`);
  say(`   after kill: ${W.opStr(mid)}; leftover .partial files=${partials}; manifest present=${fs.existsSync(`${b}/.w1-recovery/manifest.json`)}`);
  const ins = await W.w1b('inspect', W.inspectRequest(req.operationId), { label: `${p.id}-inspect`, quiet: true });
  say(`   inspect while interrupted: state=${ins.json?.state} completed=${ins.json?.completedSessions}/${ins.json?.sessionCount} lastError=${ins.json?.lastErrorCode} assets=${ins.json?.assets}`);
  const r = await W.w1b('capture', req, { oss: true, label: `${p.id}-resume` });
  const got = r.code === 0 ? idx(b) : null;
  const same = got && got.sessions === ref.sessions && got.assets === ref.assets;
  const end = W.opRow(req.operationId);
  const dup = q(req.operationId, "SELECT COUNT(*) - COUNT(DISTINCT key_hash) FROM managed_workspace_recovery_work WHERE operation_id='$OP'");
  const v = r.code === 0 ? await W.w1b('verify', W.verifyRequest(req), { label: `${p.id}-verify` }) : null;
  say(`   resume: ${W.summary(r).slice(0, 120)}; indexes identical to C0: ${same}; duplicate work keys=${dup}; verify: ${v ? W.summary(v).slice(0, 110) : '-'}`);
  rows.push({ id: p.id, killed: k.killed, killedExit: k.code, mid: mid?.state, midError: mid?.error, midAssets: mid?.assets, resume: r.code, sealed: end?.state, assets: end?.assets, same, dup, verify: v ? `${v.json?.state} content=${v.json?.result?.contentVerified} authority=${v.json?.result?.authorityCompatible}` : '-' });
}
say('== source loss against a still-compatible bundle (C0)');
const vc = await W.w1b('verify', W.verifyRequest(c0), { label: 'c0-verify' });
fs.renameSync(L.root('a'), `${L.root('a')}.lost`);
const vl = await W.w1b('verify', W.verifyRequest(c0), { label: 'c0-verify-source-lost' });
fs.renameSync(`${L.root('a')}.lost`, L.root('a'));
say('== request and environment checks (each a new UUID; nothing may seal)');
const checks = [];
const chk = async (id, req, opts = {}) => { const r = await W.w1b('capture', req, { oss: true, label: `req-${id}`, quiet: true, ...opts }); const row = W.opRow(req.operationId); checks.push({ id, exit: r.code, outcome: W.summary(r).slice(0, 110), row: row ? row.state + '/' + row.error : '<no row>' }); say(`   ${id.padEnd(22)} exit=${r.code} row=${row ? row.state + '/' + row.error : '<no row>'} -> ${W.summary(r).slice(0, 110)}`); };
const fresh = (name) => W.prepareBundle(`s5-req-${name}`, { sessions: ids }).bundle;
await chk('no-oss-env', W.captureRequest({ fence, revision, bundle: fresh('no-oss') }), { oss: false });
await chk('wrong-oss-key', W.captureRequest({ fence, revision, bundle: fresh('bad-oss') }), { extraEnv: { OSS_ACCESS_KEY_SECRET: 'wrong-secret' } });
await chk('wrong-revision', W.captureRequest({ fence, revision: revision + 1, bundle: fresh('rev') }));
await chk('wrong-fence', W.captureRequest({ fence: randomUUID(), revision, bundle: fresh('fence') }));
await chk('bundle-in-source', W.captureRequest({ fence, revision, bundle: `${L.root('a')}/project/bundle` }));
L.sh(`rm -f /srv/w1b-bundles/s5-link && ln -s ${fresh('target')} /srv/w1b-bundles/s5-link`);
await chk('bundle-symlink', W.captureRequest({ fence, revision, bundle: '/srv/w1b-bundles/s5-link' }));
await chk('history-in-bundle', W.captureRequest({ fence, revision, bundle: fresh('hist'), history: `/srv/w1b-bundles/s5-req-hist/file-history` }));
await chk('cli-entry-mismatch', W.captureRequest({ fence, revision, bundle: fresh('cli'), cliEntry: '/opt/w1b/dist-head/does-not-exist.js' }));
// Is the JDBC password visible to the node child? Sample its environment during a capture.
{
  const req = W.captureRequest({ fence, revision, bundle: fresh('env') });
  let seen = null;
  const pred = () => { for (const p of fs.readdirSync('/proc').filter((x) => /^\d+$/.test(x)).filter((x) => { try { const c = fs.readFileSync(`/proc/${x}/cmdline`, 'utf8').split('\0'); return c[0] === '/opt/qwen/node' && c.includes('--workspace-recovery-worker'); } catch { return false; } })) { try { const e = fs.readFileSync(`/proc/${p}/environ`, 'utf8').split('\0'); seen = e.filter((x) => /^(W1_|OSS_)/.test(x)).map((x) => x.split('=')[0]); return true; } catch { /* gone */ } } return false; };
  const timer = setInterval(() => { if (seen === null) pred(); }, 50);
  const r = await W.w1b('capture', req, { oss: true, label: 'req-env-probe', quiet: true });
  clearInterval(timer);
  void r; say(`   child environment probe: ${seen === null ? 'child not observed' : `W1_/OSS_ variables in the node child: [${seen.join(',')}]`}`);
}
say('== escaped writer AFTER its file was compared (tree complete, Sessions running)');
{
  const b = W.prepareBundle('s5-late-writer', { sessions: ids }).bundle;
  const req = W.captureRequest({ fence, revision, bundle: b });
  let injected = null; const t0 = Date.now();
  const run = W.w1b('capture', req, { oss: true, label: 'late-writer' });
  while (Date.now() - t0 < 600000) {
    const st = L.one(`SELECT state FROM managed_workspace_recovery_operation WHERE operation_id='${req.operationId}'`);
    if (st && st !== 'CAPTURING') break;
    if (q(req.operationId, "SELECT COUNT(*) FROM managed_workspace_recovery_session WHERE operation_id='$OP' AND state='COMPLETE'") >= 1) { fs.appendFileSync(`${L.root('a')}/project/notes.txt`, 'late\n'); injected = `appended after ${Date.now() - t0} ms`; break; }
    await L.sleep(100);
  }
  const r = await run; const row = W.opRow(req.operationId);
  say(`   injected: ${injected}; ${W.opStr(row)}; exit=${r.code}`);
  checks.push({ id: 'late-escaped-writer', exit: r.code, outcome: W.summary(r).slice(0, 110), row: row ? row.state + '/' + row.error : '<no row>' });
}
say('== summary');
for (const x of checks) say(`   check ${x.id.padEnd(22)} exit=${x.exit} row=${x.row} -> ${x.outcome}`);
for (const x of rows) say(`   ${x.id.padEnd(12)} [${x.killed ?? 'not killed'}] mid=${x.mid}/${x.midError} assets=${x.midAssets} -> resume exit=${x.resume} ${x.sealed} assets=${x.assets} identical=${x.same} dup=${x.dup} verify=${x.verify}`);
say(`   C0 verify: ${W.summary(vc)}`); say(`   C0 verify with the source root gone: ${W.summary(vl)}`);
fs.writeFileSync(`${L.OUT}/s5-interrupt.json`, JSON.stringify({ ref, rows, c0: c0.operationId }, null, 1));
say('S5-DONE');
