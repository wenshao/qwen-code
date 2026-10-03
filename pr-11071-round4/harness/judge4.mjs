// Judge for PR #11071 round 4. Reads data/<arm>/*.json and evaluates scripted,
// arm-conditional assertions (expected base failures are pass conditions).
// Usage: node judge4.mjs <arm> [--json out.json]
import fs from 'node:fs';
import path from 'node:path';

const ROOT = '/root/verify/pr11071-r4';
const arm = process.argv[2];
const jsonOut = process.argv[3] === '--json' ? process.argv[4] : undefined;
const isHead = arm === 'head';
const dir = path.join(ROOT, 'data', arm);
const rows = [];
let cell = '';
const check = (label, ok, detail = '') => rows.push({ cell, label, ok: !!ok, detail: String(detail) });
const load = (f) => {
  const p = path.join(dir, f);
  if (!fs.existsSync(p)) return undefined;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
};
const st = (r, prefix) => r.steps.find((s) => s.label.startsWith(prefix));
const serveCh = (settings) => settings?.serve?.channels;
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------- round-4 cells ----------
for (const f of ['gh-loss.json', 'gh-loss-r2.json', 'gh-loss-r3.json']) {
  const r = load(f);
  if (!r) continue;
  cell = f.replace('.json', '');
  check('ran without harness error', !r.error, r.error?.split('\n')[0]);
  const boot = st(r, 'boot');
  check('both real GitHub adapters polling at boot', boot.pollsA > 0 && boot.pollsB > 0, `A=${boot.pollsA} B=${boot.pollsB}`);
  check('ghA answers an @mention before config loss', st(r, 'mention ghA before').verdict === 'ANSWERED');
  const d1 = st(r, 'DELETE ghA #1');
  const win = st(r, 'after DELETE: 8s');
  const post = st(r, 'mentions after DELETE');
  const d2 = st(r, 'DELETE ghA #2');
  if (isHead) {
    check('DELETE #1 -> 200', d1.status === 200, `${d1.status} ${d1.ms}ms`);
    check('ghA worker process exited', win.pidA_alive === false);
    check('ghA stops polling GitHub (0 polls in 8 s window)', win.pollsA_window === 0, win.pollsA_window);
    check('ghA does NOT answer a new @mention', post.ghA === 'NO_REPLY', post.ghA);
    check('stale startup selection removed', eq(serveCh(win.settingsA), []), JSON.stringify(serveCh(win.settingsA)));
    check('DELETE #2 -> 200 (idempotent)', d2.status === 200, d2.status);
  } else {
    check('DELETE #1 -> 404 channel_instance_not_found (bug)', d1.status === 404 && d1.code === 'channel_instance_not_found', `${d1.status} ${d1.code}`);
    check('ghA worker still alive (bug)', win.pidA_alive === true);
    check('ghA keeps polling GitHub after DELETE (bug)', win.pollsA_window > 0, win.pollsA_window);
    check('ghA still answers @mentions with its config deleted (bug)', post.ghA === 'ANSWERED', post.ghA);
    check('stale startup selection retained (bug)', eq(serveCh(win.settingsA), ['ghA']), JSON.stringify(serveCh(win.settingsA)));
    check('DELETE #2 still 404 (cannot converge)', d2.status === 404, d2.status);
  }
  check('bystander ghB worker untouched', win.pidB_alive === true && post.pidB_alive === true);
  check('bystander ghB keeps polling', win.pollsB_window > 0, win.pollsB_window);
  check('bystander ghB answers', post.ghB === 'ANSWERED', post.ghB);
  check('no leaked worker processes', r.leakedWorkers.length === 0, r.leakedWorkers);
}

