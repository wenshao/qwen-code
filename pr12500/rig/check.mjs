import fs from 'node:fs';
import * as M from './matrix.mjs';
const MATRIX = M[process.env.MATRIX_NAME || 'MATRIX'];
const R = '/Users/wenshao/git/rig12500-run';
const tag = process.argv[2] || 'm2';
const s = Object.fromEntries(['base', 'head'].map((a) => [a, JSON.parse(fs.readFileSync(`${R}/summary-${a}-${tag}.json`, 'utf8'))]));
const models = Object.fromEntries(['base', 'head'].map((a) => [a, fs.readFileSync(`${R}/model-ledger-${a}.jsonl`, 'utf8').trim().split('\n').map(JSON.parse).pop()]));
let mism = 0;
for (const r of MATRIX) {
  const st = (a) => (s[a].failed.includes(r.name) ? 'DROP' : 'keep');
  const ok = (st('head') === 'DROP') === (r.expect === 'drop');
  if (!ok) mism++;
  const decl = (a) => (models[a].mcpTools.includes(`mcp__${r.name}__probe`) ? 'decl' : '----');
  console.log(`${r.name.padEnd(10)} ${r.label.padEnd(44)} expect=${r.expect.padEnd(4)} base=${st('base')} head=${st('head')} ${ok ? 'OK ' : 'MISMATCH'}  tool base/head=${decl('base')}/${decl('head')}  headErr=${(s.head.mcpErr[r.name] || [''])[0].slice(0, 90)}`);
}
console.log('mismatches vs PR claim:', mism);
for (const a of ['base', 'head']) console.log(a, 'model saw', models[a].mcpTools.length, 'mcp tools; stdout:', s[a].stdout);
