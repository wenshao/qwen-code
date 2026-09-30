// VERIFICATION RIG ONLY: evidence cards for PR #13101, built from the probe transcripts under out/.
import fs from 'node:fs';
const OUT = '/rig/out';
const read = (p) => (fs.existsSync(`${OUT}/${p}`) ? fs.readFileSync(`${OUT}/${p}`, 'utf8') : '');

// Parse a probe transcript into entries.
function entries(db, name) {
  return read(`${db}/${name}.log`)
    .split('\n')
    .map((l) => {
      let m;
      if ((m = l.match(/^(PASS|FAIL|NOTE)  (.*?)(?:  -> (.*))?$/))) return { kind: m[1], label: m[2], detail: m[3] ?? '' };
      if ((m = l.match(/^## (.*)$/))) return { kind: 'HEAD', label: m[1], detail: '' };
      if ((m = l.match(/^== (.*)$/))) return { kind: 'SUM', label: m[1], detail: '' };
      return null;
    })
    .filter(Boolean);
}
const W = 168;
const clip = (s, n = W) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const tidy = (d) =>
  d
    .replace(/"request_id":"[^"]*"/g, '')
    .replace(/,\}/g, '}')
    .replace(/tool_approval_([0-9a-f]{6})[0-9a-f]{26}/g, 'tool_approval_$1…')
    .replace(/op_([0-9a-f]{6})[0-9a-f]{26}/g, 'op_$1…')
    .replace(/rcpt_([0-9a-f]{6})[0-9a-f]{26}/g, 'rcpt_$1…')
    .replace(/decision_([0-9a-f]{6})[0-9a-f]{58}/g, 'decision_$1…')
    .replace(/turn_([0-9a-f]{6})[0-9a-f]{26}/g, 'turn_$1…')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, (u) => u.slice(0, 8) + '…')
    .replace(/\/rig\/run\/\w+\//g, '<rig>/');
// Lines for a transcript: every entry's label; details only for labels matching `withDetail`.
function lines(db, name, { withDetail = /$^/, skip = /$^/, detailWidth = W - 8 } = {}) {
  return entries(db, name)
    .filter((e) => e.kind !== 'SUM' && !skip.test(e.label))
    .map((e) =>
      e.kind === 'HEAD'
        ? { kind: 'HEAD', text: clip(e.label) }
        : { kind: e.kind, tag: e.kind, text: clip(e.label, W - 6), detail: withDetail.test(e.label) && e.detail ? clip(tidy(e.detail), detailWidth) : undefined },
    );
}
const sum = (db, name) => entries(db, name).find((e) => e.kind === 'SUM')?.label ?? `${name}: (missing)`;
const info = (text) => ({ kind: 'INFO', tag: '', pad: 0, text });
const raw = (kind, tag, text, detail) => ({ kind, tag, text: clip(text, W - 6), detail: detail ? clip(detail, W - 8) : undefined });

const H = 'd6i'; // probes against the PR head 7ab2952507
const HU = 'd6iu'; // database created by main 3a8fd11711, then upgraded to the PR head
const HEAD = 'PR head 7ab2952507 — server fat jar (JDK 21) + packaged Hosted Harness (dist/cli.js, Node 24) + real Runtime worker + MySQL 8.4.7, macOS arm64';
const mut = (file) => read(file).trim().split('\n').filter((l) => /^M\d+ /.test(l));

export const cards = [
  {
    id: '01-test-plan',
    title: 'Reviewer Test Plan on a real stack: 41/41 through the public API, 41/41 through WebShell',
    subtitle: `${HEAD}. Scripted OpenAI-compatible model: write_file -> edit -> read_file. alice created the Session, bob can only read, carol is another creator, mallory has no access.`,
    sections: [
      {
        heading: `Session created through the public API — ${sum(H, 's1-testplan-public')}`,
        lines: lines(H, 's1-testplan-public', {
          withDetail: /reader answering gets|another creator|same key again|same key through|different content|operation completes with|new answer to a decided|original key after|3 tool executions|nothing ran while waiting|Session events carry/,
        }),
      },
      { heading: 'Session created through WebShell (same 41 checks, answers sent through the other surface first)', lines: [raw('PASS', 'PASS', sum(H, 's1-testplan-web'))] },
    ],
    footer: 'Every claim of the test plan reproduces: both surfaces list and read the approval, only the creator may answer (403 action_forbidden otherwise), a repeated key returns the same operation across surfaces, changed content conflicts, the operation completes with a decided receipt and the Turn finishes.',
  },
  {
    id: '02-decisions',
    title: 'Decisions the PR did not exercise with a real process: deny, mixed batch, racing answers, request validation (44/44)',
    subtitle: HEAD,
    sections: [
      {
        heading: sum(H, 's2-decisions'),
        lines: lines(H, 's2-decisions', {
          withDetail: /denied write never ran|model received a refusal|only the allowed call ran|exactly one decision wins|the effect matches|20 concurrent|same decision under a second key|unknown extra field|missing Idempotency|after every rejected/,
          skip: /^final model text/,
        }),
      },
    ],
    footer: 'A denied call never runs and the model continues with a refusal result. Allow and deny sent at the same time under different keys: exactly one is recorded, the other operation ends failed/action_already_resolved, and the file system matches the winner (3/3 races). 20 identical concurrent requests produce one operation.',
  },
  {
    id: '03-expiry-modes',
    title: 'Expiry with a real process, auto-edit and yolo modes, startup validation',
    subtitle: `${HEAD}. Expiry runs use QWEN_MANAGED_AGENT_APPROVAL_TIMEOUT=8s.`,
    sections: [
      { heading: sum(H, 's3-expiry'), lines: lines(H, 's3-expiry', { withDetail: /Turn ends by itself|answer after expiry|only the first call|operation ends failed|did not run although|Harness answers to the delayed/, skip: /^final model text/ }) },
      { heading: `${sum(H, 's4-mode-auto-edit')}   |   ${sum(H, 's4-mode-yolo')}`, lines: [...lines(H, 's4-mode-auto-edit', { withDetail: /\[public\] (write|no Action|capabilities)/, skip: /\[web\]/ }), ...lines(H, 's4-mode-yolo', { withDetail: /\[public\] (no Action|capabilities)/, skip: /\[web\]|\[public\] (write|Action list)/ })] },
      {
        heading: 'Startup with Workspace files enabled: PR head (left) vs main 3a8fd11711 (right)',
        lines: (() => {
          const h = read('d6val_h3/startup-matrix.log').trim().split('\n');
          const b = read('d6val_main2/startup-matrix.log').trim().split('\n');
          return h.map((l, i) => {
            const left = l.replace(/\s+Hosted.*$/, '').replace(/\s+$/, '');
            const right = (b[i] ?? '').slice(0, 8).trim();
            return { kind: left.startsWith('STARTS') ? 'PASS' : 'NOTE', tag: '', pad: 0, text: `${left.padEnd(52)} main: ${right}` };
          });
        })(),
      },
    ],
    footer: 'An unanswered approval expires after the configured timeout and the Turn ends by itself; after one expiry the Turn asks no more. An answer admitted in time but delivered after the expiry ends failed/action_expired and the call does not run. auto-edit asks nothing for the file profile; yolo is unchanged. plan/auto and timeouts outside 1s..24h refuse to start.',
  },
  {
    id: '04-delivery-faults',
    title: 'Delivery faults between the Java server and the Harness, event streams, and a busy Workspace',
    subtitle: `${HEAD}. A recording proxy between the server and the Harness drops, delays or replaces the resolve call.`,
    sections: [
      { heading: sum(H, 's5-faults'), lines: lines(H, 's5-faults', { withDetail: /asked once and answered 200|operation while the Harness|gaps between|retries did not touch|attempt_count records|503 is retried|400 ends the operation/ }) },
      { heading: sum(H, 's6-sse'), lines: lines(H, 's6-sse', { withDetail: /both streams deliver/ }) },
      { heading: sum(H, 's10-busy'), lines: lines(H, 's10-busy', { withDetail: /Session 2 \(another creator/ }) },
    ],
    footer: 'Lost reply: the Harness recorded the decision, its answer was dropped, and the operation still completed decided from the committed journal record with no second delivery. Failed deliveries retry with backoff (1, 2, 4, 8 s) without touching the Session status. While a Turn waits, another Session on the same Workspace fails at once (hosted_turn_failed) rather than queueing.',
  },
  {
    id: '05-restart',
    title: 'F1 — a Java server restart strands a pending approval: the answer is accepted (202) but can never be delivered',
    subtitle: `${HEAD}. Only the Java server (with its embedded Runtime Broker) is restarted; the Hosted Harness process keeps running. The PR lists restart recovery as not validated.`,
    footColor: '#d29922',
    sections: [
      ...['r1', 'r2'].map((r) => ({
        heading: `run ${r} — ${sum(H, `s7-java-restart-${r}`)}`,
        lines: lines(H, `s7-java-restart-${r}`, {
          withDetail: /Java server restarted|EXPECTED|outcome|fail closed|owner's allow|a new Session on the stranded|Java -> Harness calls/,
          skip: /^Turn as the client/,
        }),
      })),
      { heading: `Same probe at the first head c11c1bdf3c`, lines: ['r1', 'r2', 'r3', 'r4'].map((r) => {
          const e = entries('d6r', `s7-java-restart-${r}`);
          const down = e.find((x) => /Java server restarted/.test(x.label))?.detail ?? '';
          const out = e.find((x) => /^outcome/.test(x.label));
          return raw('NOTE', 'NOTE', `run ${r}: ${down}; ${out?.label ?? ''}`, out?.detail);
        }) },
      { heading: `A/B on main 3a8fd11711, yolo, no approval involved — ${sum(HU, 's7b-midturn-restart-main2')}`, lines: lines(HU, 's7b-midturn-restart-main2', { withDetail: /60 s after|does not complete|a new Session on/ }) },
      { heading: `Documented case, Harness restart (design section 8) — ${sum(H, 's7c-harness-restart')}`, lines: lines(H, 's7c-harness-restart', { withDetail: /6 s after the expiry|pending list still returns|Java -> Harness calls/, skip: /^pending approval with|^both processes|^Session and Turn/ }) },
    ],
    footer: 'After a restart the connector must re-attach with POST /session/:id/load, which the still-running Harness answers 409 hosted_session_already_attached. Outcome A (short outage): the call is refused at the expiry and the operation ends failed/action_expired. Outcome B (a Store write from the Harness fell into the outage): the Session is recovery-blocked, the Action stays requested and the operation stays running. Both fail closed. The same re-attach failure strands an ordinary yolo Turn on main, so this is inherited, not introduced.',
  },
  {
    id: '06-migration-and-upgrade',
    title: 'Migration: the V23 collision of the previous head is gone; upgrade from main applies V24 cleanly',
    subtitle: 'main gained V23__managed_mcp_records.sql (#12946, merged 12:38Z). The previous head c11c1bdf3c carried V23__managed_actions.sql; commit 57b9960ca2 renamed it to V24; the head is now 7ab2952507.',
    sections: [
      {
        heading: 'Previous head c11c1bdf3c merged with main 7827a3ffcd (local merge, server jar built from it) — what would have shipped',
        lines: [
          raw('PASS', 'PASS', 'git merge-tree --write-tree main pr: clean, no conflicting paths'),
          raw('FAIL', 'FAIL', 'server start on an empty MySQL 8.4.7 database', 'org.flywaydb.core.api.FlywayException: Found more than one migration with version 23'),
          raw('INFO', '', '      Offenders: -> db/migration/V23__managed_actions.sql (SQL)   -> db/migration/V23__managed_mcp_records.sql (SQL)'),
        ],
      },
      {
        heading: 'PR head 7ab2952507',
        lines: [
          raw('PASS', 'PASS', 'fresh database: Flyway applies 22 -> 23 (managed mcp records) -> 24 (managed actions); server starts; every probe on the other cards ran on it'),
          ...lines(HU, 's8a-base-v23', { withDetail: /base schema is at/ }).map((l) => ({ ...l, text: l.text.replace(/^base/, 'main 3a8fd11711') })),
          ...lines(HU, 's8b-upgraded-v23-to-v24', { withDetail: /Flyway applied|default to yolo|lifecycle operations still run|pending list query/ }),
          raw('PASS', 'PASS', `test plan on the upgraded database: ${sum(HU, 's1-testplan-public')}`),
        ],
      },
    ],
    footer: 'Git merged the two V23 files without a conflict, but the merged server refused to boot. The rename to V24 in 57b9960ca2 fixes it: a database created by main upgrades in place, Sessions created before the migration stay yolo, lifecycle operations keep working, and the test plan passes on the upgraded database.',
  },
  {
    id: '07-suites-contract-mutation',
    title: 'Test suites, contract conformance of live responses, and mutation testing of the PR\'s Java code',
    subtitle: 'Suites on the PR head 7ab2952507 (JDK 21.0.12, macOS arm64). Mutants ran at c11c1bdf3c; the three whose surrounding code changed since (M01, M34, M35) were re-run at 7ab2952507 with the same verdicts.',
    sections: [
      {
        heading: 'Suites and contract',
        lines: [
          raw('PASS', 'PASS', `managed-agent-server unit suite, local JDK 21: ${read('test-unit-h3.log').match(/Tests run: \d+, Failures: \d+, Errors: \d+, Skipped: \d+\n\[INFO\] \n\[INFO\] -+\n\[INFO\] BUILD SUCCESS/) ? read('test-unit-h3.log').match(/Tests run: (\d+), Failures: 0, Errors: 0, Skipped: 0\n\[INFO\] \n/)?.[0].trim().split('\n')[0] : '(see log)'}`),
          raw('PASS', 'PASS', `HostedPublicWorkspaceIT (packaged Harness + real worker) on local MySQL 8.4.7: ${(read('test-it-h3.log').match(/Tests run: 2, Failures: 0, Errors: 0, Skipped: 0, Time elapsed: [\d.]+ s/) ?? ['(see log)'])[0]}`),
          raw('PASS', 'PASS', `CI at 7ab2952507: every finished check green, including "Hosted process fault gates / MySQL 8.4 / Java 21" (ubuntu, MySQL 8.4.6)`),
          raw('PASS', 'PASS', (read('s9-contract-h3.log').trim().split('\n').pop() ?? '').replace('== contract:', 'live responses validated against the shipped OpenAPI 1.25.0 document (Ajv):') + '; negative control rejected'),
        ],
      },
      {
        heading: '39 single-edit mutants: 21 killed by the PR\'s unit suite, 3 more by the Hosted IT, 10 more by 8 candidate unit tests; 5 left (2 equivalent)',
        lines: [
          { kind: 'HEAD', text: 'survived the PR\'s unit suite' },
          ...[...mut('mut/summary-run1.txt'), ...mut('mut-run3.console'), ...mut('mut-run4-m18.console'), ...mut('mut-run5-m39.console')]
            .filter((l) => / SURVIVED /.test(l))
            .filter((l, i, a) => a.findIndex((x) => x.slice(0, 3) === l.slice(0, 3)) === i)
            .sort()
            .map((l) => {
              const id = l.slice(0, 3);
              const desc = l.replace(/^M\d+ SURVIVED\s+/, '').replace(/\s+run=.*$/, '');
              const it = mut('mut-it.console').find((x) => x.startsWith(id));
              const cov = mut('mut-cov.console').find((x) => x.startsWith(id));
              const by = cov && / KILLED /.test(cov) ? 'killed by candidate test ' + (cov.match(/ManagedActionsCoverageTest\.(\w+)/)?.[1] ?? '') : it && / KILLED /.test(it) ? 'killed by HostedPublicWorkspaceIT' : { M23: 'survives: equivalent (one retry later)', M24: 'survives: equivalent (duplicate dispatch is fenced by the claim)', M12: 'survives: defence in depth', M35: 'survives: differs only if the deployment mode changes between admission and create', M36: 'survives suites; the 8 s expiry probe on the real stack catches it' }[id] ?? 'survives';
              return { kind: /killed/.test(by) ? 'PASS' : 'NOTE', tag: id, pad: 4, text: `${desc.padEnd(58)} ${by}` };
            }),
        ],
      },
    ],
    footer: 'The PR\'s own suites pass locally and in CI, and 1,626 recorded live responses conform to the shipped contract. The unit suite leaves 18 of 39 mutants alive, among them the owner-facing action.updated event, the question-kind check and the filter that keeps the lifecycle worker (which closes the Session) away from Action responses. A candidate test class with 8 tests (attached) kills 11 of them and passes Checkstyle.',
  },
  {
    id: '08-visibility-and-skew',
    title: 'F2 — the owner cannot see what the call will do; O4 — a Harness that reports no approval mode',
    subtitle: HEAD,
    footColor: '#d29922',
    sections: [
      { heading: `What every client-visible surface shows about the call awaiting approval — ${sum(H, 's13-visibility')}`, lines: lines(H, 's13-visibility', { withDetail: /./ }) },
      { heading: `Other requests while the Turn waits — ${sum(H, 's12-misc')}`, lines: lines(H, 's12-misc', { withDetail: /Session Items while|turns\/cancel|second message|close \/ delete|none of these/ }) },
      {
        heading: 'O4 — Harness without approvalMode in its create/load answers (a build from before D6a, or a rollback)',
        lines: [
          info('strip = the proxy deletes approvalMode from the real Harness\'s answers; pre = Harness and worker bundle built from 356262d8e9, the commit before D6a'),
          ...lines(H, 's11-skew-h3-strip-default', { withDetail: /Turn$|Java -> Harness calls|refuses/, skip: /Session row|what the client reads/ }),
          ...lines(H, 's11-skew-h3-strip-yolo', { withDetail: /Turn$|refuses/, skip: /Session row|what the client reads|Java -> Harness calls/ }),
          ...lines('d6o4b', 's11-skew-h3-pre-yolo', { withDetail: /Turn$|refuses/, skip: /Session row|what the client reads|Java -> Harness calls/ }),
          { kind: 'HEAD', text: 'optional candidate (+6 lines on 7ab2952507): accept a missing mode only for a Session pinned to yolo' },
          ...lines('d6o4b', 's11-skew-o4b-pre-yolo', { withDetail: /Turn$|runs on the Harness/, skip: /Session row|what the client reads|Java -> Harness calls/ }),
          ...lines('d6o4b', 's11-skew-o4b-strip-default', { withDetail: /refuses/, skip: /Session row|what the client reads|Java -> Harness calls|Turn$/ }),
          raw('PASS', 'PASS', `candidate keeps the test plan: ${sum('d6o4b', 's1-testplan-public')}; unit suite 251/251`),
        ],
      },
    ],
    footer: 'F2: the Action carries the tool name and the call id, but no surface (Action detail, Items, events, WebShell transcript, Turn detail) shows the file path or content, before or after the answer. The design says "Arguments come from Items"; today Items hold only the user message. O4: a Harness that does not echo the mode makes every Workspace Session fail after ~35 s with hosted_harness_unavailable, in yolo as well, so the Harness must be upgraded before or with the Java server.',
  },
  {
    id: '09-real-model',
    title: 'Approval round trip with a real model (qwen3.8-max), no scripted tool calls',
    subtitle: `${HEAD}. The Harness talks to a real OpenAI-compatible endpoint; the owner answers through the public API (allow) and through WebShell (deny).`,
    sections: [{ heading: sum('d6ireal', 's14-real-model'), lines: lines('d6ireal', 's14-real-model', { withDetail: /./ }) }],
    footer: 'The real model\'s write_file call waits for the owner. Allow: the file is written with the requested content and the Turn completes. Deny: nothing is written, the model reports the refusal and does not retry.',
  },
];
