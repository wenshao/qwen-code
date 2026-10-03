// VERIFICATION RIG ONLY (PR #13243): evidence figures rendered from the s43 probe ledgers and the Windows
// probe artifact. Cell text comes from the ledgers; only labels and the ok/bad colouring are written here.
// usage: node fig43.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
const RIG = '/Users/wenshao/pr13129-rig';
const require = createRequire(`${RIG}/wt43/package.json`);
const { chromium } = require('playwright');
const OUT = `${RIG}/fig43`;
fs.mkdirSync(OUT, { recursive: true });
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const load = (db, arm) => JSON.parse(fs.readFileSync(`${RIG}/out/${db}/s43-${arm}.json`, 'utf8'));
const get = (r, scenarioPrefix, key) => {
  const o = r.obs.find((x) => x.scenario.startsWith(scenarioPrefix) && x.key === key);
  if (!o) throw new Error(`missing ${scenarioPrefix} / ${key} in ${r.name}`);
  return String(o.value);
};

// Compress one ledger value into a short cell.
function brief(v) {
  let m;
  if ((m = v.match(/STILL ACTIVE after (\d+) ms/))) return `still running after ${(m[1] / 1000).toFixed(0)} s`;
  if ((m = v.match(/STILL ACTIVE (\d+) ms after cancel/))) return `cancel 204; still running ${(m[1] / 1000).toFixed(0)} s later`;
  if ((m = v.match(/^admit=(\d+) (\S+) \((\d+) ms\)/))) return `refused ${m[1]} ${m[2]}`;
  if ((m = v.match(/admit=202 terminal=(.*?) idle after (\d+) ms recoveryBlocked=(\w+)/))) {
    let t = m[1];
    const code = t.match(/"code":"([^"]+)"/);
    if (t.startsWith('turn_error')) t = `turn_error ${code ? code[1] : ''}`;
    if (t === '<none>') t = 'ended, no turn event';
    return `${t} · ${m[2]} ms${m[3] === 'true' ? ' · recoveryBlocked' : ''}`;
  }
  if ((m = v.match(/idle after (\d+) ms terminal=(\S+)/))) return `${m[2]} after ${m[1]} ms`;
  if ((m = v.match(/idle (\d+) ms after cancel terminal=(\S+)/))) return `${m[2]} ${(m[1] / 1000).toFixed(1)} s after cancel`;
  if ((m = v.match(/^(\d{3})( [a-z_]+)? \((\d+) ms\)/))) return `${m[1]}${m[2] ?? ''}`;
  return v;
}
const css = `
  body{margin:0;background:#fcfcfb;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;color:#0b0b0b}
  #card{width:1180px;padding:22px 26px 24px;background:#fcfcfb;border:1px solid #d9d8d4;border-radius:10px}
  h1{font-size:19px;margin:0 0 4px;font-weight:650}
  .sub{font-size:13px;color:#52514e;margin:0 0 12px;line-height:1.45}
  h2{font-size:14px;margin:14px 0 6px}
  table{border-collapse:collapse;width:100%;font-size:12.5px;margin:4px 0 10px;table-layout:fixed}
  th,td{border:1px solid #d9d8d4;padding:5px 8px;text-align:left;vertical-align:top;line-height:1.4;overflow-wrap:anywhere}
  th{background:#f0efec;color:#52514e;font-weight:600}
  td.sc{font-weight:600;background:#f6f5f2}
  .ok{color:#0a7a0a;font-weight:600}.bad{color:#b42727;font-weight:600}.warn{color:#8a5a00;font-weight:600}.same{color:#52514e}
  code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;background:#f0efec;padding:1px 4px;border-radius:4px}
  .note{font-size:12.5px;border-left:3px solid #8a5a00;background:#f6f5f2;padding:7px 10px;margin:8px 0;line-height:1.5}
  .note.nbad{border-left-color:#b42727}.note.nok{border-left-color:#0a7a0a}
`;
const page = (title, sub, body) => `<!doctype html><meta charset="utf-8"><style>${css}</style><div id="card"><h1>${title}</h1><p class="sub">${sub}</p>${body}</div>`;
const cell = (c) => (c && typeof c === 'object' ? `<td class="${c.c}">${esc(c.t)}</td>` : `<td>${esc(c ?? '')}</td>`);
const table = (head, rows, widths) =>
  `<table>${widths ? `<colgroup>${widths.map((w) => `<col style="width:${w}">`).join('')}</colgroup>` : ''}<tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr>${rows
    .map((r) => (r.section ? `<tr><td class="sc" colspan="${head.length}">${esc(r.section)}</td></tr>` : `<tr>${r.map(cell).join('')}</tr>`))
    .join('')}</table>`;
