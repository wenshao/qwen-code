// Edge-case homes: probe full / summary / details status codes on one arm.
// usage: node edge-probe.mjs <armDir> <runDir> <port>
import { mkdirSync, writeFileSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { startDaemon, get } from './daemon.mjs';
const [arm, run, port] = process.argv.slice(2);
const w = (p, c) => { mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, c); };
const mk = (home, dir, name, skill) => {
  const d = join(home, 'extensions', dir);
  w(join(d, 'qwen-extension.json'), JSON.stringify({ name, version: '1.0.0', description: `dir ${dir}` }));
  w(join(d, 'skills', skill, 'SKILL.md'), `---\nname: ${skill}\ndescription: x\n---\nx\n`);
};
const tag = arm.split('/').pop();
const cases = {
  'case-collision': (h) => { mk(h, 'case-upper', 'CaseExt', 'upper-only-skill'); mk(h, 'case-lower', 'caseext', 'lower-only-skill'); mk(h, 'other', 'other', 'other-skill'); },
  'exact-dup': (h) => { mk(h, 'dup-a', 'dup', 'dup-a-skill'); mk(h, 'dup-b', 'dup', 'dup-b-skill'); mk(h, 'other', 'other', 'other-skill'); },
  'broken+route-names': (h) => { w(join(h, 'extensions', 'broken', 'qwen-extension.json'), '{ not json'); mk(h, 'named-summary', 'summary', 'summary-skill'); mk(h, 'named-operations', 'operations', 'operations-skill'); mk(h, 'named-dot', 'v1.2', 'dot-skill'); },
};
const out = {};
let p = Number(port);
for (const [name, build] of Object.entries(cases)) {
  const home = join(run, `edge-${tag}-${name}`); const ws = join(run, `ws-edge-${tag}-${name}`);
  build(home);
  const d = await startDaemon({ arm, home, workspace: ws, port: p++, log: join(run, `edge-${tag}-${name}.log`) });
  try {
    const full = await get(d, '/workspace/extensions');
    const sum = await get(d, '/workspace/extensions/summary');
    const names = ['CaseExt', 'caseext', 'other', 'dup', 'summary', 'operations', 'v1.2', 'broken'];
    const det = {};
    for (const n of names) { const r = await get(d, `/workspace/extensions/${encodeURIComponent(n)}/details`); if (r.status !== 404 || cases[name].toString().includes(`'${n}'`)) det[n] = { status: r.status, code: r.json?.code, path: r.json?.path?.split('/').pop(), skills: r.json?.details?.skills }; }
    const ops = await get(d, '/workspace/extensions/operations');
    out[name] = {
      full: { status: full.status, code: full.json?.code, error: full.json?.error, entries: full.json?.extensions?.map((e) => `${e.name}@${e.path.split('/').pop()}:${e.details.skills}`) },
      summary: { status: sum.status, code: sum.json?.code, entries: sum.json?.extensions?.map((e) => `${e.name}@${e.path.split('/').pop()}`) },
      details: det,
      operationsListStillServed: { status: ops.status, keys: ops.json && typeof ops.json === 'object' ? Object.keys(ops.json) : ops.json },
    };
  } finally { await d.stop(); }
}
console.log(JSON.stringify(out, null, 1));
writeFileSync(join(run, `edge-${tag}.json`), JSON.stringify(out, null, 2));
