// S13: a definite history refusal through the PUBLIC Workspace route (POST /v1/agents/sessions with a workspace selection). The server
// drives the Harness through QwenHostedHarnessConnector and picks hosted-workspace-files/1 itself; a Workspace Session has one Turn.
// usage: DB=<db> ARM=<head2|base|cand2> JAR=<head|base> SPORT=.. BPORT=.. node s13-public.mjs <letter> <letter2>
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Report, Harness, startModel, workspace, api, sql, script, call, read, holderOf, sleep, j, RIG, DB, RUN, SPRING_PORT, BROKER_PORT } from './lib.mjs';
const [la, lb] = process.argv.slice(2);
const arm = process.env.ARM ?? 'head2';
const R = new Report(`s13-public-${arm}`);
fs.mkdirSync(RUN, { recursive: true });
const model = await startModel();
const h = await new Harness({ name: `s13-${arm}`, modelUrl: model.url, arm }).start();
const out = execFileSync(`${RIG}/spring-public.sh`, [process.env.JAR ?? 'head', DB], { encoding: 'utf8', env: { ...process.env, HARNESS_URL: h.baseUrl, WORKER_DIST: process.env.WORKER ?? arm, SPORT: String(SPRING_PORT), BPORT: String(BROKER_PORT) } });
R.say(`  ${out.trim().split('\n').at(-1).replace(/ log=.*/, '')}; server drives Harness ${arm}`);
const turns = (s) => sql(`SELECT status, COALESCE(error_code,''), retry_count FROM managed_agent_turn WHERE session_id='${s}' ORDER BY created_at`).map((r) => `${r[0]}${r[1] ? '(' + r[1] + ')' : ''}${r[2] !== '0' ? ' retries=' + r[2] : ''}`);
async function waitTurn(s, ms) {
  const end = Date.now() + ms;
  for (;;) {
    const t = turns(s);
    if (t.length && /^(COMPLETED|FAILED|CANCELLED)/.test(t[0])) return t[0];
    if (Date.now() > end) return `${t[0] ?? '<none>'} (not terminal after ${ms / 1000} s)`;
    await sleep(500);
  }
}
const input = (text) => [{ type: 'input_text', text }];
const create = (w, text) => api('POST', '/v1/agents/sessions', { idem: randomUUID(), body: { agent_id: 'qwen-code', input: input(text), workspace: { workspace_id: w.workspaceId, cwd_relative: 'child' } } });
async function scenario(letter, label, seed, steps) {
  const w = await workspace(letter);
  seed(w.dir);
  fs.writeFileSync(path.join(w.dir, 'other.txt'), 'other');
  const c = await create(w, script(steps, 'DONE'));
  const S = c.json.id ?? c.json.session_id;
  const t = await waitTurn(S, 75_000);
  const get = await api('GET', `/v1/agents/sessions/${S}`);
  R.say(`  ${label}`);
  R.say(`    Turn: ${t}; GET session status=${get.json.status}; Workspace lease holder=${holderOf(letter) === '<none>' || holderOf(letter) === '<no row>' ? 'none' : 'held (' + holderOf(letter).slice(0, 8) + '…)'}`);
  const o = await create(w, script([[call('read_file', { file_path: 'other.txt' })]], 'OTHER_DONE'));
  const O = o.json.id ?? o.json.session_id;
  R.say(`    a NEW public Session in the same Workspace (read_file other.txt): create=${o.status}, Turn: ${await waitTurn(O, 75_000)}`);
  return t;
}
try {
  const a = await scenario(la, 'create with input: write_file file_path="src" (a directory), then the corrected path', (dir) => fs.mkdirSync(path.join(dir, 'src')), [[call('write_file', { file_path: 'src', content: 'x' })], [call('write_file', { file_path: 'src/ok.txt', content: 'corrected' })]]);
  const b = await scenario(lb, 'create with input: edit AGENTS.md (a symlink to CLAUDE.md in the Workspace), then CLAUDE.md', (dir) => (fs.writeFileSync(path.join(dir, 'CLAUDE.md'), 'real file'), fs.symlinkSync('CLAUDE.md', path.join(dir, 'AGENTS.md'))), [[call('edit', { file_path: 'AGENTS.md', old_string: 'real file', new_string: 'edited' })], [call('edit', { file_path: 'CLAUDE.md', old_string: 'real file', new_string: 'edited directly' })]]);
  R.say(`== RESULT public/${arm}: directory=${a.split(' ')[0]} symlink=${b.split(' ')[0]}`);
} catch (e) {
  R.check('probe completed without exception', false, String(e.stack ?? e).slice(0, 800));
  R.say(h.log().slice(-1200));
} finally {
  try {
    R.say('  ' + execFileSync(`${RIG}/stop.sh`, [DB, 'spring'], { encoding: 'utf8' }).trim());
  } catch {}
  await h.stop();
  await model.close();
  R.done();
}