const OK = (t) => ({ c: 'ok', t: `✔ ${t}` });
const BAD = (t) => ({ c: 'bad', t: `✘ ${t}` });
const WARN = (t) => ({ c: 'warn', t: `▲ ${t}` });
const SAME = (t) => ({ c: 'same', t });

const base = load('r43b', 'b43');
const head = load('r43f', 'h43f');
const head2 = load('r43f2', 'h43f');
const ffc4 = load('r43h', 'h43');
const mut = load('r43m', 'h43m');
const figs = {};

// ---- Figure 1: base vs head across the scenarios.
{
  const B = (s, k) => brief(get(base, s, k));
  const H = (s, k) => brief(get(head, s, k));
  const H2 = (s, k) => brief(get(head2, s, k));
  const rows = [
    { section: 'S1  handler module never settles (top-level await on a promise that never resolves), manifest timeout 2000 ms' },
    ['turn', BAD(B('S1', 'turn')), OK(H('S1', 'turn'))],
    ['cancel', BAD(B('S1', 'cancel')), SAME('n/a — turn already ended')],
    ['next prompt, same Session', WARN(B('S1', 'next prompt, same Session')), WARN(H('S1', 'next prompt, same Session'))],
    ['detach', WARN(B('S1', 'detach')), WARN(H('S1', 'detach'))],
    ['other Session, same Workspace, no Hooks', BAD(B('S1', 'neighbour Session (no Hooks, same Workspace)')), BAD(H('S1', 'neighbour Session (no Hooks, same Workspace)'))],
    { section: 'S2b  user cancels while the module is still evaluating (manifest timeout 60 s); module finishes later' },
    ['cancel → turn ends', BAD(B('S2 ', 'turn after gate opened') + ' — only when the probe released the module'), OK(H2('S2b', 'cancel'))],
    ['next turn after the module finished', OK(B('S2b', 'next prompt after evaluation finished')), OK(H2('S2b', 'next prompt after evaluation finished'))],
    ['detach', OK(B('S2b', 'detach')), OK(H2('S2b', 'detach'))],
    { section: 'S3 / S4  finite evaluation vs budget = max(manifest timeout, 500 ms)' },
    ['S3  300 ms evaluation, timeout 10', OK(B('S3', 'turn')), OK(H('S3', 'turn'))],
    ['S4b 1500 ms evaluation, timeout 3000', OK(B('S4b', 'turn')), OK(H('S4b', 'turn'))],
    ['S4a 1500 ms evaluation, timeout 10 — turn', OK(B('S4a', 'turn')), WARN(H('S4a', 'turn') + ' · outcome_unknown')],
    ['S4a next prompt / detach / load', OK(`${B('S4a', 'next prompt, same Session')} / ${B('S4a', 'detach')} / ${B('S4a', 'load')}`), BAD(`${H('S4a', 'next prompt, same Session')} / ${H('S4a', 'detach')} / ${H('S4a', 'load')}`)],
    ['S4a other Session, same Workspace', OK(B('S4a', 'neighbour Session (no Hooks, same Workspace)')), BAD(H('S4a', 'neighbour Session (no Hooks, same Workspace)'))],
    { section: 'S5  module throws at top level (genuine import failure)' },
    ['turn / record', SAME(`${B('S5', 'turn')} · ${get(base, 'S5', 'hook execution record').split(' | ').at(-1)}`), SAME(`${H('S5', 'turn')} · ${get(head, 'S5', 'hook execution record').split(' | ').at(-1)}`)],
    ['next prompt / detach', SAME(`${B('S5', 'next prompt, same Session')} / ${B('S5', 'detach')}`), SAME(`${H('S5', 'next prompt, same Session')} / ${H('S5', 'detach')}`)],
    { section: 'S7  DELETE /session after a cancel, module still evaluating' },
    ['DELETE while evaluating', SAME(B('S7', 'DELETE while evaluation pending')), SAME(H('S7', 'DELETE while evaluation pending'))],
    ['DELETE after the module finished · lease after', OK(`${B('S7', 'DELETE after evaluation finished')} · lease ${get(base, 'S7', 'lease holder after DELETE')}`), OK(`${H('S7', 'DELETE after evaluation finished')} · lease ${get(head, 'S7', 'lease holder after DELETE')}`)],
  ];
  figs['01-real-stack-ab'] = page(
    'PR #13243 — managed function-hook module evaluation on the real Hosted stack',
    'Real MySQL 8.4.7 + server fat jar (Session Store + embedded Runtime Broker + local-process workers) + packaged Hosted Harness; scripted model. Each scenario uses its own Workspace and a UserPromptSubmit function Hook whose handler module\'s top-level code is the variable. Worker and Harness run the same build.',
    table(['step', 'base <code>0f140e3a5d</code> (merge-base)', 'head <code>f8775584fe</code>'], rows, ['25%', '37.5%', '37.5%']) +
      `<div class="note nok">The R4-1 wedge is real on base and gone on head: a never-settling module no longer pins the turn (S1), and a cancel during evaluation ends the turn at once instead of when the module finishes (S2b).</div>` +
      `<div class="note">Over-budget evaluation (S4a) is now fenced as <code>outcome_unknown</code>: on the hosted stack that blocks the Session, refuses detach and load, and keeps the Workspace lease, so other Sessions in the Workspace fail too — the same blast radius as an HTTP Hook timeout (#13133). Base ran the same module normally.</div>`,
  );
}

