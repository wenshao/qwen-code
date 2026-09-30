// VERIFICATION RIG ONLY (PR #13112): result and finding tables, from the probe logs under out/.
import fs from 'node:fs';

export default ({ page, table, P, F, A, N }) => {
  const RIG = '/Users/wenshao/pr13112-rig';
  const figs = {};
  figs['03-results'] = page(
    'What was run, and what held',
    'Spring fat jar + embedded Runtime Broker + packaged Hosted Harness (dist/cli.js built from the head), native MySQL 8.4.7, Playwright on the real Managed panel. Arms: main <code>51b80dad</code>, PR head <code>f2a028b</code>, trial merges with the conflict resolved by keeping both tests: head ⊕ <code>51b80dad</code> and head ⊕ <code>afb911a3</code> (main moved during the run: #13088, #13117, #13097).',
    table(['Check', 'main 51b80dad', 'PR head f2a028b', 'head ⊕ 51b80dad', 'head ⊕ afb911a3'], [
      ['managed-agent-server unit suite (surefire, H2)', '—', P('256 / 256'), P('257 / 257'), P('281 / 281')],
      ['HostedPublicWorkspaceIT on MySQL 8.4.7 (later Turn, cancel, rename)', '—', P('2 / 2'), P('2 / 2'), P('2 / 2')],
      ['web-shell: eslint + prettier (6 files), tsc, managed vitest, generated types', '—', P('clean · 38 / 38 · regen = no diff'), '—', '—'],
      ['S1 later Turn / cancel / rename / lifecycle — REST + WebShell adapter', P('15 / 15 (creator 409 = before)'), P('51 / 51'), '—', P('51 / 51')],
      ['S2 same Sessions restarted without the opt-in', '—', P('6 / 6 (all 409)'), '—', '—'],
      ['S3 approval mode "default": later Turn, cancel while an Action waits', '—', P('15 / 15'), '—', '—'],
      ['S7 real Managed panel (Playwright)', P('2 / 2 (read-only)'), P('7 / 7'), '—', '—'],
      ['S9 real model qwen3.8-max, three Turns', '—', P('5 / 5'), '—', '—'],
      ['S4 grant / Workspace state drift after creation', '—', A('fails closed · F4'), '—', '—'],
      ['S6 cancel vs Workspace authorization refusal / lost POST', '—', F('cancel lost · F1'), '—', F('same')],
      ['S5/S8 Runtime worker gone (crash, restarts)', '—', F('Session stuck · F2'), '—', F('same')],
      ['WebShell sessions/query cost', 'static capability', A('+2 point queries / bound row'), '—', '—'],
      ['Mutation: 17 mutants on the PR lines', '—', A('14 / 17 killed; J11 equivalent'), '—', '—'],
      ['… plus candidate-tests.patch (+21 lines)', '—', P('16 / 17 (J2, J6 now killed)'), '—', '—'],
    ]),
  );
  figs['04-f1-cancel-lost'] = page(
    'F1 — a cancel that meets a Workspace authorization refusal is dropped, and the Turn keeps writing',
    'Rig model holds its reply 8 s, then asks for one <code>write_file</code>. The creator cancels at ~0.5 s. <code>cancelAdmittedTurn</code> goes through <code>createOrLoad</code>, which runs <code>WorkspaceExecutionStore.authorize</code>; any exception is logged once (“cancellation will recover”) and nothing re-sends the cancel.',
    table(['At the moment of the cancel', 'cancel', 'POST /cancel reached the Harness', 'Turn ends', 'child/late-*.txt'], [
      ['nothing (control)', P('202'), P('yes, model request aborted after 70 ms'), P('CANCELLED 2.6 s'), P('not written')],
      ['creator’s <code>can_create</code> revoked for 1 s', A('202'), F('no'), F('COMPLETED 10.1 s'), F('written-after-cancel')],
      ['Workspace <code>DRAINING</code> for 1 s', A('202'), F('no'), F('COMPLETED 9.8 s'), F('written-after-cancel')],
      ['one POST /cancel dropped by the proxy — bound Session', A('202'), F('1 attempt, never retried'), F('COMPLETED'), F('written-after-cancel')],
      ['one POST /cancel dropped — unbound Session (path unchanged by the PR)', A('202'), F('1 attempt, never retried'), A('FAILED hosted_turn_failed'), 'n/a (no tools)'],
      ['grant stays revoked, model call held', A('202'), F('no'), F('CANCELLING ≈ 19 min, ended only when Spring restarted without the opt-in'), '—'],
    ]) +
      '<div class="note">The one-shot cancel is inherited (the unbound row). What the PR adds: bound Sessions now reach this path, so a lost cancel lets the Turn keep changing the Workspace, and the authorization check inside <code>createOrLoad</code> is a deterministic way to lose it — exactly when an operator drains a Workspace or revokes a grant.</div>',
  );
  figs['05-f2-runtime-lost'] = page(
    'F2 — once a bound Session’s Runtime worker is gone, that Session can never take another Turn',
    'Runtime bindings are per Session. After the worker exits the Broker either marks the binding LOST (worker crash while running) or keeps a READY binding that points at a dead endpoint (after a restart). No later Turn re-provisions it. Lifecycle stays gated, so the Session cannot be closed, archived or deleted either.',
    table(['Event', 'bound Session created before', 'new bound Session, same Workspace', 'unbound control'], [
      ['Spring restarts, Harness keeps running', A('load 409 → hosted_harness_unavailable 33 s (inherited)'), '—', A('same 409 (inherited)')],
      ['Runtime worker crashes, stack keeps running', F('binding LOST; 3 / 3 later Turns hosted_turn_failed in ≈ 0.5 s'), '—', 'n/a'],
      ['Harness + Spring stopped with TERM and restarted (workers exit with them)', F('33.7 s hosted_harness_unavailable, then hosted_turn_failed 8.4 s / 30.3 s'), P('COMPLETED 1.1 s'), P('COMPLETED')],
      ['Host restart (all processes gone)', F('hosted_turn_failed 30.5 s, every attempt (2 Sessions)'), P('COMPLETED 1.1 s (2 Workspaces)'), P('COMPLETED')],
    ]) +
      '<div class="note">The model is called and the history is intact (userTurns=7); the first tool call times out against the stale Runtime. On main this could not surface: a bound Session never took a second Turn. Under the opt-in it is the first thing a deploy or a worker crash does to every open conversation.</div>',
  );
  return figs;
};
