// S10: no-Hook baseline (main vs PR head): ordinary tool turn, Hook routes, public catalog, ambient Hooks in the
// Harness host settings stay inert for Hosted Sessions.   usage: ARM=main|head DB=<db> node s10-baseline.mjs
import fs from 'node:fs';
import { Report, Harness, HSession, startModel, workspace, createWorkspaceSession, storeConnection, script, call, turn, api, RUN, j } from './lib.mjs';
const arm = process.env.ARM ?? 'head';
const R = new Report(`s10-baseline-${arm}`);
const AMBIENT = `${RUN}/ambient-${arm}.marker`;
fs.rmSync(AMBIENT, { force: true });
const model = await startModel();
const h = new Harness({ name: `s10-${arm}`, modelUrl: model.url, arm });
// ambient (Legacy) Hooks in the Harness host's user settings: must not run for a Hosted Session
const _start = h.start.bind(h);
h.start = async () => {
  const r = await _start();
  return r;
};
fs.mkdirSync(`${RUN}/harness-s10-${arm}/.qwen`, { recursive: true });
await h.start();
const settingsPath = `${h.root}/.qwen/settings.json`;
const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
settings.hooks = { UserPromptSubmit: [{ hooks: [{ type: 'command', command: `/usr/bin/touch ${AMBIENT}` }] }], PreToolUse: [{ matcher: 'write_file', hooks: [{ type: 'command', command: `/usr/bin/touch ${AMBIENT}` }] }] };
fs.writeFileSync(settingsPath, JSON.stringify(settings));
await h.stop();
await h.start({ keep: true });
try {
  const w = await workspace('l', 'ws-base');
  const id = await createWorkspaceSession(w.workspaceId);
  const s = new HSession(h, id, storeConnection(h, w.workspaceId));
  const c = await s.create();
  const p = await s.prompt(script([[call('write_file', { file_path: `base-${arm}.txt`, content: arm })]], 'BASE'));
  R.check('ordinary Hosted tool turn completes', c.status === 200 && p.terminal?.[0]?.type === 'turn_complete' && fs.existsSync(`${w.dir}/base-${arm}.txt`), `${turn(p)}`);
  R.check('ambient Legacy Hooks from host settings did not run', !fs.existsSync(AMBIENT), `marker=${fs.existsSync(AMBIENT)}`);
  const hk = await s.hooks();
  const pub = await api('GET', `/v1/agents/sessions/${id}/hook-catalog`);
  R.note('GET /session/:id/hooks', `${hk.status} ${j(hk.json).slice(0, 100)}`);
  R.note('public hook-catalog', `${pub.status} ${j(pub.json).slice(0, 120)}`);
  R.note('model requests', String(model.requests.length));
} finally {
  await h.close();
  await model.close();
  R.done();
}