// ---- Figure 2: refused detach while evaluating -> Broker row RELEASING -> next Hook turn bricked (S2d).
{
  const arms = [
    ['base 0f140e3a5d', load('r43b2', 'b43')],
    ['ffc4e0ff84', load('r43h2', 'h43')],
    ['head f8775584fe', load('r43f3', 'h43f')],
  ];
  const steps = [
    ['1 cancel while module evaluates', '1 cancel'],
    ['2 detach while module evaluates', '2 detach while evaluation pending'],
    ['3 module finishes', '3 evaluation finished'],
    ['4 next Hook turn', '4 next Hook turn'],
    ['5 detach', '5 detach'],
    ['6 another prompt', '6 another prompt'],
  ];
  const short = (v) => {
    const broker = v.match(/broker=(.*)$/)?.[1]?.replace(/hooks-activation-[0-9a-f]+…\s*/g, '') ?? '';
    const main = brief(v.replace(/\s*broker=.*$/, '').replace(/status\.recoveryBlocked=/, 'recoveryBlocked=').replace(/ hasActivePrompt=\w+/, ''));
    return `${main}${broker ? `  ‖ Broker row: ${broker}` : ''}`;
  };
  const rows = steps.map(([label, key]) => [label, ...arms.map(([, r]) => { const v = short(get(r, 'S2d', key)); return SAME(v.includes('404 hosted_session_not_found') ? `${v} (detached at step 5)` : v); })]);
  const px = load('r43f4', 'h43f');
  const traffic = (k) => get(px, 'S2d', k).split(' || ').filter((x) => !x.includes('runtimes:warm')).map((x) => x.replace(/hooks-activation-[0-9a-f]+/, '<owner>')).join('; ');
  rows.push(['Harness→Broker, head rerun behind a recording proxy', SAME('—'), SAME('—'), { c: 'bad', t: `step 2: ${traffic('2 Harness->Broker')} · step 4: ${traffic('4 Harness->Broker')}` }]);
  rows.push(['S2b control: same sequence without step 2', SAME('see figure 1'), SAME('—'), OK(brief(get(head2, 'S2b', 'next prompt after evaluation finished')))]);
  figs['02-refused-detach'] = page(
    'A detach refused by the hold leaves the Hook owner RELEASING — the Session never runs a Hook turn again',
    'S2d: UserPromptSubmit function Hook whose module awaits a gate file at top level (manifest timeout 60 s). "Broker row" is qwen_runtime_session.session_state of the Session\'s hooks-activation owner, read from MySQL after each step.',
    table(['step', 'base <code>0f140e3a5d</code>', '<code>ffc4e0ff84</code>', 'head <code>f8775584fe</code>'], rows, ['19%', '27%', '27%', '27%']) +
      `<div class="note nbad">Root cause (Broker): <code>RuntimeBrokerService.release()</code> persists RELEASING (<code>transitionSessionToReleasing</code>, :1353) before the worker answers; the worker refuses because <code>hasHolds()</code> still sees the abandoned evaluation, and the error path (:1365-1368) only resets the in-memory context. The row stays RELEASING, the next <code>hook-execute</code> on that owner is refused <code>409 runtime_session_not_ready</code> and recorded <code>outcome_unknown</code>, so the Session is permanently recovery-blocked. f8775584fe renames the 503 but does not change the outcome; base cannot reach this state because its detach gets 409 <code>hosted_turn_active</code> while the turn is still running.</div>`,
  );
}

