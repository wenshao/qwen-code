// VERIFICATION RIG ONLY (PR #13129): round-5 figure (head d5de4f1813) from the probe ledgers.
import fs from 'node:fs';
import { figs, render, page, table, OK, BAD, WARN, passed, count, res, RIG } from './figures.mjs';

const r5 = (n) => res('r5', n);
const lx5 = (n) => JSON.parse(fs.readFileSync(`${RIG}/lx/rig/out/lx5/${n}.json`, 'utf8'));
const note = (r, label) => r.rows.find((x) => x.label === label)?.detail ?? '';
const cancel = r5('s11-cancel-head7');
const lxCancel = lx5('s11-cancel-head7');
const stagePass = (r, l) => passed(r, `${l}: cancel mid-Hook`);
const idle = (r, l) => (r.rows.find((x) => x.label.startsWith(`${l}: cancel mid-Hook`))?.detail.match(/cancel→idle=(\d+)ms/) ?? [])[1];
const fn = ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop'];
const http = fn.map((s) => `${s} (HTTP Hook, server replies after 8 s)`);
const to = r5('s16-http-timeout-head7-fresh');
const ms = (l, k) => ((toLine(l).match(new RegExp(`${k} at (\\d+) ms`)) ?? [])[1] / 1000).toFixed(1);
const blocked = (l) => /outcome_unknown/.test(toLine(l)) && /admit=409/.test(toLine(l)) && /detach=503 other=.*hosted_turn_failed/.test(toLine(`${l}: detach, then another Session (no Hooks) in the same Workspace`));
const toLine = (l) => note(to, l);
const reg = ['s1-permission-head7', 's3-catalog-head7', 's4-prompt-head7', 's6-limits', 's8-secrets', 's10-baseline-head7', 's15-history-hooks-head7', 's2e-reattach-head7-ws-t6b'].map((n) => `${n.replace(/-head7.*$/, '')} ${count(r5(n))}`).join(' · ');

figs['08-round5'] = page(
  'Round 5 — head d5de4f1813 (HTTP completion evidence after cancel)',
  'Fresh databases: macOS MySQL 8.4.7 (r5) and Linux colima + delegated cgroup v2, MySQL 8.4.11 (lx5). HTTP Hook timeouts are in seconds (function timeouts in milliseconds).',
  table(
    ['Check', 'macOS', 'Linux'],
    [
      ['user cancels while an HTTP Hook waits (server answers after 8 s) — UserPromptSubmit / PreToolUse / PostToolUse / Stop', http.every((l) => stagePass(cancel, l)) ? OK(`4/4 cancelled + settled, next turn runs; cancel→idle ${http.map((l) => idle(cancel, l)).map((v) => (v / 1000).toFixed(1)).join(' / ')} s`) : BAD('fails'), http.every((l) => stagePass(lxCancel, l)) ? OK(`4/4; ${http.map((l) => idle(lxCancel, l)).map((v) => (v / 1000).toFixed(1)).join(' / ')} s`) : BAD('fails')],
      ['user cancels while a function Hook runs (4 stages)', fn.every((l) => stagePass(cancel, l)) ? OK(`4/4; cancel→idle ${fn.map((l) => idle(cancel, l)).map((v) => (v / 1000).toFixed(1)).join(' / ')} s`) : BAD('fails'), fn.every((l) => stagePass(lxCancel, l)) ? OK('4/4') : BAD('fails')],
      ['function callback ignores the abort (8 s)', WARN('unknown → blocked (documented)'), WARN('same')],
      ['HTTP Hook timeout 15 s, server never replies, no cancel', blocked('server never replies, no cancel') ? BAD(`idle at ${ms('server never replies, no cancel', 'idle')} s → outcome_unknown: next prompt 409, detach 503, another Session (no Hooks) in the Workspace hosted_turn_failed`) : OK('recovers'), '—'],
      ['… same, user cancels after 2 s', blocked('server never replies, user cancels') ? WARN(`cancel at ${ms('server never replies, user cancels', 'cancel')} s takes effect only at the timeout (idle at ${ms('server never replies, user cancels', 'idle')} s); then the same unknown, Session + Workspace blocked`) : OK('recovers'), '—'],
      ['… server answers after 5 s (control)', /turn_complete/.test(toLine('server replies after 5 s (control)')) ? OK('completes') : BAD('fails'), '—'],
      ['default HTTP Hook timeout (DEFAULT_HTTP_HOOK_TIMEOUT_SECONDS)', WARN('600 s: a cancel during a hung HTTP Hook can take up to 10 min, then ends unknown'), '—'],
      ['regression (real stack)', OK(reg), OK(`s9-linux ${count(lx5('s9-linux-99db'))} · F1 SIGKILL ${passed(lx5('s2b-lease-head7-ws-t1-yes-SIGKILL'), 'A turn after cold load') ? 'holds' : 'fails'} · lost ack ${count(lx5('s5b-lost-head7-ws-t9b'))}`)],
    ],
  ),
);
await render(['08-round5']);
