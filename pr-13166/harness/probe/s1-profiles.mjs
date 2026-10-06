// VERIFICATION RIG ONLY: S1 profile surface, pinning and the unadvertised-glob refusal.
// ARM=head|main selects the Harness bundle; the Runtime worker is whatever spring.sh launched.
import fs from 'node:fs';
import * as L from './lib.mjs';

const name = `s1-profiles-${L.ARM}`;
L.openLog(name);
const model = await L.startModel({
  plain: () => ({ text: 'PLAIN_OK' }),
  g: ({ round, results }) => (round === 0 ? { calls: [['glob', { pattern: '**/*' }]] } : { text: `DONE ${JSON.stringify(results)}` }),
});
const proxy = await L.startBrokerProxy();
const h = await new L.Harness({ name: `s1-${L.ARM}`, modelUrl: model.url, brokerUrl: proxy.url }).start();
const st = process.env.ST ?? 'c';
const ws = `ws-${st}`;
fs.mkdirSync(`${L.ROOTS}/${st}/services/api/src`, { recursive: true });
fs.writeFileSync(`${L.ROOTS}/${st}/services/api/src/index.ts`, 'export {};\n');
L.seedRegistry(ws, `st-${st}`);
const newSession = async (extra) => {
  const id = await L.createWorkspaceSession(ws, 'services/api');
  const s = new L.HSession(h, id, L.storeConnection(h, ws));
  const c = await s.create(extra);
  return { s, c };
};
const toolsOf = async (s) => {
  const n = model.requests.length;
  const r = await s.prompt('[[S:plain]] hello');
  return { r, tools: model.requests.slice(n).at(-1)?.tools ?? null };
};
try {
  L.say('setup', `arm=${L.ARM} harness=${h.baseUrl} ws=${ws}`);
  const want = {
    'hosted-workspace-files/1': ['read_file', 'write_file', 'edit'],
    'hosted-workspace-files/2': ['read_file', 'write_file', 'edit', 'glob'],
    'hosted-workspace-shell/1': null,
    'hosted-workspace-shell/2': null,
  };
  const made = {};
  for (const profile of Object.keys(want)) {
    const { s, c } = await newSession({ toolProfile: profile });
    if (c.status !== 200) {
      L.say('create', `${profile} -> ${c.status} ${JSON.stringify(c.json)}`);
      made[profile] = { status: c.status, code: c.json?.code ?? c.json?.error };
      continue;
    }
    const { r, tools } = await toolsOf(s);
    L.say('create', `${profile} -> 200; turn ${L.summarizeTurn(r)}; advertised=${JSON.stringify(tools)}`);
    made[profile] = { s, tools };
  }
  if (L.ARM === 'main') {
    L.check('main: files/2 create refused', made['hosted-workspace-files/2'].status === 400, JSON.stringify(made['hosted-workspace-files/2']));
    L.check('main: shell/2 create refused', made['hosted-workspace-shell/2'].status === 400, JSON.stringify(made['hosted-workspace-shell/2']));
    L.check('main: files/1 advertises no glob', !made['hosted-workspace-files/1'].tools.includes('glob'), JSON.stringify(made['hosted-workspace-files/1'].tools));
  } else {
    L.check('files/1 tools', JSON.stringify(made['hosted-workspace-files/1'].tools) === JSON.stringify(want['hosted-workspace-files/1']), JSON.stringify(made['hosted-workspace-files/1'].tools));
    L.check('files/2 tools', JSON.stringify(made['hosted-workspace-files/2'].tools) === JSON.stringify(want['hosted-workspace-files/2']), JSON.stringify(made['hosted-workspace-files/2'].tools));
    const sh1 = made['hosted-workspace-shell/1'].tools;
    const sh2 = made['hosted-workspace-shell/2'].tools;
    L.check('shell/1 has no glob', sh1 && !sh1.includes('glob'), JSON.stringify(sh1));
    L.check('shell/2 = shell/1 + glob', sh2 && JSON.stringify(sh2) === JSON.stringify([...sh1, 'glob']), JSON.stringify(sh2));

    // Pinning across detach/load.
    const s2 = made['hosted-workspace-files/2'].s;
    L.say('pin', `files/2 detach -> ${(await s2.detach()).status}`);
    const as1 = await s2.load({ toolProfile: 'hosted-workspace-files/1' });
    L.check('files/2 loaded as files/1 -> 409 hosted_tool_profile_conflict', as1.status === 409 && JSON.stringify(as1.json).includes('hosted_tool_profile_conflict'), `${as1.status} ${JSON.stringify(as1.json)}`);
    const asShell2 = await s2.load({ toolProfile: 'hosted-workspace-shell/2' });
    L.check('files/2 loaded as shell/2 -> 409', asShell2.status === 409, `${asShell2.status} ${JSON.stringify(asShell2.json)}`);
    const plain = await s2.load({});
    const after = plain.status === 200 ? await toolsOf(s2) : { tools: null };
    L.check('files/2 reloaded with no profile keeps glob', plain.status === 200 && after.tools?.includes('glob'), `${plain.status} ${JSON.stringify(after.tools)}`);
    const s1 = made['hosted-workspace-files/1'].s;
    await s1.detach();
    const as2 = await s1.load({ toolProfile: 'hosted-workspace-files/2' });
    L.check('files/1 loaded as files/2 -> 409', as2.status === 409, `${as2.status} ${JSON.stringify(as2.json)}`);
    const back = await s1.load({});
    const t1 = back.status === 200 ? await toolsOf(s1) : { tools: null };
    L.check('files/1 reloaded with no profile still has no glob', back.status === 200 && !t1.tools?.includes('glob'), `${back.status} ${JSON.stringify(t1.tools)}`);

    // A /1 Session whose model calls glob anyway (never advertised).
    const t0 = Date.now();
    const r = await s1.prompt('[[S:g]] search');
    const calls = L.ledgerSince(proxy.ledger, t0);
    L.say('unadvertised', L.summarizeTurn(r));
    for (const t of L.toolTrace(r.events, 300)) L.say('unadvertised trace', t);
    L.say('unadvertised broker', calls.join(' | ') || '<no Broker calls>');
    L.check('unadvertised glob: no Runtime execution prepared', !calls.some((c) => /executions:prepare/.test(c)), calls.join(' | '));
    const st1 = await s1.status();
    L.check('unadvertised glob: Session not blocked', st1.recoveryBlocked === false, JSON.stringify(st1));
    const next = await s1.prompt('[[S:plain]] again');
    L.check('unadvertised glob: next Turn completes', next.terminal?.[0]?.type === 'turn_complete', L.summarizeTurn(next));
  }
  L.say('holders', JSON.stringify(L.holders()));
} finally {
  await h.stop();
  await proxy.close();
  await model.close();
}
process.exitCode = L.done(name);
