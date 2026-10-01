// All numbers quoted in the report come from here.
const fs = require('fs');
const ROOT = '/root/verify/pr12930';
const R = fs.readFileSync(ROOT + '/results.tsv', 'utf8').trim().split('\n').map((l) => {
  const [tag, arm, fault, scope, rc, ms, summary] = l.split('\t');
  return { tag, arm, fault, scope, rc: +rc, ms: +ms, summary: summary || '' };
});
const valid = R.filter((r) => r.summary);
const invalid = R.filter((r) => !r.summary).map((r) => r.tag);
const grp = (pfx) => { const s = valid.filter((r) => r.tag.startsWith(pfx)); return `${s.filter((r) => r.rc === 0).length}/${s.length}`; };
const out = { invalid, groups: {} };
for (const p of ['smoke-base', 'smoke-head', 'e0-base', 'e0-head', 'e4-base', 'e4-head', 'e5-base', 'e5-head', 'e2-base', 'e2-head']) out.groups[p] = grp(p);
for (const d of [5, 10, 20, 50, 100, 250, 1000, 3000]) for (const a of ['base', 'head']) { const s = valid.filter((r) => r.tag.startsWith(`e1-${a}-d${d}-`)); if (s.length) out.groups[`e1-${a}-d${d}`] = `${s.filter((r) => r.rc === 0).length}/${s.length}`; }
// ordering over SIGKILL-only, non-injected runs (delay runs included: delay is applied before dispatch)
const ord = { base: { before: 0, after: 0, s404: 0, s200: 0, d: [] }, head: { before: 0, after: 0, s404: 0, s200: 0, d: [] } };
for (const r of valid.filter((r) => r.scope === 'sigkill' && !r.tag.startsWith('e3-'))) {
  const L = fs.readFileSync(`${ROOT}/runs/${r.tag}/timeline.jsonl`, 'utf8').trim().split('\n').map(JSON.parse);
  const resp = L.find((e) => e.ev === 'sse_response'), kill = L.find((e) => e.ev === 'kill_sent');
  const o = ord[r.arm];
  kill.t < resp.t ? o.before++ : o.after++;
  resp.status === 404 ? o.s404++ : o.s200++;
  if (r.fault === 'none') o.d.push(kill.t - resp.t);
}
for (const a of ['base', 'head']) { const v = ord[a].d.sort((x, y) => x - y); ord[a].naturalKillMinusResp = { n: v.length, min: v[0], median: v[Math.floor(v.length / 2)], max: v[v.length - 1] }; delete ord[a].d; }
out.ordering = ord;
// base failures: all 404 + 692:18?
const bf = valid.filter((r) => r.arm === 'base' && r.rc !== 0 && !r.tag.startsWith('e3-'));
out.baseFailures = bf.map((r) => {
  const L = fs.readFileSync(`${ROOT}/runs/${r.tag}/timeline.jsonl`, 'utf8');
  const st = (L.match(/"ev":"sse_response"[^}]*"status":(\d+)/) || [])[1];
  const loc = (fs.readFileSync(`${ROOT}/runs/${r.tag}/stdout.txt`, 'utf8').replace(/\x1b\[[0-9;]*m/g, '').match(/test\.ts:\d+:\d+/) || [])[0];
  return `${r.tag} ${st} ${loc}`;
});
out.headSigkillNonInjected = (() => { const s = valid.filter((r) => r.arm === 'head' && !r.tag.startsWith('e3-')); return `${s.filter((r) => r.rc === 0).length}/${s.length} runs pass (incl. ${s.filter((r) => r.scope === 'full').length} full-file runs)`; })();
out.e3 = valid.filter((r) => r.tag.startsWith('e3-')).map((r) => `${r.tag}: ${r.summary.slice(0, 120)}`);
console.log(JSON.stringify(out, null, 1));
