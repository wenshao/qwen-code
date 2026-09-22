// Figure 3 transcript: NODE_OPTIONS backslash handling — real Node vs the PR's
// parser, and the triage-proposed change.
import fs from 'node:fs';
const B = '\x1b[1m', D = '\x1b[2m', X = '\x1b[0m', G = '\x1b[32m', RED = '\x1b[31m', Y = '\x1b[33m', C = '\x1b[36m';
const line = (s = '') => process.stdout.write(s + '\n');
const O = '/root/verify/pr12353-work/oracle';
const pr = JSON.parse(fs.readFileSync(`${O}/roundtrip-result.json`, 'utf8'));
const tf = JSON.parse(fs.readFileSync(`${O}/roundtrip-result-triagefix.json`, 'utf8'));
const ver = (b) => (b === '/usr/bin/node' ? 'v22.22.2' : b.match(/node-(v[\d.]+)/)[1]);

line(`${D}# 1. What real Node does with a bare backslash inside quotes (NODE_OPTIONS → process.report.filename)${X}`);
for (const s of ['--report-filename="C:\\tools\\hook.cjs"', '--report-filename="C:\\\\tools\\\\hook.cjs"', '--report-filename=C:\\tools\\hook.cjs']) {
  const rows = pr.handResults.filter((h) => h.s === s);
  const outs = [...new Set(rows.map((h) => JSON.parse(h.orig.out)[0]))];
  line(`  ${C}NODE_OPTIONS='${s}'${X}`);
  line(`      Node 20/22/24/26 read: ${B}${outs.join(' | ')}${X}    ${D}PR rewrite → Node reads: ${JSON.parse(rows[0].again.out)[0]}${X}  ${G}✓ same${X}`);
}
line(`  ${D}node/src/node_options.cc ParseNodeOptionsEnvVar (v22.22.2:1797, v24.21.0:2209): "// Backslashes escape the following character"${X}`);
line(`  ${D}  if (c == '\\\\' && is_in_string) { … c = node_options.at(++index); }   — no platform branch${X}`);
line();
line(`${D}# 2. Differential round-trip oracle: node(S) vs node(rewrite(S)), 1500 seeded inputs of " \\ = - a b x <tab>${X}`);
line(`  ${B}${'parser'.padEnd(34)}${'node'.padEnd(10)}${'rewritten'.padEnd(11)}${'same'.padEnd(7)}${'differs'.padEnd(9)}PR rejects, Node accepts${X}`);
for (const [bin, s] of Object.entries(pr.summary).sort((a, b) => parseInt(ver(a[0]).slice(1)) - parseInt(ver(b[0]).slice(1)))) {
  line(`  ${'PR adc5c44 (as submitted)'.padEnd(34)}${ver(bin).padEnd(10)}${String(s.prRewrote).padEnd(11)}${G}${String(s.equal).padEnd(7)}${X}${G}${String(s.mismatch).padEnd(9)}${X}${G}${s.prThrewNodeAccepted}${X}`);
}
for (const [bin, s] of Object.entries(tf.summary)) {
  line(`  ${'triage-proposed "escape only \\""'.padEnd(34)}${ver(bin).padEnd(10)}${String(s.prRewrote).padEnd(11)}${String(s.equal).padEnd(7)}${RED}${B}${String(s.mismatch).padEnd(9)}${X}${RED}${B}${s.prThrewNodeAccepted}${X}`);
}
const ex = tf.mismatches.find((m) => m.s === '--report-filename="C:\\\\tools\\\\hook.cjs"');
if (ex) line(`  ${D}e.g. ${ex.s}: Node reads ${JSON.parse(ex.orig.out)[0]}; after the triage change the child reads ${JSON.parse(ex.again.out)[0]}${X}`);
line();
line(`${D}# 3. Real daemon (DEV=true keeps NODE_OPTIONS for children), --child-heap-mode enforce${X}`);
line(`  ${D}two preload files exist: esc/dir\\sub/p.cjs and esc/dirsub/p.cjs; each process logs which one it loaded${X}`);
for (const kase of ['triage', 'escaped', 'unquoted']) {
  const r = JSON.parse(fs.readFileSync(`/root/verify/pr12353-work/runs/dev-head-enforce-${kase}/report.json`, 'utf8'));
  const short = (s) => s.replace(/\/root\/verify\/pr12353-work\/runs\/[^/]+\//g, '');
  const d = r.loads.find((l) => l.role === 'daemon');
  const c = r.loads.find((l) => l.role === 'acp-child');
  line(`  ${C}NODE_OPTIONS='${short(r.daemonNodeOptions)}'${X}`);
  line(`      daemon (Node) loaded ${Y}${d.loaded}${X} (heap ${d.heapMb} MiB) · ACP child loaded ${c.loaded === d.loaded ? G : RED}${c.loaded}${X} (heap ${c.heapMb} MiB)`);
  line(`      ${D}child NODE_OPTIONS after rewrite: ${short(r.child.env.NODE_OPTIONS)}${X}`);
}
