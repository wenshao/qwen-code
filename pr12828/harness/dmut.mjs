// Real-process dist mutants: each edits one bundle chunk in an APFS clone of
// the head worktree (DMUT_WT), runs the paired P1 + replacement phases of
// rig.mjs against it, then restores the chunk byte for byte.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const WT = process.env.DMUT_WT;
const CH = path.join(WT, 'dist/chunks');
const find = (prefix) => path.join(CH, fs.readdirSync(CH).find((f) => f.startsWith(prefix) && f.endsWith('.js')));
const RQS = find('run-qwen-serve-');
const SEL = path.join(CH, fs.readdirSync(CH).find((f) => f.endsWith('.js') && fs.readFileSync(path.join(CH, f), 'utf8').includes('cannot run here')));
const M = [
  ['D1', 'primary ignores the option', RQS, '...opts.experimentalPairedEngines?{executionEngines:runtime.createPairedExecutionEngines({legacy:channelFactory,', '...false?{executionEngines:runtime.createPairedExecutionEngines({legacy:channelFactory,'],
  ['D2', 'secondary ignores the option', RQS, '...opts.experimentalPairedEngines?{executionEngines:runtime.createPairedExecutionEngines({legacy:secondaryChannelFactory,', '...false?{executionEngines:runtime.createPairedExecutionEngines({legacy:secondaryChannelFactory,'],
  ['D3', 'secondary reads the primary storage', RQS, 'legacy:secondaryChannelFactory,runtimeBaseDir:secondaryEnv.sessionRuntimeBaseDir})', 'legacy:secondaryChannelFactory,runtimeBaseDir:primarySessionRuntimeBaseDir})'],
  ['D4', 'dynamic/replacement ignore the option', RQS, '...opts.experimentalPairedEngines&&provenance!=="live-conversation"?', '...false&&provenance!=="live-conversation"?'],
  ['D5', 'dynamic/replacement read the primary storage', RQS, 'legacy:wsChannelFactory,runtimeBaseDir:wsEnv.sessionRuntimeBaseDir})', 'legacy:wsChannelFactory,runtimeBaseDir:primarySessionRuntimeBaseDir})'],
  ['D6', 'Conversations runtime paired too', RQS, '...opts.experimentalPairedEngines&&provenance!=="live-conversation"?', '...opts.experimentalPairedEngines?'],
  ['D7', 'Managed owner falls back to Legacy', SEL, 'if(owner.engine==="legacy")return"legacy";', 'if(owner.engine==="legacy"||!managed)return"legacy";'],
];
const only = process.argv.slice(2);
const res = [];
for (const [id, desc, file, a, b] of M) {
  if (only.length && !only.includes(id)) continue;
  const orig = fs.readFileSync(file, 'utf8');
  const n = orig.split(a).length - 1;
  if (n !== 1) { console.log(id, `ANCHOR x${n}`); res.push({ id, desc, anchor: n }); continue; }
  fs.writeFileSync(file, orig.replace(a, b));
  const out = path.resolve(`out-dmut-${id}`);
  let r;
  try {
    r = spawnSync(process.execPath, ['rig.mjs'], { env: { ...process.env, WT, PLAN: 'p1', OUT: out }, encoding: 'utf8', timeout: 1_200_000 });
  } finally {
    fs.writeFileSync(file, orig);
  }
  const obs = fs.existsSync(path.join(out, 'obs.json')) ? JSON.parse(fs.readFileSync(path.join(out, 'obs.json'), 'utf8')) : [];
  res.push({ id, desc, exit: r.status, obs });
  console.log(`== ${id} ${desc} (exit ${r.status})`);
  for (const o of obs) console.log(`   ${o.phase} ${o.step} ${o.key} ${JSON.stringify(o.value).slice(0, 200)}`);
  fs.writeFileSync('dmut.json', JSON.stringify(res, null, 2));
}