for (const s of ['home', 'home-redirect']) {
  const r = load(`${s}.json`);
  if (!r) continue;
  cell = s;
  check('ran without harness error', !r.error, r.error?.split('\n')[0]);
  const s0 = st(r, 'start botH via route');
  const boot = st(r, 'boot');
  check('botH started in the $HOME workspace', s0.status === 200 && !!boot.pidH, `${s0.status} pid=${boot.pidH}`);
  check('$HOME workspace lists botH from the user file', boot.listHome.instances.includes('botH'));
  const lost = st(r, 'config lost');
  check('after loss, botH no longer listed', lost.listHome.instances.length === 0, JSON.stringify(lost.listHome.instances));
  const d1 = st(r, 'DELETE botH #1');
  const a1 = st(r, 'after DELETE #1');
  const d2 = st(r, 'DELETE botH #2');
  const rs = st(r, 'after restart');
  if (isHead) {
    check('DELETE #1 -> 200', d1.status === 200, `${d1.status} ${d1.ms}ms`);
    check('botH worker exited, peer closed', a1.pidH_alive === false && a1.peers.botH.closes >= 1);
    check('stale selection removed from the user file', eq(serveCh(a1.userFile), []), JSON.stringify(serveCh(a1.userFile)));
    check('DELETE #2 -> 200', d2.status === 200, d2.status);
  } else {
    check('DELETE #1 -> 404 (bug)', d1.status === 404, `${d1.status} ${d1.code}`);
    check('botH worker still alive (bug)', a1.pidH_alive === true);
    check('stale selection retained in the user file (bug)', eq(serveCh(a1.userFile), ['botH']), JSON.stringify(serveCh(a1.userFile)));
    check('DELETE #2 still 404', d2.status === 404, d2.status);
  }
  check('bystander wsB worker untouched', a1.pidB_alive === true);
  if (s === 'home-redirect') {
    check('no stray write to $HOME/.qwen/settings.json (redirected QWEN_HOME)', a1.strayBefore === false && a1.strayWorkspaceFile === null);
  }
  check('user file after restart matches the arm', isHead ? eq(serveCh(rs.userFile), []) : eq(serveCh(rs.userFile), ['botH']), JSON.stringify(serveCh(rs.userFile)));
  check('no leaked worker processes', r.leakedWorkers.length === 0, r.leakedWorkers);
}

{
  const r = load('userscope-guard.json');
  if (r) {
    cell = 'userscope-guard';
    check('ran without harness error', !r.error, r.error?.split('\n')[0]);
    const boot = st(r, 'boot');
    check('botU (user-scope config) runs for wsA', !!boot.pidU);
    check('wsA lists no instance (scope-local view)', boot.listA.instances.length === 0);
    const d1 = st(r, 'DELETE botU');
    const a = st(r, 'after DELETE');
    check('DELETE -> 404 channel_instance_not_found', d1.status === 404 && d1.code === 'channel_instance_not_found', `${d1.status} ${d1.code}`);
    if (isHead) check('message names the other scope', /another scope/.test(d1.error ?? ''), d1.error);
    check('worker NOT stopped (no phantom delete)', a.pidU_alive === true && a.peers.botU.closes === 0);
    check('wsA selection untouched', eq(serveCh(a.settingsA), ['botU']));
    check('user-scope config untouched', !!a.userFile.channels?.botU);
    check('no leaked worker processes', r.leakedWorkers.length === 0, r.leakedWorkers);
  }
}

{
  const r = load('untrusted.json');
  if (r) {
    cell = 'untrusted';
    check('ran without harness error', !r.error, r.error?.split('\n')[0]);
    const reg = st(r, 'register untrusted U');
    check('workspace registered untrusted', reg.status === 201 && reg.trusted === false, `${reg.status} trusted=${reg.trusted}`);
    check('GET channels -> 403 untrusted_workspace', st(r, 'GET channels U').status === 403 && st(r, 'GET channels U').code === 'untrusted_workspace');
    const d = st(r, 'DELETE botX in U');
    check('DELETE -> 403 untrusted_workspace (route gate precedes the service)', d.status === 403 && d.code === 'untrusted_workspace', `${d.status} ${d.code}`);
    check('settings byte-identical', st(r, 'after').settingsU_byte_identical === true);
  }
}

const drainCells = fs
  .readdirSync(dir)
  .filter((f) => /^drain(pre)?-\d+\.json$/.test(f))
  .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