// ---- Figure 3: Harness replacement while evaluating (S6): base, head, head without the 409 tolerance.
{
  const arms = [
    ['base 0f140e3a5d', base],
    ['head f8775584fe', head],
    ['head − 409 tolerance (mutant)', mut],
  ];
  const keys = [
    ['cancel (old Harness)', 'cancel'],
    ['load in replacement Harness', 'load in new Harness'],
    ['Hook turn, module still evaluating', 'Hook turn in new Harness, evaluation still pending'],
    ['lease holder', 'lease holder'],
    ['Hook turn after module finished', 'Hook turn after evaluation finished'],
    ['detach', 'detach'],
  ];
  const rows = keys.map(([label, key]) => [label, ...arms.map(([, r]) => {
    let v = get(r, 'S6', key);
    if (key === 'lease holder') v = v === get(r, 'S6', 'lease holder before replacement') ? 'earlier owner (unchanged)' : v.slice(0, 40);
    if (key === 'load in new Harness') v = v.replace(/^(\d+) \((\d+) ms\) after (\d+) ms/, (_, s, __, t) => `${s} after ${(t / 1000).toFixed(0)} s (writer lease)`);
    return SAME(brief(v));
  })]);
  const herr = (db, arm) => (fs.readFileSync(`${RIG}/run/${db}/harness-s43-${arm}-r-0.log`, 'utf8').match(/turn \S+ failed: Error: (.*)/)?.[1] ?? '—');
  rows.splice(3, 0, ['Harness error for that turn', SAME(herr('r43b', 'b43')), SAME(herr('r43f', 'h43f')), SAME(herr('r43m', 'h43m'))]);
  figs['03-harness-replacement'] = page(
    'Replacement Harness after a cancel during evaluation (S6) — the 409 tolerance moves the failure, it does not avoid it',
    'Old Harness SIGKILLed while the cancelled operation\'s module is still evaluating in the worker; a new Harness loads the Session once the writer lease lapses and runs a Hook turn. The mutant is head with <code>holdFenced</code> forced false in <code>releaseEarlierOwners</code> (bundle patch).',
    table(['step', 'base <code>0f140e3a5d</code>', 'head <code>f8775584fe</code>', 'head without the 409 tolerance'], rows, ['22%', '26%', '26%', '26%']),
  );
}

