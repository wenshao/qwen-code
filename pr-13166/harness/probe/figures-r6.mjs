// VERIFICATION RIG ONLY (PR #13166 round 6, Linux): evidence figures. Every quoted value is read from
// out/w1/*.jsonl, out/<db>/*.log|json and out/mutation/ledger.jsonl, so the figures cannot drift from the logs.
import { createRequire } from 'node:module';
import fs from 'node:fs';
const RIG = '/root/verify/pr13166/rig';
const require = createRequire('/root/verify/pr13166/head/package.json');
const { chromium } = require('playwright-core');
const OUT = `${RIG}/fig-r6`;
fs.mkdirSync(OUT, { recursive: true });
const W = 1040;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const css = `
  body{margin:0;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","DejaVu Sans",sans-serif;color:#e6edf3}
  #card{width:${W}px;padding:24px 28px 26px;background:#0d1117}
  h1{font-size:19px;margin:0 0 4px;font-weight:650}
  h2{font-size:14.5px;margin:16px 0 8px}
  .sub{font-size:13px;color:#9da7b3;margin:0 0 14px;line-height:1.45}
  pre{font-family:ui-monospace,"DejaVu Sans Mono",Menlo,monospace;font-size:11.4px;line-height:1.45;background:#161b22;border:1px solid #30363d;border-radius:6px;padding:9px 11px;margin:0 0 10px;white-space:pre-wrap;word-break:break-all;color:#c9d1d9}
  .note{font-size:12.5px;color:#c9d1d9;border-left:3px solid #d29922;padding:6px 10px;margin:4px 0 12px;line-height:1.5;background:#161b22}
  .note.ok{border-left-color:#3fb950}.note.bad{border-left-color:#f85149}.note.info{border-left-color:#58a6ff}
  code{font-family:ui-monospace,"DejaVu Sans Mono",Menlo,monospace;font-size:11.4px;background:#1f2630;padding:1px 4px;border-radius:4px}
  table{border-collapse:collapse;width:100%;font-size:12.2px;margin-bottom:12px}
  th,td{border:1px solid #30363d;padding:5px 8px;text-align:left;vertical-align:top;line-height:1.4}
  th{background:#161b22;color:#9da7b3;font-weight:600}
  td code{font-size:11px;word-break:break-all;white-space:pre-wrap}
  table.fixed{table-layout:fixed}
  .pass{color:#3fb950;font-weight:600}.fail{color:#f85149;font-weight:600}.amber{color:#d29922;font-weight:600}.dim{color:#8b949e}
`;
const page = (title, sub, body) => `<!doctype html><meta charset="utf-8"><style>${css}</style><div id="card"><h1>${esc(title)}</h1><p class="sub">${sub}</p>${body}</div>`;
const table = (head, rows, widths) =>
  `<table${widths ? ' class="fixed"' : ''}>${widths ? `<colgroup>${widths.map((w) => `<col style="width:${w}">`).join('')}</colgroup>` : ''}<tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.map((c) => (typeof c === 'object' ? `<td class="${c.c ?? ''}">${c.t}</td>` : `<td>${c}</td>`)).join('')}</tr>`).join('')}</table>`;
const P = (t) => ({ c: 'pass', t });
const F = (t) => ({ c: 'fail', t });
const A = (t) => ({ c: 'amber', t });
const jl = (f) => fs.readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const w1 = { base: jl(`${RIG}/out/w1/w1-base.jsonl`), head: jl(`${RIG}/out/w1/w1-head.jsonl`) };
const row = (arm, c, i) => w1[arm].filter((r) => r.case === c)[i];
const short = (r) => {
  let t = r.text;
  const m = t.match(/"text":"((?:[^"\\]|\\.)*)"/);
  if (m) t = JSON.parse(`"${m[1]}"`);
  t = t.replace(/, sorted by modification time \(newest first\):\n---\n/, ' → ').replace(/\n/g, ' ');
  return esc(t.length > 118 ? t.slice(0, 118) + ' …' : t);
};
const cell = (r, good) => {
  const leak = r.leaksMount ? ' <span class="fail">[host path]</span>' : '';
  const label = `<b>${r.status}</b>${leak}<br>${short(r)}`;
  return good === undefined ? label : good ? P(label) : F(label);
};
const call = (r) => `<code>${esc(r.session)}</code> ${esc(r.tool)}<br><code>${esc(JSON.stringify(r.input))}</code>`;

const figs = {};
// ---------------------------------------------------------------- figure 1
{
  const rows = [];
  const add = (finding, c, i, baseBad = true) => {
    const b = row('base', c, i);
    const h = row('head', c, i);
    rows.push([finding, call(h), cell(b, !baseBad), cell(h, true)]);
  };
  add('R10-1', 'r10_build_vs_boundary', 0);
  add('R10-1', 'r10_build_vs_boundary', 3);
  add('R11-1', 'r11_1_glob_input', 0, false);
  add('R11-1', 'r11_1_glob_input', 1);
  add('R11-2', 'r11_2_escaped_path', 0, false);
  add('R11-2', 'r11_2_escaped_path', 1);
  add('R11-3', 'r11_3_nested', 0);
  add('R11-3', 'r11_3_nested', 1);
  add('R11-3', 'r11_3_nested', 2);
  add('R11-3', 'r11_3_nested', 3);
  const fsBase = fs.readFileSync(`${RIG}/out/w1/w1-base.log`, 'utf8').match(/fs: api\/src\/pwned\.txt.*$/m)[0];
  const fsHead = fs.readFileSync(`${RIG}/out/w1/w1-head.log`, 'utf8').match(/fs: api\/src\/pwned\.txt.*$/m)[0];
  figs['r6-01-fixes'] = page(
    'The four fixes of 0d6a6307 on a real Runtime worker process',
    'Built <code>dist/cli.js managed-runtime-worker</code> of each arm, boot v2 over stdin with the workspace-capability digest, real directories, loopback HTTP. Several Sessions installed in ONE worker — the topology the worker-local sibling registry exists for (the Java Broker gives every Session its own worker). <b>before</b> = <code>ee0a962d</code>, the fix commit\'s parent; <b>head</b> = <code>0d6a6307</code>. Layouts: R10-1/R11-2 <code>session-1@services/api</code> + <code>session-2@services/web</code>; R11-1 <code>session-root@.</code> + <code>session-1@services/api</code>; R11-3 <code>session-a@services</code> + <code>session-b@services/api</code>.',
    table(['finding', 'call', 'before (ee0a962d)', 'head (0d6a6307)'], rows, ['62px', '31%', '34%', '29%']) +
      `<div class="note bad">before, R11-3 on disk: <code>${esc(fsBase.replace(/; worker exit=\d+/, ''))}</code> — the ancestor Session created a file in, and rewrote, the nested Session's private estate.</div>` +
      `<div class="note ok">head, R11-3 on disk: <code>${esc(fsHead.replace(/; worker exit=\d+/, ''))}</code>. Controls stay green at head: the nested Session reads its own file, the ancestor reads its own <code>top.ts</code> and the unowned <code>shared/</code>. Every worker exited 0 on SIGTERM.</div>`,
  );
}
// ---------------------------------------------------------------- figure 2
{
  const J = (db, arm, v) => JSON.parse(fs.readFileSync(`${RIG}/out/${db}/s25-r10-${arm}-${v}.json`, 'utf8'));
  const runs = { 'base v2': J('g2', 'base', 'v2'), 'base v1': J('g2', 'base', 'v1'), 'head v2': J('g1', 'head', 'v2'), 'head v1': J('g1', 'head', 'v1') };
  const txt = (r) => {
    let t = r.modelSaw;
    try {
      t = JSON.parse(t)[0].text;
    } catch {}
    return esc(t.length > 150 ? t.slice(0, 150) + ' …' : t);
  };
  const rows = [];
  for (const [k, label] of [
    ['ipynbBehindLink', '<code>read_file {"file_path":"ext/assets/x.ipynb","offset":1}</code>'],
    ['readBehindLink', '<code>read_file {"file_path":"ext/assets/readme.txt"}</code> (control)'],
    ['dirBehindLink', '<code>write_file {"file_path":"ext/assets"}</code> (outside directory)'],
    ['ownWrite', '<code>write_file {"file_path":"src/new.txt"}</code> (own file, control)'],
  ]) {
    for (const v of ['v2', 'v1']) {
      const b = runs[`base ${v}`].rows.find((r) => r.case === k);
      const h = runs[`head ${v}`].rows.find((r) => r.case === k);
      const mark = (r, arm) => {
        const t = `${r.leak ? '<span class="fail">[host path reaches the model]</span> ' : ''}${txt(r)}`;
        if (k === 'ipynbBehindLink') return arm === 'base' ? F(t) : P(t);
        if (k === 'ownWrite') return A(t);
        return t;
      };
      rows.push([`${label}<br><span class="dim">files/${v === 'v2' ? '2' : '1'}</span>`, mark(b, 'base'), mark(h, 'head')]);
    }
  }
  const d = (k) => JSON.stringify(runs[k].durable);
  figs['r6-02-r10-realstack'] = page(
    'R10-1 through the shipped topology: Harness → Java Broker → one worker per Session',
    'Packaged Hosted Harness of each arm, Spring server jar (Session Store + embedded Broker, production defaults <code>durable-local-process=true</code>, <code>trusted-local-reboot-recovery=true</code>), MySQL 8.4, Linux x86_64. Session at <code>app</code>; <code>app/ext</code> is a link to a directory outside every Workspace mount. The Harness refuses <code>..</code> and absolute spellings, so a link is the only way a model reaches an out-of-boundary target. <code>&lt;MOUNT&gt;</code> replaces the real mount path in this figure only.',
    table(['call', 'before (ee0a962d)', 'head (0d6a6307)'], rows, ['30%', '37%', '33%']) +
      `<div class="note ok">Durable side (<code>mysqldump</code>, rows whose payload carries the Jupyter build error): before <b>6</b> rows (4 <code>qwen_managed_session_resource</code>, 2 <code>qwen_tool_execution</code>), all quoting the host mount path; head <b>0</b>.</div>` +
      `<div class="note info">Every <code>write_file</code> through the link — and even into the Session's own directory <code>src</code> — is refused by Hosted file history before execution on both arms, so on this topology the reachable R10-1 path is the read-side build error. The own-file success text quotes the host path on both arms; that is the pre-existing output contract the PR leaves to a follow-up.</div>`,
  );
}
// ---------------------------------------------------------------- figure 3
{
  const rows = [];
  for (const [c, i, note] of [
    ['r11_1_glob_pattern_oracle', 0, 'root-bound caller, name present in the sibling'],
    ['r11_1_glob_pattern_oracle', 1, 'root-bound caller, name absent'],
    ['r11_1_glob_pattern_oracle', 2, 'prefix probe <code>b*</code> (a file starts with b)'],
    ['r11_1_glob_pattern_oracle', 3, 'prefix probe <code>c*</code> (none starts with c)'],
    ['r11_1_glob_pattern_oracle', 4, 'read_file of the present file'],
    ['r11_1_glob_pattern_oracle', 5, 'read_file of an absent file'],
    ['r11_3_ancestor_glob', 3, 'ancestor caller, name present in the nested Session'],
    ['r11_3_ancestor_glob', 4, 'ancestor caller, name absent'],
    ['r11_3_ancestor_glob', 2, 'ancestor caller, <code>**/*</code>'],
    ['r11_3_ancestor_glob', 0, 'ancestor caller, <code>**/*.md</code> (own files only)'],
  ]) {
    const h = row('head', c, i);
    const b = row('base', c, i);
    const same = b.status === h.status && b.text === h.text;
    const isGlob = h.tool === 'glob';
    const t = `<b>${h.status}</b><br>${short(h)}`;
    rows.push([note, call(h), isGlob && i < 4 && c.startsWith('r11_1') ? A(t) : isGlob && c.startsWith('r11_3') && i >= 3 ? A(t) : t, same ? '<span class="dim">same</span>' : `<b>${b.status}</b><br>${short(b)}`]);
  }
  figs['r6-03-pattern-oracle'] = page(
    'Residual: the per-pattern existence oracle survives through the pattern spelling',
    'Same real worker processes as figure 1, head <code>0d6a6307</code>. R11-1 moved the ownership check onto glob\'s <code>path</code>, so <code>path: services/api</code> now refuses matched and unmatched alike. The same search spelled in the <i>pattern</i> (no <code>path</code>) is still judged only on its output: a hit inside the other Session\'s estate refuses the whole result, no hit returns "No files found". Layouts: <code>session-root@.</code> + <code>session-1@services/api</code> holding <code>src/index.ts</code>, <code>src/billing-v2.ts</code>; <code>session-a@services</code> + <code>session-b@services/api</code>.',
    table(['probe', 'call', 'head (0d6a6307)', 'before (ee0a962d)'], rows, ['20%', '30%', '28%', '22%']) +
      `<div class="note">A caller learns, per pattern, whether another Session's private estate holds a matching name — including name prefixes one character at a time — while <code>read_file</code> answers the present and the absent file with the same refusal. This is the oracle the R11-1 reply describes as closed; it is closed for <code>path</code> only. A broad <code>**/*</code> from the ancestor fails outright once any Session is installed below it.</div>` +
      `<div class="note info">Reach: only a worker that hosts several Sessions of one mount. The shipped Java Broker refuses Workspace mounts unless isolation is per Session (S16 below: two Sessions, two bindings, two workers), and there a sibling's file is readable through a link by the documented R4-2 decision. So this is not a blocker for the shipped topology; it matters before any workspace-isolated provisioner hosts these profiles.</div>`,
  );
}
// ---------------------------------------------------------------- figure 4
{
  const log = fs.readFileSync(`${RIG}/out/run-r6-g3-head.log`, 'utf8');
  const res = [...log.matchAll(/^\[RESULT\] (\S+): (\d+) passed, (\d+) failed/gm)].map((m) => [m[1], +m[2], +m[3]]);
  const g = (f, re) => (fs.readFileSync(`${RIG}/out/g3/${f}.log`, 'utf8').match(re) ?? [])[1] ?? '?';
  const s19 = (k) => g('s19-r4-head-r6', new RegExp(`^\\[${k}\\] .*? (\\d+)ms wall=`, 'm'));
  const s19p = (k) => g('s19-r4-head-r6', new RegExp(`^\\[${k}\\] .*?prepared=(\\d)`, 'm'));
  const led = jl(`${RIG}/out/mutation/ledger.jsonl`);
  const regRows = [
    ['S1 profiles (/1 vs /2 declarations, pinning, 409 on switch)', P(`${res.find((r) => r[0].startsWith('s1-'))[1]}/12`)],
    ['S2 glob containment and pre-acquisition refusals', A(`${res.find((r) => r[0].startsWith('s2-'))[1]}/20 — the two brace cases are refused before acquisition (since round 3), as before`)],
    ['S4 truncation within both 64 KiB ceilings', P(`${res.find((r) => r[0].startsWith('s4-'))[1]}/8`)],
    ['S5 approval (glob pre-approved, write control)', P(`${res.find((r) => r[0].startsWith('s5-'))[1]}/3`)],
    ['S6 shell/2 through the route', A('glob + shell execute, reload keeps shell/2, load as shell/1 → 409. Probe misses: the expected tool list predates main\'s <code>monitor</code> (#13265); <code>captureBytes</code> needs an OSS backend this rig lacks (known since round 1)')],
    ['S9 coordinator takeover + continue (files/2, shell/2)', P(`${res.filter((r) => r[0].startsWith('s9-')).map((r) => `${r[1]}/${r[1] + r[2]}`).join(' · ')}`)],
    ['S16 two Sessions of one Workspace', `bindings ${esc(g('s16-sibling-head-v2', /^\[runtime bindings in this Workspace\] (.*)$/m))}: one worker per Session; through <code>peek → ../web</code> the sibling file is readable (documented R4-2 scope)`],
    ['S19 brace gate edges', `run: brace×6 (prepared ${s19p('brace6')}), {1..64}; refused before acquisition: brace×7, {1..65}, {1..20000}, nested×14 (prepared ${s19p('brace7')}/${s19p('range65')}/${s19p('range20000')}/${s19p('nested14')})`],
    ['S19 matcher cost (5 s deadline)', P(`+(?|?|?)Z ${s19('extglob3')} ms · *?×20+Z ${s19('star20')} ms · +(?|?)Z ${s19('extglob2')} ms — bounded error, Session not blocked`)],
    ['S22 cancel 1.5 s after submit', P(esc(g('s22-cancel-glob-head', /^\[cancel at 1\.5 s\] (cancel=\d+ idle after \d+ms)/m)) + '; next glob succeeds')],
    ['S23 symlinked roots / [.][.] climbing', P('same answers as round 5 (inward links spelled through the link, outward/absolute refused, no sibling listed)')],
  ];
  const mutRows = led
    .filter((r) => !r.id.startsWith('baseline'))
    .map((r) => [r.id, esc(r.what), r.verdict === 'KILLED' ? P(`killed — ${esc((r.failedNames ?? [])[0]?.split(' :: ')[1] ?? '')}`) : A(`survived (${r.passed}/${r.total})`)]);
  const base = led.filter((r) => r.id.startsWith('baseline'));
  figs['r6-04-regression'] = page(
    'Linux real stack, production Broker defaults: regression and mutation at 0d6a6307',
    `Same rig as figure 2 (head arm). Earlier rounds ran on macOS with #13211's Linux-only Broker defaults switched off; here they are on. Unit baselines at head: cli ${base.find((b) => b.id === 'baseline-cli').passed}/${base.find((b) => b.id === 'baseline-cli').total} (managed-context-worker, managed-runtime-tool-executor, hosted-workspace-tool-turn; 1 skipped), core ${base.find((b) => b.id === 'baseline-core').passed}/${base.find((b) => b.id === 'baseline-core').total} (glob, glob-search-worker).`,
    '<h2>Regression probes of rounds 1–5, re-run on Linux</h2>' +
      table(['scenario', 'result'], regRows, ['34%', '66%']) +
      '<h2>Mutants: one revert per fix of 0d6a6307, plus the two round-5 survivors</h2>' +
      table(['id', 'mutation', 'verdict'], mutRows, ['44px', '46%', '50%']),
  );
}

const browser = await chromium.launch({ executablePath: '/root/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell' });
for (const [name, html] of Object.entries(figs)) {
  const p = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: W + 60, height: 800 } });
  await p.setContent(html);
  const box = await p.locator('#card').boundingBox();
  await p.setViewportSize({ width: Math.ceil(box.width) + 20, height: Math.ceil(box.height) + 20 });
  await p.locator('#card').screenshot({ path: `${OUT}/${name}.png` });
  fs.writeFileSync(`${OUT}/${name}.html`, html);
  console.log(name, Math.round(box.width), 'x', Math.round(box.height));
  await p.close();
}
await browser.close();