for (const f of drainCells) {
  const r = load(f);
  cell = f.replace('.json', '');
  check('ran without harness error', !r.error, r.error?.split('\n')[0]);
  const a = st(r, 'DELETE vs SIGTERM');
  const rs = st(r, 'after restart');
  const rt = st(r, 'retry DELETE');
  const fin = st(r, 'final');
  check('daemon exits 0 on SIGTERM', a.daemonExit.code === 0, JSON.stringify(a.daemonExit));
  check('no worker process outlives the daemon', a.fixtureWorkersAfterExit.length === 0, a.fixtureWorkersAfterExit);
  check('DELETE outcome is a response or a reset, never another 5xx', [200, 404, 'ERR'].includes(a.delete.status), `${a.delete.status} ${a.delete.code ?? ''}`);
  const persistedGone = eq(serveCh(a.settingsA), []);
  if (isHead) {
    check('no half state: 200 <=> selection removed on disk', (a.delete.status === 200) === persistedGone, `${a.delete.status} serve=${JSON.stringify(serveCh(a.settingsA))}`);
    check('retry after restart -> 200', rt.status === 200, rt.status);
    check('final: selection removed', eq(serveCh(fin.settingsA), []));
  } else {
    check('base never converges: DELETE 404 or reset', a.delete.status === 404 || a.delete.status === 'ERR', a.delete.status);
    check('stale selection retained on disk', eq(serveCh(a.settingsA), ['botA']));
    check('retry after restart still 404 (bug persists across restart)', rt.status === 404, rt.status);
    check('final: stale selection still on disk', eq(serveCh(fin.settingsA), ['botA']));
  }
  // Not an A/B discriminator: the config is gone, so neither arm can restore botA.
  check('restart does not restore botA (config gone; same on both arms)', !rs.control.selection.names.includes('botA'));
  check('bystander botB back after restart', rs.peers.botB.open === 1);
  check('no leaked worker processes', r.leakedWorkers.length === 0, r.leakedWorkers);
}