// ---- Figure 4: Windows — upstream nightly + fork probe on windows-2022.
{
  const W = `${RIG}/out/r43/windows`;
  const pj = fs.readdirSync(W).filter((f) => /^probe-.*\.txt$/.test(f)).flatMap((f) => fs.readFileSync(`${W}/${f}`, 'utf8').split('\n')).filter((l) => l.startsWith('PROBE_JSON ')).map((l) => JSON.parse(l.slice(11)));
  const plain = pj.find((x) => x.probe === 'plain-node-import');
  const runner = fs.readFileSync(`${W}/job.log`, 'utf8').match(/PROBE_JSON (\{"probe":"runner"[^\n]*\})/);
  const rf = runner ? JSON.parse(runner[1]) : {};
  const arm = (a) => pj.filter((x) => x.arm === a);
  const armRow = (a, label) => {
    const xs = arm(a);
    const ok = xs.length > 0 && xs.every((x) => x.exit === 0 && x.ignoreAbort.startsWith('✓'));
    const tests = [...new Set(xs.map((x) => x.tests))].join(' / ');
    const ms = xs.map((x) => x.ignoreAbort.match(/(\d+)ms$/)?.[1]).join(', ');
    return [{ c: '', t: label }, (ok ? OK : BAD)(`${xs.filter((x) => x.exit === 0).length}/${xs.length} runs exit 0 · ${tests}`), (ok ? OK : BAD)(`passed in every run (${ms} ms)`)];
  };
  const nightly = fs.readFileSync(`${W}/nightly-excerpt.txt`, 'utf8').trim().split('\n');
  figs['04-windows'] = page(
    'Windows: the raw-path test import was never red under vitest; plain Node does reject it',
    `Upstream nightly on main after #13129, and a probe on a GitHub-hosted runner (${esc(rf.os ?? '?')}, Node ${esc(rf.node ?? '?')}, probe commit ${esc((rf.head ?? '').slice(0, 10))} = PR head f8775584fe + workflow). Files: managed-hook-runtime.test.ts + hosted-hook-session.test.ts.`,
    `<h2>Upstream nightly, test_windows</h2>` +
      table(['source', 'result'], [[nightly[0], SAME(nightly.slice(1).join(' · '))]], ['30%', '70%']) +
      `<h2>Fork probe</h2>` +
      table(['arm', 'vitest', '(ignore-abort) case'], [
        armRow('head', 'head f8775584fe, ×5'),
        armRow('rawimport', 'head with only the test import reverted to await import(modulePath), ×2'),
        armRow('base', 'merge-base code + tests (raw-path import), ×3'),
      ], ['34%', '33%', '33%']) +
      table(['plain Node, outside vitest', 'raw C:\\…\\handler.mjs', 'pathToFileURL(...).href'], [[`${plain.platform} ${plain.node}`, (plain.raw === 'ok' ? OK : WARN)(plain.raw), (plain.fileUrl === 'ok' ? OK : BAD)(plain.fileUrl)]], ['34%', '33%', '33%']) +
      `<div class="note">The PR's premise for R4-2 ("the test fails on windows-latest") does not hold: under vitest the test file's <code>import()</code> of a raw <code>C:\\…</code> path resolves (it goes through vitest's module runner, not Node's loader directly). The production import already used <code>pathToFileURL</code>; plain Node shows why. The test change is harmless consistency, not a fix. The new evaluation tests are stable on Windows (5/5).</div>`,
  );
}

const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(figs);
const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1280, height: 900 } });
const pg = await ctx.newPage();
for (const name of names) {
  const file = `${OUT}/${name}.html`;
  fs.writeFileSync(file, figs[name]);
  await pg.goto(`file://${file}`);
  const clipped = await pg.evaluate(() => [...document.querySelectorAll('td,pre')].filter((e) => e.scrollWidth > e.clientWidth + 1).length);
  await pg.locator('#card').screenshot({ path: `${OUT}/${name}.png` });
  console.log(`${name}.png ${clipped ? `(${clipped} clipped cells!)` : 'ok'}`);
}
await browser.close();
