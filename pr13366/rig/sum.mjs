// Summarize rig runs: node sum.mjs [label-prefix...] → TSV on stdout, results.tsv in out/
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

const RIG = '/Users/wenshao/pr13366-rig/out/runs';
const prefixes = process.argv.slice(2);
const rows = [];
const header = [
  'run', 'arm', 'scenario', 'terminals', 'files', 'notices', 'busy409', 'otherRefusals',
  'acquire200', 'release200', 'pollMedianMs', 'queueMs', 'leaseHolders', 'crossTalk', 'toolRows', 'extra',
];
for (const name of readdirSync(RIG).sort()) {
  if (prefixes.length && !prefixes.some((p) => name.startsWith(p))) continue;
  const dir = `${RIG}/${name}`;
  const log = existsSync(`${dir}/run.log`) ? readFileSync(`${dir}/run.log`, 'utf8') : '';
  const exit = /exit=(\d+) wall=(\d+)s/.exec(log);
  if (!existsSync(`${dir}/result.json`)) {
    // the issue runner (x5) prints its own summary or throws
    const reproduced = /"reproduced": (true|false)/.exec(log)?.[1];
    const thrown = /Error: ([^\n]{0,160})/.exec(log)?.[1];
    rows.push([name, name.split('-')[1], 'issue-runner', reproduced ? `reproduced=${reproduced}` : '', '', '', '', '', '', '', '', '', '', '', '', `exit=${exit?.[1]} ${thrown ?? ''} ${/"completedTurns": \d+/.exec(log)?.[0] ?? ''} ${/"failedTurns": \d+/.exec(log)?.[0] ?? ''}`.trim()]);
    continue;
  }
  const r = JSON.parse(readFileSync(`${dir}/result.json`, 'utf8').trim().split('\n').at(-1));
  const tap = existsSync(`${dir}/broker-tap.jsonl`)
    ? readFileSync(`${dir}/broker-tap.jsonl`, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
    : [];
  const acq = tap.filter((e) => e.p?.endsWith('tool-sessions:acquire'));
  const busy = acq.filter((e) => e.s === 409 && e.code === 'workspace_busy');
  const other = acq.filter((e) => e.s !== 200 && !(e.s === 409 && e.code === 'workspace_busy'));
  const ok = acq.filter((e) => e.s === 200);
  const rel = tap.filter((e) => e.p?.endsWith(':release') && e.s === 200);
  const gaps = busy.slice(1).map((e, i) => e.t - busy[i].t).sort((a, b) => a - b);
  const median = gaps.length ? gaps[Math.floor(gaps.length / 2)] : '';
  const lastOk = ok.at(-1);
  const queueMs = busy.length && ok.length > 1 && lastOk && lastOk.t > busy[0].t ? lastOk.t - busy[0].t : '';
  const holders = [];
  for (const e of r.timeline.filter((x) => x.what === 'lease')) {
    const id = e.row.split(' ')[0];
    if (id !== '-' && holders.at(-1) !== id) holders.push(id);
  }
  const terminals = Object.entries(r.terminals)
    .map(([l, t]) => `${l}:${(t.type ?? 'NONE').replace('turn.', '')}@${t.atMs ?? '-'}`)
    .join(' ');
  const files = Object.entries(r.files).map(([l, f]) => `${l}:${f ? 'Y' : 'n'}`).join(' ');
  const extra = r.timeline
    .filter((e) => ['cancel', 'followup', 'no-terminal'].includes(e.what) || (e.what === 'terminal' && !/turn\.completed/.test(e.type ?? '')))
    .map((e) => `${e.what}:${e.label}@${e.t}${e.status ? `/${e.status}` : ''}${e.what === 'terminal' ? `/${(JSON.parse(e.data ?? 'null') ?? {}).code ?? ''}` : ''}`)
    .join(' ');
  rows.push([
    name, r.arm, r.scenario, terminals, files, r.queueNotices, busy.length,
    other.map((e) => `${e.s}/${e.code ?? e.error ?? ''}`).join(',') || 0,
    ok.length, rel.length, median, queueMs, holders.length, r.crossTalk, r.toolExecutions.join(','), extra,
  ]);
}
const tsv = [header, ...rows].map((r) => r.map((v) => (v === '' || v === undefined ? '-' : v)).join('\t')).join('\n');
console.log(tsv);
writeFileSync('/Users/wenshao/pr13366-rig/out/results.tsv', tsv + '\n');