// ---------- x86_64 replication of round-1/3 core cells (probe1) ----------
const p1 = (s) => load(`p1-${s}.json`);
{
  const r = p1('loss');
  if (r) {
    cell = 'p1-loss';
    const d1 = st(r, 'DELETE botA #1');
    const a1 = st(r, 'after DELETE #1');
    const d2 = st(r, 'DELETE botA #2');
    if (isHead) {
      check('DELETE #1 -> 200', d1.status === 200, `${d1.status} ${d1.ms}ms`);
      check('worker A exited', a1.pidA_alive === false);
      check('selection cleared', eq(serveCh(a1.settingsA), []));
      check('DELETE #2 -> 200', d2.status === 200);
    } else {
      check('DELETE #1 -> 404 (bug)', d1.status === 404, d1.status);
      check('worker A alive (bug)', a1.pidA_alive === true);
      check('DELETE #2 -> 404', d2.status === 404);
    }
    check('worker B untouched', a1.pidB_alive === true);
  }
}
{
  const r = p1('stale');
  if (r) {
    cell = 'p1-stale';
    const d1 = st(r, 'DELETE botA with stale');
    const a = st(r, 'after stale DELETE');
    if (isHead) check('stale revision -> 409 channel_settings_conflict', d1.status === 409 && d1.code === 'channel_settings_conflict', `${d1.status} ${d1.code}`);
    else check('stale revision -> 404 (base short-circuits)', d1.status === 404, d1.status);
    check('settings byte-identical, worker A alive', a.settingsA_byte_identical === true && a.pidA_alive === true);
  }
}
{
  const r = p1('normal');
  if (r) {
    cell = 'p1-normal';
    const d1 = st(r, 'DELETE configured botA');
    const a = st(r, 'after DELETE');
    check('configured DELETE -> 200, worker exits', d1.status === 200 && a.pidA_alive === false, `${d1.status}`);
  }
}
{
  const r = p1('busy');
  if (r) {
    cell = 'p1-busy';
    const d1 = st(r, 'DELETE configured botA in A');
    check('running-channel DELETE during unrelated transition queues then 200 (same on both arms)', d1.status === 200 && d1.ms > 15000, `${d1.status} ${d1.ms}ms`);
  }
}
{
  const r = p1('busy-loss');
  if (r) {
    cell = 'p1-busy-loss';
    const d1 = st(r, 'DELETE config-lost botA');
    const rt = st(r, 'retry DELETE');
    if (isHead) {
      check('mid-transition missing-config DELETE -> 409 channel_service_conflict', d1.status === 409 && d1.code === 'channel_service_conflict', `${d1.status} ${d1.code}`);
      check('retry after settle -> 200', rt?.status === 200, rt?.status);
    } else {
      check('-> 404 (bug)', d1.status === 404, d1.status);
      check('retry still 404', rt?.status === 404, rt?.status);
    }
  }
}
{
  const r = p1('poison');
  if (r) {
    cell = 'p1-poison';
    const s1 = st(r, 'start botC in C (A lost');
    const d1 = st(r, 'DELETE botA in A');
    const s2 = st(r, 'start botC in C again');
    check('start elsewhere blocked while lost config is committed', s1.status === 400, `${s1.status} ${s1.code}`);
    if (isHead) check('DELETE 200 unblocks: second start 200', d1.status === 200 && s2.status === 200, `${d1.status}/${s2.status}`);
    else check('DELETE 404, second start still 400 (bug)', d1.status === 404 && s2.status === 400, `${d1.status}/${s2.status}`);
  }
}
{
  const r = p1('inflight');
  if (r) {
    cell = 'p1-inflight';
    const d1 = st(r, 'DELETE configured botA (mid restore)');
    const a = st(r, 'after settle');
    const d2 = st(r, 'DELETE botA again');
    const fin = st(r, 'final');
    if (isHead) {
      check('DELETE mid same-channel restore -> 409', d1.status === 409, `${d1.status} ${d1.code}`);
      check('retry -> 200; only botP\'s worker remains', d2.status === 200 && fin.workerPids.length === 1, `${d2.status} pids=${fin.workerPids.length}`);
    } else {
      check('DELETE -> 200 then orphan: worker alive, list empty, 2nd DELETE 404 (base bug)', d1.status === 200 && a.listA.instances.length === 0 && d2.status === 404 && a.peers.botA.open === 1, `${d1.status} list=${a.listA.instances} d2=${d2.status} open=${a.peers.botA.open}`);
    }
  }
}
{
  const r = p1('all-reload');
  if (r) {
    cell = 'p1-all-reload';
    const d1 = st(r, 'DELETE P botN');
    const a = st(r, 'after settle');
    const rt = st(r, 'retry DELETE');
    const fin = st(r, 'after retry');
    if (isHead) {
      check('DELETE during --channel all reload -> 409', d1.status === 409, `${d1.status} ${d1.code}`);
      check('retry -> 200, botN peer closed, no orphan', rt?.status === 200 && fin.peers.botN.open === 0, `${rt?.status} open=${fin?.peers.botN.open}`);
    } else {
      check('DELETE -> 200 then orphan: botN stays connected with config gone (base bug)', d1.status === 200 && a.peers.botN.open === 1 && !a.settingsP.channels?.botN, `${d1.status} open=${a.peers.botN.open}`);
    }
  }
}
{
  const r = p1('samename');
  if (r) {
    cell = 'p1-samename';
    const d1 = st(r, 'DELETE A botX');
    const rt = st(r, 'retry DELETE');
    const a = st(r, 'after settle');
    if (isHead) check('name in pending selection -> conservative 409, retry 200', d1.status === 409 && rt?.status === 200, `${d1.status}/${rt?.status}`);
    else check('-> 200 (no guard)', d1.status === 200, d1.status);
    check("B's same-named worker untouched", a.peers.botXb.open === 1 && a.peers.botXb.closes === 0);
  }
}

const pass = rows.filter((r) => r.ok).length;
for (const r of rows) console.log(`${r.ok ? 'PASS' : 'FAIL'}  [${r.cell}] ${r.label}${r.detail ? `  (${r.detail})` : ''}`);
console.log(`\n${arm}: ${pass}/${rows.length} pass, ${rows.length - pass} fail`);
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ arm, pass, total: rows.length, rows }, null, 2));
