// VERIFICATION RIG ONLY: round-4 evidence cards for PR #13110 at a831c40fcd / 87cafced7f, built from the probe logs.
import fs from 'node:fs';
const OUT = '/rig/out';
const RUN = '/rig/run';
const read = (f) => (fs.existsSync(`${OUT}/${f}`) ? fs.readFileSync(`${OUT}/${f}`, 'utf8').split('\n') : [`<missing ${f}>`]);
const cut = (s0, n = 172) => {
  const s = s0.replace(/\\+"/g, '"').replace(/\/rig\/run\/[a-z0-9]+\/ws\/[a-z0-9]+\/child\//g, '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};
const H = (text) => ({ kind: 'HEAD', text });
const P3 = '80f8cfe3', P4 = 'a831c40f';
const tagged = (l, prefix = '') => {
  const m = l.match(/^(PASS|FAIL|NOTE)\s+(.*?)(?:\s{2}->\s(.*))?$/);
  if (m) return { tag: m[1], kind: m[1], text: cut(prefix + m[2], 150), detail: m[3] ? cut(m[3].replace(/admit=202 /, ''), 166) : undefined };
  return cut(prefix + l.trim(), 172);
};
const lines = (f, prefix) => read(f).filter((l) => /^(PASS|FAIL|NOTE)|^  (backup|between|history|the user|filler|final|writer)/.test(l)).map((l) => tagged(l, prefix));

const fix = {
  id: 'r4-01-refused-preparation',
  title: `Round 4: a backup that fails mid-preparation, then a narrower retry (${P3} vs ${P4})`,
  subtitle: "Real disk-full: the Session's backup directory is a 12 MB disk image pre-filled to 1.5 MB free; backing up a 3 MB file fails with ENOSPC after the checkpoint. The filler is removed afterwards (space freed).",
  sections: [
    { heading: 'one prompt: batch 1 = create new.txt + edit big.txt (refused), batch 2 = edit a.txt only', lines: [H(P3), ...lines('fh4b/s16-enospc-same-prompt-head4.log', `${P3}  `), H(P4), ...lines('fh6/s16-enospc-same-prompt-head6.log', `${P4}  `)] },
    { heading: 'refused prompt, then a new prompt (each turn binds again from the durable record)', lines: [...lines('fh4b/s16-enospc-next-prompt-head4.log', `${P3}  `).filter((x) => typeof x === 'object'), ...lines('fh6/s16-enospc-next-prompt-head6.log', `${P4}  `).filter((x) => typeof x === 'object')] },
    { heading: 'mutants of the fix (7 focused CLI files, 385 tests, baseline green)', lines: read('mut-r4a.log').filter((l) => /^Q\d+ /.test(l)).map((l) => cut('  ' + l.replace(/ by \d+ test\(s\): /, ' by: ').replace(/ \d+ms \(retry x\d+\)/g, ''), 172)) },
  ],
  footer: `On ${P3} the stale checkpoint of the refused batch made the model's narrower retry in the same prompt fail ("files conflict"); on ${P4} the retry succeeds and the prompt's snapshot holds only a.txt. Across prompts both heads are already clean, because the next turn binds again from the durable record. The user's later new.txt survives every undo on both. The second  FAIL is a follow-on of the first: P3 edits a2, which the refused retry never wrote.`,
};

const lat = (arm, f) => {
  const l = read(f).find((x) => x.startsWith('== LATENCY ')) ?? '';
  try {
    return JSON.parse(l.slice(11));
  } catch {
    return null;
  }
};
const rows = [
  ['main 310f4ba3', lat('base4', 'fhbase4b/s16-latency-100-base4.log')],
  ['263859b0 (round 2)', lat('head3', 'fh3y/s16-latency-100-head3.log')],
  ['80f8cfe3 (round 3)', lat('head4', 'fh4b/s16-latency-100-head4.log')],
  [`${P4} (round 4)`, lat('head6', 'fh6/s16-latency-100-head6.log')],
];
const traffic = (f) => (fs.existsSync(`${RUN}/${f}`) ? JSON.parse(fs.readFileSync(`${RUN}/${f}`, 'utf8')) : []);
const th = traffic('fh6/store-traffic-100-head6.json');
const tb = traffic('fhbase4b/store-traffic-100-base4.json');
const tl = (r) => (r ? `${String(r.ms).padStart(5)} ms  ${String(r.gets).padStart(5)} GET  ${String(r.respKB).padStart(5)} KiB read  ${String(r.storeMs).padStart(5)} ms in Store` : 'n/a');
const latency = {
  id: 'r4-02-latency-and-store-reads',
  title: 'Round 4: Write/Edit prompt latency grows with the number of earlier prompts (all PR heads vs main)',
  subtitle: 'One Session, 1 tracked file, 100 consecutive one-line edits, scripted model, host load about 10. Each arm on its own server and database, run one after another.',
  sections: [
    {
      heading: 'median prompt latency (ms) per block of 20 prompts, and the total',
      lines: [`${'arm'.padEnd(24)}${['1-20', '21-40', '41-60', '61-80', '81-100'].map((x) => x.padStart(9)).join('')}   total`, ...rows.map(([n, r]) => (r ? `${n.padEnd(24)}${r.buckets.map((x) => String(x).padStart(9)).join('')}   ${r.total_s} s` : `${n.padEnd(24)}missing`))],
    },
    {
      heading: 'Store traffic of one prompt, through the Store proxy (a831c40f vs main)',
      lines: [1, 10, 50, 100].flatMap((k) => [`prompt ${String(k).padStart(3)}   ${P4}  ${tl(th[k - 1])}`, `             main      ${tl(tb[k - 1])}`]),
    },
    {
      heading: 'Harness CPU profile over the 100 prompts (a831c40f)',
      lines: ['  241 s of 293 s idle; the busiest named path is readResource (9.4 s) -> undici fetch to the Store'],
    },
  ],
  footer: 'Same curve on 263859b0, 80f8cfe3 and a831c40f, so this is not new in round 4. Compared with main, each Write/Edit prompt re-reads about 12 more Store resources per earlier prompt (1,904 GETs and 1.2 MB at prompt 100 vs 705 and 410 KB), which fits the history commits replaying the transcript (R1-13). The 9 s Harness stall and the 20 s prompt seen in earlier long runs were the same curve under heavier host load.',
  footColor: '#d29922',
};

const res = (f) => read(f).filter((l) => /^== RESULT /.test(l) && !/: 0 passed, 0 failed$/.test(l)).map((l) => cut('  ' + l.replace('== RESULT ', ''), 172));
const regress = {
  id: 'r4-03-regression',
  title: `Round 4: round-3 behaviour re-run on ${P4} (and sanity on the merge 87cafced)`,
  subtitle: 'Same probes as round 3 on a fresh MySQL 8.4.7 database; only the bundle and worker changed (no Java change since 560752ca).',
  sections: [
    { heading: 'test plan, refusal cases, faults, semantics, profiles', lines: [...res('fh6/core.console')] },
    { heading: 'round-2 repairs, capacity', lines: [...res('fh6/r2.console'), ...res('fh6/limits.console')] },
    { heading: 'round-3: drift at the next prompt, settle paths, crashes', lines: [...res('fh6/rebase.console'), ...res('fh6/settle.console'), ...read('fh6/crash-sweep.console').filter((l) => l.startsWith('== CRASH')).map((l) => cut('  ' + l.replace('== CRASH ', 'crash '), 172)), ...res('fh6/.harness-kill.console')] },
    { heading: 'sanity on 87cafced (a831c40f merged with main a4bf0026, #13119)', lines: read('fh7/sanity.console').filter((l) => /^== RESULT |^== CRASH /.test(l)).map((l) => cut('  ' + l, 172)) },
  ],
  footer: 'Unchanged from round 3. The one s2-unknown-snapshot failure is the intended round-3 change (reload after a lost snapshot reply now settles, 200). Re-run and still open: undo across absorbed changes (two-Session) and the busy tracked file; 503 after worker loss was not re-run (code this commit does not touch). s5-snapshots (101 prompts) stopped between prompts 50 and 75 with a client "fetch failed" during a 9 s Harness stall while other probes were running; the history calls on the worker stayed at 6-21 ms, and the latency card shows the cause.',
  footColor: '#d29922',
};

export const cards = [fix, latency, regress];
